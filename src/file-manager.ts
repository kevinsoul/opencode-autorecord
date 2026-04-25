import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import type { PluginConfig } from './types.js';

const INVALID_FILENAME_CHARS = /[/\\:*?"<>|]/g;
const MULTIPLE_HYPHENS = /-+/g;
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g;

const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prevLock = fileLocks.get(filePath);
  let release: (() => void) | undefined;
  const lockPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  fileLocks.set(filePath, lockPromise);

  if (prevLock) {
    await prevLock;
  }

  try {
    return await fn();
  } finally {
    release?.();
    if (fileLocks.get(filePath) === lockPromise) {
      fileLocks.delete(filePath);
    }
  }
}

export async function ensureDirectory(
  baseDir: string,
  config: PluginConfig
): Promise<string> {
  const dir = join(baseDir, config.saveDirectory);
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    console.error(`[autorecord] Failed to create directory ${dir}:`, error);
  }
  return dir;
}

export function generateFilename(
  topic: string,
  createdAt: Date,
  config: PluginConfig
): string {
  const dateStr = formatDateForFilename(createdAt);
  const sanitized = sanitizeTopic(topic, config.maxTopicLength);
  return `${dateStr}-${sanitized}.md`;
}

export function formatDateForFilename(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}-${minutes}-${seconds}`;
}

export function sanitizeTopic(topic: string, maxLength: number): string {
  let sanitized = topic
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(/\s+/g, '-')
    .replace(MULTIPLE_HYPHENS, '-')
    .replace(LEADING_TRAILING_HYPHENS, '');

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
    sanitized = sanitized.replace(LEADING_TRAILING_HYPHENS, '');
  }

  return sanitized || 'untitled';
}

function parseTopicBlocks(content: string): Array<{ id: string; content: string }> {
  const blocks: Array<{ id: string; content: string }> = [];
  const lines = content.split('\n');
  let currentId: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^<!-- AUTORECORD-SESSION-BLOCK: ([^>]+) -->$/);
    if (match) {
      if (currentId !== null) {
        blocks.push({ id: currentId, content: currentLines.join('\n').trimEnd() });
      }
      currentId = match[1];
      currentLines = [];
    } else if (currentId !== null) {
      currentLines.push(line);
    }
  }

  if (currentId !== null) {
    blocks.push({ id: currentId, content: currentLines.join('\n').trimEnd() });
  }

  // Deduplicate: keep the last occurrence of each session-id
  const seen = new Set<string>();
  const deduped: Array<{ id: string; content: string }> = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!seen.has(block.id)) {
      seen.add(block.id);
      deduped.unshift(block);
    }
  }

  return deduped;
}

function buildTopicFile(
  topic: string,
  blocks: Array<{ id: string; content: string }>
): string {
  const lines: string[] = [];
  lines.push(`# Topic: ${topic}`);
  lines.push('');
  lines.push('---');

  for (const block of blocks) {
    lines.push('');
    lines.push(`<!-- AUTORECORD-SESSION-BLOCK: ${block.id} -->`);
    lines.push(block.content);
  }

  let content = lines.join('\n');

  // Replace newlines inside <details>...</details> with <br>
  content = content.replace(/<details>([\s\S]*?)<\/details>/g, (_match, inner) => {
    return `<details>${inner.replace(/\n/g, '<br>')}</details>`;
  });

  return content;
}

export async function saveSessionToTopicFile(
  filePath: string,
  sessionId: string,
  content: string,
  topic: string
): Promise<boolean> {
  return withFileLock(filePath, async () => {
    try {
      await mkdir(dirname(filePath), { recursive: true });

      let existingContent = '';
      try {
        existingContent = await readFile(filePath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      const blocks = parseTopicBlocks(existingContent);
      const existingIdx = blocks.findIndex((b) => b.id === sessionId);

      if (existingIdx >= 0) {
        blocks[existingIdx] = { id: sessionId, content };
      } else {
        blocks.push({ id: sessionId, content });
      }

      const newContent = buildTopicFile(topic, blocks);

      const tempPath = `${filePath}.tmp`;
      try {
        await writeFile(tempPath, newContent, 'utf-8');
        await rename(tempPath, filePath);
        return true;
      } catch (error) {
        console.error(`[autorecord] Failed to write file ${filePath}:`, error);
        try {
          await unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        return false;
      }
    } catch (error) {
      console.error(`[autorecord] Failed to save session to ${filePath}:`, error);
      return false;
    }
  });
}

const BASE64_DATA_URL_REGEX = /^data:image\/([a-zA-Z]+);base64,(.+)$/;

export function isBase64ImageUrl(url: string): boolean {
  return BASE64_DATA_URL_REGEX.test(url);
}

export function extractBase64Data(url: string): { format: string; data: string } | null {
  const match = url.match(BASE64_DATA_URL_REGEX);
  if (!match) return null;
  return { format: match[1], data: match[2] };
}

export async function saveImageFromBase64(
  base64Url: string,
  mdFilePath: string,
  sessionTitle: string,
  createdAt: Date,
  imageIndex: number
): Promise<string | null> {
  const extracted = extractBase64Data(base64Url);
  if (!extracted) return null;

  const mdDir = dirname(mdFilePath);
  const imagesDir = join(mdDir, 'images');
  const dateStr = formatDateForFilename(createdAt);
  const sanitizedTitle = sanitizeTopic(sessionTitle, 50);

  try {
    await mkdir(imagesDir, { recursive: true });

    const ext = extracted.format === 'jpeg' ? 'jpg' : extracted.format;
    const imageFilename = `${dateStr}-${sanitizedTitle}-${imageIndex}.${ext}`;
    const imagePath = join(imagesDir, imageFilename);

    const buffer = Buffer.from(extracted.data, 'base64');
    await writeFile(imagePath, buffer);

    return `images/${imageFilename}`;
  } catch (error) {
    console.error('[autorecord] Failed to save image:', error);
    return null;
  }
}

export function getGlobalSaveDirectory(projectDir: string): string | null {
  try {
    const home = homedir();
    if (!home) {
      return null;
    }

    const projectName = basename(projectDir);
    const sanitizedProjectName = sanitizeTopic(projectName, 50);

    return join(home, 'opencode-autorecord', sanitizedProjectName);
  } catch {
    return null;
  }
}

export async function ensureGlobalDirectory(
  globalSaveDir: string
): Promise<string | null> {
  try {
    await mkdir(globalSaveDir, { recursive: true });
    return globalSaveDir;
  } catch (error) {
    console.error(
      `[autorecord] Failed to create global directory ${globalSaveDir}:`,
      error
    );
    return null;
  }
}

export async function saveImageToSecondaryLocation(
  base64Url: string,
  globalSaveDir: string,
  sessionTitle: string,
  createdAt: Date,
  imageIndex: number
): Promise<void> {
  const extracted = extractBase64Data(base64Url);
  if (!extracted) return;

  const imagesDir = join(globalSaveDir, 'images');
  const dateStr = formatDateForFilename(createdAt);
  const sanitizedTitle = sanitizeTopic(sessionTitle, 50);

  try {
    await mkdir(imagesDir, { recursive: true });

    const ext = extracted.format === 'jpeg' ? 'jpg' : extracted.format;
    const imageFilename = `${dateStr}-${sanitizedTitle}-${imageIndex}.${ext}`;
    const imagePath = join(imagesDir, imageFilename);

    const buffer = Buffer.from(extracted.data, 'base64');
    await writeFile(imagePath, buffer);
  } catch (error) {
    console.error('[autorecord] Failed to save image to secondary location:', error);
  }
}
