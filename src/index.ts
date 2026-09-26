import { Plugin } from '@opencode/plugin';
import type { SessionMessageInfo, SessionStructuredError, V2Event } from '@opencode/client';
import { isSessionNotFoundError } from '@opencode/client';
import {
  DEFAULT_CONFIG,
  type MessageData,
  type PartData,
  type ToolPartData,
  type FilePartData,
  type ChildSessionData,
  type SessionInfo,
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
import { initStaleGuard, checkStale, consumeStaleWarning } from './stale-guard.js';
import { logWarn, logError, errorText } from './logger.js';

/** 助手消息 content 数组的元素类型（text / reasoning / tool） */
type AssistantContent = Extract<SessionMessageInfo, { type: 'assistant' }>['content'][number];

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const viewDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 部分事件信封无 location 时，回退读取 data.location（如 session.created）。 */
function getEventDataLocation(event: V2Event): string | undefined {
  const data = event.data as { location?: { directory?: string } | undefined };
  return data?.location?.directory;
}

/**
 * 取会话跟踪记录；若本地无记录（插件热重载清空内存 tracker，或 location 实例
 * 晚于 session.created 创建而错过事件），主动从服务端拉取补建，恢复 V1 常驻
 * 单实例下"进行中会话始终可保存"的行为。
 */
async function ensureSession(
  sessionID: string,
  ctx: Plugin.Context
): Promise<SessionInfo | undefined> {
  const existing = getSession(sessionID);
  if (existing) return existing;

  try {
    const info = await ctx.session.get({ sessionID });
    if (!info?.id) return undefined;
    const tracked = createSession(sessionID, info.title || '', '', info.parentID || undefined);
    if (info.time?.created) {
      tracked.createdAt = new Date(info.time.created);
    }
    return tracked;
  } catch (error) {
    // 会话已删除属正常竞态，保持静默；其余错误（RPC 异常等）记录 warn
    if (!isSessionNotFoundError(error)) {
      logApp('warn', `failed to fetch session ${sessionID} for tracking`, {
        error: errorText(error),
      });
    }
    return undefined;
  }
}

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

const plugin = Plugin.define({
  id: 'opencode-autorecord',
  async setup(ctx) {
    const directory = ctx.location.directory;

    // 初始化失败时与 V1 保持一致：不订阅事件（插件空转）
    let globalSaveDir: string | null = null;
    try {
      await initStaleGuard();
      const globalPath = getGlobalSaveDirectory(directory);
      if (globalPath) {
        globalSaveDir = await ensureGlobalDirectory(globalPath);
      }
    } catch (error) {
      // 与 V1 一致：初始化失败则不订阅（插件空转），但错误必须留痕
      logApp('error', `init failed for ${directory}; plugin stays idle`, {
        error: errorText(error),
      });
      return;
    }

    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await handleEvent(event, ctx, directory, globalSaveDir);
          } catch {
            // 静默忽略事件处理错误，避免影响其他插件
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          // 非主动中止（cleanup abort）：事件流意外断开，该 location 将不再记录
          logApp(
            'error',
            `event subscription ended unexpectedly (instance=${directory}); this location will no longer be recorded until opencode reloads/restarts`
          );
        }
      }
    })();

    return (): void => {
      controller.abort();
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      for (const timer of viewDebounceTimers.values()) clearTimeout(timer);
      viewDebounceTimers.clear();
    };
  },
});

async function handleEvent(
  event: V2Event,
  ctx: Plugin.Context,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  // V2 服务端为每个 location 实例化插件，事件全局广播。
  // 只处理归属本 location 的会话，避免同一会话被复制到所有 location 的归档目录。
  // 事件未携带 location 时放行（信封字段为可选，兜底保持 V1 单实例语义）。
  const eventDir = event.location?.directory ?? getEventDataLocation(event);
  if (eventDir !== undefined && eventDir !== directory) {
    return;
  }

  switch (event.type) {
    case 'session.created': {
      const { sessionID, parentID, title } = event.data;
      if (!parentID) {
        createSession(sessionID, title || '', '');
      } else {
        createSession(sessionID, title || 'Subagent', '', parentID);
      }
      break;
    }
    case 'session.renamed': {
      const { sessionID, title } = event.data;
      if (title) {
        updateSessionTitle(sessionID, title);
      }
      break;
    }
    case 'session.idle':
      await scheduleSave(event.data.sessionID, ctx, directory, globalSaveDir);
      break;
    case 'session.deleted':
      await handleSessionDeleted(event.data.sessionID, ctx, directory, globalSaveDir);
      break;
    // V1 的 message.part.updated 对应 V2 的 step 流事件（官方迁移指南映射）
    case 'session.step.streamed':
    case 'session.step.ended':
      await scheduleSave(event.data.sessionID, ctx, directory, globalSaveDir);
      break;
    // V1 的 session.compacted 对应 V2 的 session.compaction.ended
    case 'session.compaction.ended':
      await handleSessionCompacted(event.data.sessionID, ctx, directory, globalSaveDir);
      break;
    default:
      break;
  }
}

