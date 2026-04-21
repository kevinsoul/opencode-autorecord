import type { Plugin } from '@opencode-ai/plugin';
import type { Event } from '@opencode-ai/sdk';
import {
  DEFAULT_CONFIG,
  type MessageData,
  type PartData,
  type ChildSessionData,
} from './types.js';
import {
  writeSessionFile,
  isBase64ImageUrl,
  saveImageFromBase64,
  generateFilename,
  getGlobalSaveDirectory,
  ensureGlobalDirectory,
  writeToSecondaryLocation,
  saveImageToSecondaryLocation,
} from './file-manager.js';
import {
  createSession,
  getSession,
  deleteSession,
  getChildSessions,
  updateSessionTitle,
} from './session-tracker.js';
import { formatSession, extractTopicFromMessage } from './formatter.js';
import { regenerateViews } from './view-generator.js';

interface SessionCreatedEvent {
  type: 'session.created';
  properties: {
    info: {
      id: string;
      parentID?: string;
      title?: string;
    };
  };
}

interface SessionIdleEvent {
  type: 'session.idle';
  properties: {
    sessionID: string;
  };
}

interface SessionDeletedEvent {
  type: 'session.deleted';
  properties: {
    info: {
      id: string;
    };
  };
}

interface SessionUpdatedEvent {
  type: 'session.updated';
  properties: {
    info: {
      id: string;
      title?: string;
    };
  };
}

type OpencodeClient = {
  session: {
    messages: (options: {
      path: { id: string };
      query: { directory: string };
    }) => Promise<{ data?: RawMessage[] }>;
  };
};

interface RawMessage {
  id: string;
  role: 'user' | 'assistant';
  time?: { created?: number };
}

interface RawPart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: {
    status: string;
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
    error?: string;
  };
  filename?: string;
  url?: string;
  mime?: string;
}

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
      void regenerateViews(dir).catch(() => {
        // View generation errors are logged internally
      });
      viewDebounceTimers.delete(dir);
    }, delay)
  );
}

const plugin: Plugin = async (input) => {
  try {
    const { directory } = input;

    const globalPath = getGlobalSaveDirectory(directory);
    if (globalPath) {
      globalSaveDir = await ensureGlobalDirectory(globalPath);
    }

    const hooks = {
      event: async ({ event }: { event: Event }): Promise<void> => {
        try {
          await handleEvent(event, input, globalSaveDir);
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
  input: { client: unknown; directory: string },
  globalSaveDir: string | null
): Promise<void> {
  const client = input.client as unknown as OpencodeClient;
  const directory = input.directory;

  switch (event.type) {
    case 'session.created':
      handleSessionCreated(event as SessionCreatedEvent);
      break;
    case 'session.updated':
      handleSessionUpdated(event as SessionUpdatedEvent);
      break;
    case 'session.idle':
      handleSessionIdle(event as SessionIdleEvent, client, directory, globalSaveDir);
      break;
    case 'session.deleted':
      await handleSessionDeleted(
        event as SessionDeletedEvent,
        client,
        directory,
        globalSaveDir
      );
      break;
  }
}

function handleSessionCreated(event: SessionCreatedEvent): void {
  const { info } = event.properties;
  if (!info?.id) return;

  if (!info.parentID) {
    createSession(info.id, info.title || '', '');
  } else {
    createSession(info.id, info.title || 'Subagent', '', info.parentID);
  }
}

function handleSessionUpdated(event: SessionUpdatedEvent): void {
  const { info } = event.properties;
  if (!info?.id) return;

  if (info.title) {
    updateSessionTitle(info.id, info.title);
  }
}

function handleSessionIdle(
  event: SessionIdleEvent,
  client: OpencodeClient,
  directory: string,
  globalSaveDir: string | null
): void {
  const { sessionID } = event.properties;
  if (!sessionID) return;

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

async function handleSessionDeleted(
  event: SessionDeletedEvent,
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
      console.error(`[autorecord] Failed to read ${rejectedCount} child session(s) for ${sessionID}`);
    }

    if (globalSaveDir) {
      await processImagesInMessages(messages, filePath, title, session.createdAt, globalSaveDir);
      for (const child of childData) {
        await processImagesInMessages(child.messages, filePath, title, session.createdAt, globalSaveDir);
      }
    }

    const content = formatSession(
      title,
      session.createdAt,
      messages,
      childData
    );

    if (globalSaveDir) {
      const filename = generateFilename(title || 'untitled', session.createdAt, DEFAULT_CONFIG);
      const globalFilePath = `${globalSaveDir}/${filename}`;
      await writeSessionFile(globalFilePath, content);

      if (filePath) {
        await writeToSecondaryLocation(filePath, globalSaveDir, content);
      }

      // Trigger view regeneration for main sessions
      if (!session.parentID && DEFAULT_CONFIG.view.enabled) {
        scheduleViewRegeneration(globalSaveDir, DEFAULT_CONFIG.view.debounceMs);
      }
    }
  } catch (error) {
    console.error(`[autorecord] Error saving session ${sessionID}:`, error);
  }
}

function convertMessages(rawMessages: RawMessage[]): MessageData[] {
  return rawMessages.map((msg) => {
    const rawParts = (msg as unknown as { parts?: RawPart[] }).parts || [];
    return {
      id: msg.id,
      role: msg.role,
      parts: rawParts.map(convertPart),
      createdAt: msg.time?.created || Date.now(),
    };
  });
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
      if (part.type === 'file' && 'url' in part && 'mime' in part) {
        const filePart = part as { type: 'file'; url: string; mime: string; localPath?: string };
        if (filePart.mime.startsWith('image/') && isBase64ImageUrl(filePart.url)) {
          const localPath = await saveImageFromBase64(filePart.url, mdFilePath, sessionTitle, createdAt, imageIndex);
          if (localPath) {
            filePart.localPath = localPath;

            if (globalSaveDir) {
              await saveImageToSecondaryLocation(filePart.url, globalSaveDir, sessionTitle, createdAt, imageIndex);
            }

            imageIndex++;
          }
        }
      }
    }
  }
}

function convertPart(raw: RawPart): PartData {
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: raw.text || '' };
    case 'tool':
      return {
        type: 'tool',
        tool: raw.tool || 'unknown',
        state: {
          status: raw.state?.status || 'unknown',
          input: raw.state?.input,
          output: raw.state?.output,
          title: raw.state?.title,
          error: raw.state?.error,
        },
      };
    case 'file':
      return {
        type: 'file',
        filename: raw.filename,
        url: raw.url || '',
        mime: raw.mime || 'application/octet-stream',
      };
    case 'reasoning':
      return { type: 'reasoning', text: raw.text || '' };
    default:
      return { type: raw.type };
  }
}

export default plugin;