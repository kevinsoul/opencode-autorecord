import type { Plugin } from '@opencode-ai/plugin';
import type {
  Event,
  EventSessionCreated,
  EventSessionUpdated,
  EventSessionDeleted,
  EventSessionIdle,
  EventSessionCompacted,
  EventMessagePartUpdated,
  Part,
  OpencodeClient,
  SessionMessagesResponse,
} from '@opencode-ai/sdk';
import {
  DEFAULT_CONFIG,
  type MessageData,
  type PartData,
  type FilePartData,
  type ChildSessionData,
} from './types.js';
import {
  saveSessionToTopicFile,
  isBase64ImageUrl,
  saveImageFromBase64,
  generateFilename,
  getGlobalSaveDirectory,
  ensureGlobalDirectory,
  saveImageToSecondaryLocation,
} from './file-manager.js';
import { dirname } from 'node:path';
import {
  createSession,
  getSession,
  deleteSession,
  getChildSessions,
  updateSessionTitle,
} from './session-tracker.js';
import { formatSession, extractTopicFromMessage } from './formatter.js';
import { regenerateViews } from './view-generator.js';

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const viewDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

let globalSaveDir: string | null = null;

function scheduleViewRegeneration(dir: string, delay: number): void {
  const existing = viewDebounceTimers.get(dir);
  if (existing) {
    clearTimeout(existing);
  }
  viewDebounceTimers.set(
    dir,
    setTimeout(() => {
      void regenerateViews(dirname(dir)).catch(() => {
        // View generation errors are logged internally
      });
      viewDebounceTimers.delete(dir);
    }, delay)
  );
}

const plugin: Plugin = async (input) => {
  try {
    const { directory, client } = input;

    const globalPath = getGlobalSaveDirectory(directory);
    if (globalPath) {
      globalSaveDir = await ensureGlobalDirectory(globalPath);
    }

    const hooks = {
      event: async ({ event }: { event: Event }): Promise<void> => {
        try {
          await handleEvent(event, client, directory, globalSaveDir);
        } catch {
          // Silently ignore event handling errors to not affect other plugins
        }
      },
    };

    return hooks;
  } catch {
    return {};
  }
};

async function handleEvent(
  event: Event,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  switch (event.type) {
    case 'session.created':
      handleSessionCreated(event as EventSessionCreated);
      break;
    case 'session.updated':
      handleSessionUpdated(event as EventSessionUpdated);
      break;
    case 'session.idle':
      handleSessionIdle(event as EventSessionIdle, client, directory, globalSaveDir);
      break;
    case 'session.deleted':
      await handleSessionDeleted(
        event as EventSessionDeleted,
        client,
        directory,
        globalSaveDir
      );
      break;
    case 'message.part.updated':
      handleMessagePartUpdated(event as EventMessagePartUpdated, client, directory, globalSaveDir);
      break;
    case 'session.compacted':
      await handleSessionCompacted(event as EventSessionCompacted, client, directory, globalSaveDir);
      break;
  }
}

function handleSessionCreated(event: EventSessionCreated): void {
  const { info } = event.properties;
  if (!info?.id) return;

  if (!info.parentID) {
    createSession(info.id, info.title || '', '');
  } else {
    createSession(info.id, info.title || 'Subagent', '', info.parentID);
  }
}

function handleSessionUpdated(event: EventSessionUpdated): void {
  const { info } = event.properties;
  if (!info?.id) return;

  if (info.title) {
    updateSessionTitle(info.id, info.title);
  }
}

function handleMessagePartUpdated(
  event: EventMessagePartUpdated,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): void {
  const { part } = event.properties;
  if (!part?.sessionID) return;

  scheduleSave(part.sessionID, client, directory, globalSaveDir);
}