async function handleSessionCompacted(
  sessionID: string,
  ctx: Plugin.Context,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  const session = await ensureSession(sessionID, ctx);
  if (!session) return;

  const targetID = session.parentID || sessionID;

  // 取消待定的 debounce 保存
  const timer = debounceTimers.get(targetID);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(targetID);
  }

  // 立即保存
  await saveSessionToFile(targetID, ctx, directory, globalSaveDir);
}

async function scheduleSave(
  sessionID: string,
  ctx: Plugin.Context,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  const session = await ensureSession(sessionID, ctx);
  if (!session) return;

  const targetID = session.parentID || sessionID;

  const existing = debounceTimers.get(targetID);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    targetID,
    setTimeout(() => {
      void saveSessionToFile(targetID, ctx, directory, globalSaveDir);
      debounceTimers.delete(targetID);
    }, DEFAULT_CONFIG.debounceMs)
  );
}

async function handleSessionDeleted(
  sessionID: string,
  ctx: Plugin.Context,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  const session = await ensureSession(sessionID, ctx);
  if (!session) return;

  const targetID = session.parentID || sessionID;

  const timer = debounceTimers.get(targetID);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(targetID);
  }

  await saveSessionToFile(targetID, ctx, directory, globalSaveDir);
  deleteSession(sessionID);
}

