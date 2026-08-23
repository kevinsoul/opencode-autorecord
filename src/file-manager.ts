import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { PluginConfig } from './types.js';

const INVALID_FILENAME_CHARS = /[/\\:*?"<>|]/g;
const MULTIPLE_HYPHENS = /-+/g;
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g;

/**
 * 会话块数据格式版本。写入每个块的头部注释（AUTORECORD-SCHEMA），
 * 解析时遇到更高版本的块必须跳过覆盖（fail-closed），防止旧逻辑破坏新格式数据。
 */
export const SCHEMA_VERSION = 2;
const SCHEMA_LINE_RE = /^<!-- AUTORECORD-SCHEMA: (\d+) -->$/;

interface TopicBlock {
  id: string;
  content: string;
  /** 未标记的存量块视为 v1（undefined） */
  schemaVersion?: number;
}

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

/** 从块内容首行提取 schema 版本标记；无标记的存量内容视为 v1 */
function extractBlockSchema(lines: string[]): { schemaVersion: number | undefined; contentLines: string[] } {
  if (lines.length > 0) {
    const match = lines[0].match(SCHEMA_LINE_RE);
    if (match) {
      return { schemaVersion: parseInt(match[1], 10), contentLines: lines.slice(1) };
    }
  }
  return { schemaVersion: undefined, contentLines: lines };
}

function parseTopicBlocks(content: string): TopicBlock[] {
  const blocks: TopicBlock[] = [];
  const lines = content.split('\n');
  let currentId: string | null = null;
  let currentLines: string[] = [];

  const flushCurrent = (): void => {
    if (currentId === null) return;
    const { schemaVersion, contentLines } = extractBlockSchema(currentLines);
    blocks.push({ id: currentId, content: contentLines.join('\n').trimEnd(), schemaVersion });
  };

  for (const line of lines) {
    const match = line.match(/^<!-- AUTORECORD-SESSION-BLOCK: ([^>]+) -->$/);
    if (match) {
      flushCurrent();
      currentId = match[1];
      currentLines = [];
    } else if (currentId !== null) {
      currentLines.push(line);
    }
  }

  flushCurrent();

  // Deduplicate: 同一 session-id 出现多次时保留 schema 版本最高的块（同版本保留最后一次），
  // 避免旧逻辑追加的低版本副本覆盖新格式数据
  const best = new Map<string, TopicBlock>();
  for (const block of blocks) {
    const cur = best.get(block.id);
    if (!cur || (block.schemaVersion ?? 1) >= (cur.schemaVersion ?? 1)) {
      best.set(block.id, block);
    }
  }
  return blocks.filter((b) => best.get(b.id) === b);
}

function buildTopicFile(
  topic: string,
  blocks: TopicBlock[]
): string {
  const lines: string[] = [];
  lines.push(`# Topic: ${topic}`);
  lines.push('');
  lines.push('---');

  for (const block of blocks) {
    lines.push('');
    lines.push(`<!-- AUTORECORD-SESSION-BLOCK: ${block.id} -->`);
    if (block.schemaVersion !== undefined) {
      lines.push(`<!-- AUTORECORD-SCHEMA: ${block.schemaVersion} -->`);
    }
    lines.push(block.content);
  }

  let content = lines.join('\n');

  // Replace newlines inside <details>...</details> with <br>
  content = content.replace(/<details>([\s\S]*?)<\/details>/g, (_match, inner) => {
    return `<details>${inner.replace(/\n/g, '<br>')}</details>`;
  });

  return content;
}

export type TopicFileSaveResult = 'saved' | 'unchanged' | 'skipped-newer';

export async function saveSessionToTopicFile(
  filePath: string,
  sessionId: string,
  content: string,
  topic: string
): Promise<TopicFileSaveResult> {
  return withFileLock(filePath, async (): Promise<TopicFileSaveResult> => {
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

      // fail-closed：磁盘上的块由更高版本逻辑写入时，保留原块拒绝覆盖
      if (
        existingIdx >= 0 &&
        (blocks[existingIdx].schemaVersion ?? 1) > SCHEMA_VERSION
      ) {
        console.warn(
          `[autorecord] Skipped session ${sessionId} in ${filePath}: block schema v${String(blocks[existingIdx].schemaVersion)} is newer than local v${SCHEMA_VERSION}`
        );
        return 'skipped-newer';
      }

      if (existingIdx >= 0) {
        blocks[existingIdx] = { id: sessionId, content, schemaVersion: SCHEMA_VERSION };
      } else {
        blocks.push({ id: sessionId, content, schemaVersion: SCHEMA_VERSION });
      }

      const newContent = buildTopicFile(topic, blocks);

      if (newContent === existingContent) {
        return 'unchanged';
      }

      const tempPath = `${filePath}.tmp`;
      try {
        await writeFile(tempPath, newContent, 'utf-8');
        await rename(tempPath, filePath);
        return 'saved';
      } catch (error) {
        console.error(`[autorecord] Failed to write file ${filePath}:`, error);
        try {
          await unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        return 'unchanged';
      }
    } catch (error) {
      console.error(`[autorecord] Failed to save session to ${filePath}:`, error);
      return 'unchanged';
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
    // AUTORECORD_HOME 允许重定向数据根目录（开发/测试时与真实数据物理隔离）
    const envHome = process.env.AUTORECORD_HOME?.trim();
    let baseDir: string;
    if (envHome) {
      baseDir = resolve(envHome);
    } else {
      const home = homedir();
      if (!home) {
        return null;
      }
      baseDir = join(home, 'opencode-autorecord');
    }

    const projectName = basename(projectDir);
    const sanitizedProjectName = sanitizeTopic(projectName, 50);

    return join(baseDir, sanitizedProjectName);
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