async function handleSessionCompacted(
  event: EventSessionCompacted,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  const { sessionID } = event.properties;
  if (!sessionID) return;

  const session = getSession(sessionID);
  if (!session) return;

  const targetID = session.parentID || sessionID;

  // 取消待定的 debounce 保存
  const timer = debounceTimers.get(targetID);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(targetID);
  }

  // 立即保存
  await saveSessionToFile(targetID, client, directory, globalSaveDir);
}

function scheduleSave(
  sessionID: string,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): void {
  const session = getSession(sessionID);
  if (!session) return;

  const targetID = session.parentID || sessionID;

  const existing = debounceTimers.get(targetID);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    targetID,
    setTimeout(() => {
      void saveSessionToFile(targetID, client, directory, globalSaveDir);
      debounceTimers.delete(targetID);
    }, DEFAULT_CONFIG.debounceMs)
  );
}

function handleSessionIdle(
  event: EventSessionIdle,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): void {
  const { sessionID } = event.properties;
  if (!sessionID) return;

  scheduleSave(sessionID, client, directory, globalSaveDir);
}

async function handleSessionDeleted(
  event: EventSessionDeleted,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  const { info } = event.properties;
  if (!info?.id) return;

  const session = getSession(info.id);
  if (!session) return;

  const targetID = session.parentID || info.id;

  const timer = debounceTimers.get(targetID);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(targetID);
  }

  await saveSessionToFile(targetID, client, directory, globalSaveDir);
  deleteSession(info.id);
}