async function saveSessionToFile(
  sessionID: string,
  ctx: Plugin.Context,
  directory: string,
  globalSaveDir: string | null
): Promise<void> {
  try {
    // 过期自检：磁盘构建产物已被重新生成时，本进程持有旧逻辑，
    // 所有写盘操作（会话保存与视图再生）必须短路，直到重启 opencode
    if (await checkStale()) {
      if (consumeStaleWarning()) {
        logApp(
          'warn',
          'opencode-autorecord plugin is outdated (dist changed on disk); writes disabled until opencode restarts'
        );
      }
      return;
    }

    const session = await ensureSession(sessionID, ctx);
    if (!session) return;

    if (session.parentID) {
      const parent = await ensureSession(session.parentID, ctx);
      if (parent) {
        await saveSessionToFile(session.parentID, ctx, directory, globalSaveDir);
      }
      return;
    }

    const rawMessages = await ctx.session.context({ sessionID });
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
        const childRaw = await ctx.session.context({ sessionID: child.id });
        const childMessages = convertMessages(childRaw);
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
      logApp('error', `Failed to read ${rejectedCount} child session(s) for ${sessionID}`);
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
      const saveResult = await saveSessionToTopicFile(
        globalFilePath,
        sessionID,
        content,
        title || 'untitled'
      );
      if (saveResult === 'skipped-newer') {
        logApp(
          'warn',
          `Skipped session ${sessionID}: existing block written by newer schema version`
        );
      }

      // Trigger view regeneration for main sessions
      if (!session.parentID && DEFAULT_CONFIG.view.enabled) {
        scheduleViewRegeneration(globalSaveDir, DEFAULT_CONFIG.view.debounceMs);
      }
    }
  } catch (error) {
    logApp('error', `Error saving session ${sessionID}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * V1 使用 client.app.log；V2 插件 API 无此能力，迁移指南允许 console。
 * 注意：`serve --service` 守护模式下 stdout 是 /dev/null，console 输出会丢失，
 * 因此 warn/error 额外写入独立日志文件（见 logger.ts），debug/info 仅走 console。
 */
function logApp(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>
): void {
  const line = `[opencode-autorecord] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
  if (level === 'error') {
    logError(line);
  } else if (level === 'warn') {
    logWarn(line);
  } else {
    console.log(line);
  }
}

function convertMessages(rawMessages: SessionMessageInfo[]): MessageData[] {
  const result: MessageData[] = [];
  for (const raw of rawMessages) {
    const message = convertMessage(raw);
    if (message) {
      result.push(message);
    }
  }
  return result;
}

/**
 * V2 的 SessionMessageInfo 是扁平判别联合（type: user/synthetic/assistant/compaction/...），
 * 转换为 formatter 消费的 MessageData（仅 user/assistant）。
 * system/skill/shell/idle/agent·model·location-switched 及 compaction running/failed 一律跳过。
 */
function convertMessage(raw: SessionMessageInfo): MessageData | null {
  switch (raw.type) {
    case 'user': {
      // 与 V1 历史产物一致：文本在前，附件文件在后
      const parts: PartData[] = [{ type: 'text', text: raw.text }];
      for (const file of raw.files ?? []) {
        const url =
          file.source.type === 'uri'
            ? file.source.uri
            : `data:${file.mime};base64,${file.data}`;
        parts.push({
          type: 'file',
          filename: file.name ?? (file.source.type === 'uri' ? uriBasename(file.source.uri) : undefined),
          url,
          mime: file.mime,
        });
      }
      return { id: raw.id, role: 'user', parts, createdAt: raw.time.created };
    }
    case 'synthetic':
      // 系统注入上下文：V1 中为 user 消息的 synthetic 文本 part
      return {
        id: raw.id,
        role: 'user',
        parts: [{ type: 'text', text: raw.text, synthetic: true }],
        createdAt: raw.time.created,
      };
    case 'assistant': {
      const message: MessageData = {
        id: raw.id,
        role: 'assistant',
        parts: raw.content.map(convertAssistantContent),
        createdAt: raw.time.created,
        modelID: raw.model.id,
        providerID: raw.model.providerID,
      };
      const completed = raw.time.completed;
      if (completed && completed > message.createdAt) {
        message.durationMs = completed - message.createdAt;
      }
      if (typeof raw.cost === 'number') {
        message.cost = raw.cost;
      }
      if (raw.tokens) {
        message.tokens = flattenTokens(raw.tokens);
      }
      if (raw.finish) {
        message.finishReason = raw.finish;
      }
      if (raw.error) {
        message.errorMessage = formatStructuredError(raw.error);
      }
      return message;
    }
    case 'compaction': {
      if (raw.status !== 'completed') return null;
      const message: MessageData = {
        id: raw.id,
        role: 'assistant',
        parts: [{ type: 'text', text: raw.summary }],
        createdAt: raw.time.created,
        summary: true,
      };
      if (raw.model) {
        message.modelID = raw.model.id;
        message.providerID = raw.model.providerID;
      }
      if (typeof raw.cost === 'number') {
        message.cost = raw.cost;
      }
      if (raw.tokens) {
        message.tokens = flattenTokens(raw.tokens);
      }
      return message;
    }
    default:
      return null;
  }
}

function convertAssistantContent(item: AssistantContent): PartData {
  switch (item.type) {
    case 'text':
      return { type: 'text', text: item.text };
    case 'reasoning':
      return { type: 'reasoning', text: item.text };
    case 'tool':
      return {
        type: 'tool',
        tool: item.name,
        state: convertToolState(item.state),
      };
  }
}

function convertToolState(
  state: Extract<AssistantContent, { type: 'tool' }>['state']
): ToolPartData['state'] {
  switch (state.status) {
    case 'streaming':
      // 流式阶段 input 是（可能不完整的）JSON 字符串
      return { status: state.status, input: parseStreamingInput(state.input) };
    case 'running':
      return { status: state.status, input: state.input };
    case 'completed': {
      const result: ToolPartData['state'] = {
        status: state.status,
        input: state.input,
      };
      const output = joinToolContent(state.content);
      if (output !== undefined) {
        result.output = output;
      }
      return result;
    }
    case 'error': {
      const result: ToolPartData['state'] = {
        status: state.status,
        input: state.input,
        error: formatStructuredError(state.error),
      };
      const output = joinToolContent(state.content);
      if (output !== undefined) {
        result.output = output;
      }
      return result;
    }
  }
}

/** 宽化接受 ToolContent 联合（text/file），拼接其中的文本内容 */
function joinToolContent(
  content: readonly { type: string; text?: string }[] | undefined
): string | undefined {
  if (!content) return undefined;
  const texts: string[] = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) {
      texts.push(item.text);
    }
  }
  return texts.length > 0 ? texts.join('\n') : undefined;
}

function parseStreamingInput(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: parsed };
  } catch {
    return { raw };
  }
}

function flattenTokens(tokens: {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}): NonNullable<MessageData['tokens']> {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
  };
}

function formatStructuredError(error: SessionStructuredError): string {
  if (error.message) {
    return `${error.type}: ${error.message}`;
  }
  return error.type;
}

function uriBasename(uri: string): string | undefined {
  const last = uri.split('/').pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
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

export default plugin;