async function saveSessionToFile(
  sessionID: string,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  try {
    const session = getSession(sessionID);
    if (!session) return;

    if (session.parentID) {
      const parent = getSession(session.parentID);
      if (parent) {
        await saveSessionToFile(session.parentID, client, directory, globalSaveDir);
      }
      return;
    }

    const response = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
    });

    const rawMessages = response.data || [];
    const messages = convertMessages(rawMessages);

    if (messages.length === 0) {
      return;
    }

    let title = session.title;
    if (!title || title.startsWith('New-session-') || title.startsWith('New session')) {
      const firstUserMessage = messages.find((m) => m.role === 'user');
      if (firstUserMessage) {
        const firstTextPart = firstUserMessage.parts.find(
          (p): p is { type: 'text'; text: string } =>
            p.type === 'text' && 'text' in p
        );
        if (firstTextPart) {
          title = extractTopicFromMessage(
            firstTextPart.text,
            DEFAULT_CONFIG.maxTopicLength
          );
          updateSessionTitle(sessionID, title);
        }
      }
    }

    const filePath = session.filePath;

    const children = getChildSessions(sessionID);
    const childResults = await Promise.allSettled(
      children.map(async (child) => {
        const childResponse = await client.session.messages({
          path: { id: child.id },
          query: { directory },
        });
        const childMessages = convertMessages(childResponse.data || []);
        return {
          title: child.title,
          createdAt: child.createdAt,
          messages: childMessages,
        };
      })
    );

    const childData: ChildSessionData[] = childResults
      .filter((r): r is PromiseFulfilledResult<ChildSessionData> => r.status === 'fulfilled')
      .map((r) => r.value);

    const rejectedCount = childResults.length - childData.length;
    if (rejectedCount > 0) {
      void logApp(client, 'error', `Failed to read ${rejectedCount} child session(s) for ${sessionID}`);
    }

    if (globalSaveDir) {
      await processImagesInMessages(messages, filePath, title, session.createdAt, globalSaveDir);
      for (const child of childData) {
        await processImagesInMessages(child.messages, filePath, title, session.createdAt, globalSaveDir);
      }
    }

    const content = formatSession(
      sessionID,
      title,
      session.createdAt,
      messages,
      childData
    );

    if (globalSaveDir) {
      const filename = generateFilename(title || 'untitled', session.createdAt, DEFAULT_CONFIG);
      const globalFilePath = `${globalSaveDir}/${filename}`;
      await saveSessionToTopicFile(globalFilePath, sessionID, content, title || 'untitled');

      // Trigger view regeneration for main sessions
      if (!session.parentID && DEFAULT_CONFIG.view.enabled) {
        scheduleViewRegeneration(globalSaveDir, DEFAULT_CONFIG.view.debounceMs);
      }
    }
  } catch (error) {
    void logApp(client, 'error', `Error saving session ${sessionID}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function logApp(
  client: OpencodeClient,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
): Promise<void> {
  return client.app
    .log({
      body: { service: 'opencode-autorecord', level, message, extra },
    })
    .then(() => undefined)
    .catch(() => {
      // Ignore logging failures to not affect plugin flow
    });
}

function convertMessages(rawMessages: SessionMessagesResponse): MessageData[] {
  return rawMessages.map(({ info, parts }) => {
    const base: MessageData = {
      id: info.id,
      role: info.role,
      parts: parts.map(convertPart),
      createdAt: info.time?.created || Date.now(),
    };

    if (info.role !== 'assistant') {
      return base;
    }

    // Assistant-only metadata (A1/A2/A3): model, usage, cost, duration,
    // finish reason, structured error and compaction-summary marker.
    const completed = info.time?.completed;
    if (completed && completed > base.createdAt) {
      base.durationMs = completed - base.createdAt;
    }
    base.modelID = info.modelID || undefined;
    base.providerID = info.providerID || undefined;
    if (typeof info.cost === 'number') {
      base.cost = info.cost;
    }
    if (info.tokens) {
      base.tokens = {
        input: info.tokens.input,
        output: info.tokens.output,
        reasoning: info.tokens.reasoning,
        cacheRead: info.tokens.cache.read,
        cacheWrite: info.tokens.cache.write,
      };
    }
    base.finishReason = info.finish || undefined;
    if (info.error) {
      base.errorMessage = formatProviderError(info.error);
    }
    if (info.summary) {
      base.summary = true;
    }
    return base;
  });
}

function formatProviderError(error: NonNullable<
  Extract<SessionMessagesResponse[number]['info'], { role: 'assistant' }>['error']
>): string {
  const data = error.data as { message?: string } | undefined;
  if (data && typeof data.message === 'string' && data.message) {
    return `${error.name}: ${data.message}`;
  }
  try {
    return `${error.name}: ${JSON.stringify(data ?? {})}`;
  } catch {
    return error.name;
  }
}

function isFilePart(part: PartData): part is FilePartData {
  return part.type === 'file' && 'url' in part && 'mime' in part;
}

async function processImagesInMessages(
  messages: MessageData[],
  mdFilePath: string,
  sessionTitle: string,
  createdAt: Date,
  globalSaveDir: string | null
): Promise<void> {
  let imageIndex = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isFilePart(part)) continue;
      if (part.mime.startsWith('image/') && isBase64ImageUrl(part.url)) {
        const localPath = await saveImageFromBase64(part.url, mdFilePath, sessionTitle, createdAt, imageIndex);
        if (localPath) {
          part.localPath = localPath;

          if (globalSaveDir) {
            await saveImageToSecondaryLocation(part.url, globalSaveDir, sessionTitle, createdAt, imageIndex);
          }

          imageIndex++;
        }
      }
    }
  }
}

function convertPart(raw: Part): PartData {
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: raw.text, synthetic: raw.synthetic || undefined };
    case 'tool':
      return {
        type: 'tool',
        tool: raw.tool,
        state: {
          status: raw.state.status,
          input: raw.state.input,
          output: 'output' in raw.state ? raw.state.output : undefined,
          title: 'title' in raw.state ? raw.state.title : undefined,
          error: 'error' in raw.state ? raw.state.error : undefined,
        },
      };
    case 'file':
      return {
        type: 'file',
        filename: raw.filename,
        url: raw.url,
        mime: raw.mime,
      };
    case 'reasoning':
      return { type: 'reasoning', text: raw.text };
    default:
      return { type: raw.type };
  }
}

export default plugin;