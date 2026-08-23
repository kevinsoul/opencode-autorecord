import { readdir, readFile, writeFile, appendFile, stat, mkdir, rename, rm, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { version: pluginVersion, repository: pluginRepository } = require('../package.json');
const pluginRepoUrl: string = typeof pluginRepository?.url === 'string'
  ? pluginRepository.url.replace(/^git\+/, '').replace(/\.git$/, '')
  : '';
import { INJECTED_CONTEXT_MARKER, TURN_SEPARATOR } from './types.js';
import {
  saveIndex,
  updateFileIndex,
  removeFileFromIndex,
  getFilesToProcess,
  convertIndexToProjects,
  latestSessionTimeMs,
  validateAndRepairIndexes,
  readStoredIndexVersions,
  INDEX_VERSION,
  PROJECTS_DIR,
  type AutorecordIndex,
  type SessionInfo,
  type ProjectData,
  type ConversationBlock,
  type BlockUsage,
  type SessionStats,
} from './index-manager.js';

// Re-export types for backward compatibility
export type { SessionInfo, ProjectData, ConversationBlock };

// ─── Types ───────────────────────────────────────────────────────────────────

// Note: ConversationBlock is imported from index-manager.js

// ─── Constants ───────────────────────────────────────────────────────────────

const LUCIDE_ICON_MAP = [
  { keywords: ['chat', 'message', 'talk', '对话', '聊天'], icon: 'message-square' },
  { keywords: ['api', 'server', 'backend', '接口', '服务'], icon: 'server' },
  { keywords: ['ui', 'web', 'frontend', 'page', '界面', '页面', '设计', '样式', 'layout'], icon: 'layout' },
  { keywords: ['db', 'database', 'sql', '数据库', '存储'], icon: 'database' },
  { keywords: ['test', 'spec', '测试', 'jest', 'pytest', 'vitest'], icon: 'check-circle' },
  { keywords: ['config', 'setting', 'env', '配置', '设置', 'setup'], icon: 'settings' },
  { keywords: ['git', 'version', '版本', 'commit', 'merge', 'branch'], icon: 'git-branch' },
  { keywords: ['doc', 'readme', '文档', 'wiki', '手册'], icon: 'file-text' },
  { keywords: ['fix', 'bug', '修复', '问题', 'debug', 'error', 'issue'], icon: 'bug' },
  { keywords: ['auth', 'login', 'user', 'pass', '认证', '登录', '权限'], icon: 'shield' },
  { keywords: ['image', 'photo', 'img', '图片', '图像', 'icon'], icon: 'image' },
  { keywords: ['video', 'media', '视频', '音频', 'audio'], icon: 'video' },
  { keywords: ['map', 'geo', 'location', '地图', '位置', '导航'], icon: 'map-pin' },
  { keywords: ['chart', 'graph', 'data', '统计', '图表', 'analytics'], icon: 'bar-chart-3' },
  { keywords: ['search', 'find', '搜索', '查询', 'filter'], icon: 'search' },
  { keywords: ['payment', 'pay', 'order', '支付', '订单', '购买'], icon: 'credit-card' },
  { keywords: ['mail', 'email', '邮件', '邮箱', 'message'], icon: 'mail' },
  { keywords: ['calendar', 'schedule', 'event', '日历', '时间'], icon: 'calendar' },
  { keywords: ['notification', 'push', '通知', '提醒', 'alert'], icon: 'bell' },
  { keywords: ['cloud', 'deploy', 'docker', '云', '部署', 'k8s'], icon: 'cloud' },
  { keywords: ['mobile', 'android', 'ios', 'app', '移动', 'phone'], icon: 'smartphone' },
  { keywords: ['ai', 'ml', 'model', 'gpt', '智能', '模型', 'llm'], icon: 'brain-circuit' },
  { keywords: ['security', 'crypto', 'encrypt', '安全', '加密'], icon: 'lock' },
  { keywords: ['tool', 'cli', 'script', '工具', '脚本', 'command'], icon: 'terminal' },
  { keywords: ['form', 'input', 'field', '表单'], icon: 'form-input' },
  { keywords: ['nav', 'menu', 'route', '导航', '路由', 'router'], icon: 'compass' },
  { keywords: ['upload', 'file', 'download', '文件', 'folder'], icon: 'upload-cloud' },
  { keywords: ['build', 'compile', 'bundle', '打包', '构建', 'webpack', 'vite'], icon: 'package' },
  { keywords: ['css', 'style', 'tailwind', 'sass', 'less', 'stylus'], icon: 'palette' },
  { keywords: ['api', 'rest', 'graphql', 'http', 'endpoint'], icon: 'plug' },
];

const CATEGORY_MAP: Record<string, string[]> = {
  '功能开发': ['feature', 'add', '功能', '添加', '实现', 'create', 'build', 'develop'],
  '界面设计': ['design', 'ui', 'style', '设计', '样式', '布局', 'layout', 'frontend', 'aesthetics', 'css'],
  '问题修复': ['fix', 'bug', '修复', '问题', '排查', 'error', 'debug', 'issue', 'crash'],
  '配置设置': ['config', 'setup', '配置', '设置', 'setting', 'environment', 'env'],
  '版本控制': ['git', 'commit', 'push', 'merge', 'branch', 'pull', '仓库', 'repository'],
  '性能优化': ['optimize', 'performance', '优化', 'perf', 'speed', 'improve', 'fast'],
  '文档编写': ['doc', 'document', 'readme', '文档', 'comment', 'wiki', '手册'],
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  '功能开发': { bg: 'rgba(52,199,89,0.12)', text: '#34C759' },
  '界面设计': { bg: 'rgba(88,86,214,0.12)', text: '#5856D6' },
  '问题修复': { bg: 'rgba(255,59,48,0.12)', text: '#FF3B30' },
  '配置设置': { bg: 'rgba(255,149,0,0.12)', text: '#FF9500' },
  '版本控制': { bg: 'rgba(142,142,147,0.15)', text: '#8E8E93' },
  '性能优化': { bg: 'rgba(0,199,190,0.12)', text: '#00C7BE' },
  '文档编写': { bg: 'rgba(175,82,222,0.12)', text: '#AF52DE' },
  '开发讨论': { bg: 'rgba(199,199,204,0.25)', text: '#8E8E93' },
};

const PROJECT_COLORS = [
  '#007AFF', '#AF52DE', '#FF9500', '#34C759', '#5AC8FA',
  '#FF2D55', '#00C7BE', '#FFCC00', '#5856D6', '#8E8E93',
];

// ─── Logging ─────────────────────────────────────────────────────────────────

async function writeViewLog(logPath: string, message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    const logStat = await stat(logPath).catch(() => null);
    if (logStat && logStat.size > 1024 * 1024) {
      // Truncate if > 1MB: keep last ~100 lines by rewriting
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n').slice(-100);
      await writeFile(logPath, lines.join('\n') + '\n' + line, 'utf-8');
      return;
    }
    await appendFile(logPath, line, 'utf-8');
  } catch {
    // Fallback to console if log write fails
    console.error('[autorecord-view] Log write failed:', line.trim());
  }
}

// ─── Icon & Color Utilities ──────────────────────────────────────────────────

function getProjectColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

function getProjectIcon(name: string): string {
  const lower = name.toLowerCase();
  for (const mapping of LUCIDE_ICON_MAP) {
    if (mapping.keywords.some((k) => lower.includes(k))) {
      return mapping.icon;
    }
  }
  return 'folder';
}

// ─── Session Parsing ─────────────────────────────────────────────────────────

function categorizeSession(title: string): string {
  const lower = title.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((k) => lower.includes(k))) {
      return category;
    }
  }
  return '开发讨论';
}

/**
 * Parse the `📊 key=value ...` usage metadata line emitted by formatter.ts.
 */
function parseAssistantMetaLine(line: string): BlockUsage | null {
  if (!line.startsWith('📊')) return null;

  const usage: BlockUsage = {};
  const pairRe = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(line)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : (match[3] ?? '');
    switch (key) {
      case 'provider':
        usage.providerID = value;
        break;
      case 'model':
        usage.modelID = value;
        break;
      case 'in':
        usage.input = Number(value);
        break;
      case 'out':
        usage.output = Number(value);
        break;
      case 'reason':
        usage.reasoning = Number(value);
        break;
      case 'cacheread':
        usage.cacheRead = Number(value);
        break;
      case 'cachewrite':
        usage.cacheWrite = Number(value);
        break;
      case 'cost':
        usage.cost = Number(value.replace(/^\$/, ''));
        break;
      case 'dur':
        usage.durationMs = Math.round(parseFloat(value) * 1000);
        break;
      case 'finish':
        usage.finish = value;
        break;
      case 'error':
        usage.error = value;
        break;
    }
  }
  // 裸键（无 =）：压缩摘要标记
  if (/\bcompaction\b/.test(line)) {
    usage.compaction = true;
  }

  return Object.keys(usage).length > 0 ? usage : null;
}

const USAGE_TABLE_HEADER =
  '| Model | Calls | Input | Output | Reasoning | Cache Read | Cache Write | Cost ($) |';
const USAGE_TABLE_ROW_RE =
  /^\| (.+?) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| ([\d.]+) \|$/;

/**
 * Parse session-level usage statistics from markdown header tables
 * (one table per session block; models are merged across blocks).
 * Returns null for files without statistics tables.
 */
function parseSessionStats(content: string): SessionStats | null {
  const lines = content.split('\n');
  const stats: SessionStats = { byModel: {}, totalCost: 0, totalTokens: 0 };
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== USAGE_TABLE_HEADER) continue;
    found = true;

    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j].trim();
      const m = raw.match(USAGE_TABLE_ROW_RE);
      if (!m) {
        // 表头与数据行之间的分隔行（|---|...）继续读，其余行视为表格结束
        if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(raw)) continue;
        break;
      }
      if (m[1].trim() === '**Total**') break;

      const model = m[1].trim();
      let row = stats.byModel[model];
      if (!row) {
        row = { calls: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        stats.byModel[model] = row;
      }
      row.calls += Number(m[2]);
      row.input += Number(m[3]);
      row.output += Number(m[4]);
      row.reasoning += Number(m[5]);
      row.cacheRead += Number(m[6]);
      row.cacheWrite += Number(m[7]);
      row.cost += Number(m[8]);
      i = j;
    }
  }

  if (!found) return null;

  for (const row of Object.values(stats.byModel)) {
    stats.totalCost += row.cost;
    stats.totalTokens += row.input + row.output + row.reasoning;
  }
  return stats;
}

// ─── Session Block Splitting & Turn Boundaries ───────────────────────────────

const SESSION_BLOCK_LINE_RE = /^<!-- AUTORECORD-SESSION-BLOCK: [^>]+ -->$/;
const MAIN_USER_HEADING_RE = /^## 👤 User/;
const ASSISTANT_HEADING_RE = /^### 🤖 Assistant/;
/** 捕获 Assistant 标题后缀的首个标签（如 `[分析过程]`）；旧文件无后缀时不匹配。
 *  兼容 formatter 的多标签拼接（` · 📦 Compaction Summary / 压缩摘要`），只取首个 */
const ASSISTANT_TAG_CAPTURE_RE = /^### 🤖 Assistant\s+\[([^\]]+?)\]/;
const REASONING_HEADER_PREFIX = '💭 **Reasoning:**';
/** formatter 写出的步骤标记均为独占一行的裸标记；必须整行匹配，
 *  否则会误命中引用源码中的子串（如 `includes('[step-end')` 的代码行） */
const STEP_START_LINE_RE = /^\[step-start\]$/;
const STEP_END_LINE_RE = /^\[step-end\]$/;
const STEP_FINISH_LINE_RE = /^\[step-finish\]$/;
// 步骤组 id 计数器：同一条 ### 🤖 Assistant 消息内的全部 block 共享同一 stepId
let assistantStepIdCounter = 0;

type AssistantStepTag = NonNullable<ConversationBlock['stepTag']>;
type AssistantBlockKind = NonNullable<ConversationBlock['kind']>;

/** 从标题行解析步骤标签；无法识别的后缀（如纯 summary 标记）返回 undefined，由内容推导兜底 */
function parseAssistantStepTag(line: string): AssistantStepTag | undefined {
  const m = line.match(ASSISTANT_TAG_CAPTURE_RE);
  if (!m) return undefined;
  const first = m[1].split(' · ')[0].trim();
  if (first === '分析过程' || first === '执行过程' || first === '回复内容') {
    return first;
  }
  return undefined;
}

/**
 * 判定/拆分 assistant 文本块：
 * - 新格式：reasoning 有独立 `[step-end]` 边界，块内只有 💭 头 + `<details>` → 单 reasoning 块
 * - 旧格式：reasoning 与正文合并在一个块（`*[step-start part]*`…`*[step-finish part]*` 区间），
 *   按 `</details>` 所在行拆成 reasoning + reply 两块；无剩余正文则不拆
 * 返回值保持原文顺序，供调用方按序 push（共享同一 stepId）
 */
function splitAssistantMessageBlock(content: string): Array<{ content: string; kind: AssistantBlockKind }> {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith(REASONING_HEADER_PREFIX)) {
    return [{ content: trimmed, kind: 'reply' }];
  }

  const lines = trimmed.split('\n');
  let detailsEndIdx = -1;
  for (let li = 0; li < lines.length; li++) {
    if (lines[li].includes('</details>')) {
      detailsEndIdx = li;
      break;
    }
  }
  if (detailsEndIdx === -1 || detailsEndIdx === lines.length - 1) {
    return [{ content: trimmed, kind: 'reasoning' }];
  }

  const head = lines.slice(0, detailsEndIdx + 1).join('\n').trim();
  const tailLines = lines.slice(detailsEndIdx + 1);
  // 跳过紧随的空行，剩余内容视为回复正文；仅空白则不产生 reply 块
  while (tailLines.length > 0 && !tailLines[0].trim()) {
    tailLines.shift();
  }
  const tail = tailLines.join('\n').trim();
  const result: Array<{ content: string; kind: AssistantBlockKind }> = [{ content: head, kind: 'reasoning' }];
  if (tail && !tail.startsWith(REASONING_HEADER_PREFIX)) {
    result.push({ content: tail, kind: 'reply' });
  }
  return result;
}
// 子会话区/文件头边界。刻意不含裸 `---`：正文（含代码围栏）中可能出现分隔线，不能作为终止符
const CHILD_SECTION_BOUNDARY_RE =
  /^(### 📦 Subagent:|## Child Sessions$|# Topic:|<!-- AUTORECORD-SESSION-BLOCK:)/;

function isConversationBoundary(line: string): boolean {
  return (
    ASSISTANT_HEADING_RE.test(line) ||
    MAIN_USER_HEADING_RE.test(line) ||
    CHILD_SECTION_BOUNDARY_RE.test(line)
  );
}

/**
 * 按 `<!-- AUTORECORD-SESSION-BLOCK -->` 注释把 topic 文件切成独立会话块。
 * 一个 md 文件可含同一主题的多次会话，必须逐块解析，轮次编号才不会跨块串扰；
 * 注释之前的文件头（# Topic / ---）被丢弃。无注释的旧文件整文件视为单块。
 */
export function splitSessionBlocks(content: string): string[] {
  const lines = content.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SESSION_BLOCK_LINE_RE.test(lines[i])) starts.push(i);
  }
  if (starts.length === 0) return [content];

  const chunks: string[] = [];
  for (let c = 0; c < starts.length; c++) {
    const from = starts[c] + 1;
    const to = c + 1 < starts.length ? starts[c + 1] : lines.length;
    chunks.push(lines.slice(from, to).join('\n'));
  }
  return chunks;
}

interface UserSection {
  timestamp: string;
  bodyLines: string[];
  nextIndex: number;
}

/** 收集主会话级 User 消息正文，直到下一个精确对话边界；代码围栏内的行不做边界判定 */
function collectUserSection(lines: string[], startIndex: number): UserSection {
  let timestamp = '';
  let i = startIndex + 1;
  if (i < lines.length) {
    const timeMatch = lines[i].match(/\*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\*/);
    if (timeMatch) {
      timestamp = timeMatch[1];
      i += 1;
    }
  }

  const bodyLines: string[] = [];
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      bodyLines.push(line);
      i += 1;
      continue;
    }
    if (!inFence && isConversationBoundary(line)) break;
    bodyLines.push(line);
    i += 1;
  }

  return { timestamp, bodyLines, nextIndex: i };
}

/**
 * fallback 场景下判定 user 消息是否为纯系统注入（synthetic-only）：
 * 正文首个非空行即注入标记。混合消息（注入 + 真实文本并存）按真实输入处理，
 * 与 formatter 的 isRealUserInput 语义保持一致。
 */
function isSyntheticOnlyUserBody(bodyLines: string[]): boolean {
  for (const raw of bodyLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    return trimmed === INJECTED_CONTEXT_MARKER;
  }
  return false;
}

/**
 * 解析一条 Assistant 消息体（自标题行起），产出共享同一 stepId 的 message/tool 块序列。
 * stepId/stepTag/kind/usage 在此确定；role/turn 归属由调用方决定（主对话挂当前轮次，
 * 子会话内的消息不挂轮次）。extraBoundaryRe 为额外终止边界（子会话场景用于停在
 * `#### 👤 User` / `#### 🤖 Assistant` 消息标题）；围栏内不判界，与主边界一致。
 */
function collectAssistantSection(
  lines: string[],
  headingLineIndex: number,
  extraBoundaryRe?: RegExp,
): { blocks: ConversationBlock[]; nextIndex: number } {
  const headingLine = lines[headingLineIndex];
  let timestamp = '';
  let i = headingLineIndex + 1;
  if (i < lines.length) {
    const timeMatch = lines[i].match(/\*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\*/);
    if (timeMatch) {
      timestamp = timeMatch[1];
      i += 1;
    }
  }

  // 步骤组：标题后缀标签优先，缺省时 section 结束后按内容推导
  const headingStepTag = parseAssistantStepTag(headingLine);
  const stepId = ++assistantStepIdCounter;

  const blocks: ConversationBlock[] = [];

  /** 按拆分结果 push assistant 文本块（reasoning/reply 共享同一 stepId） */
  const pushAssistantText = (rawContent: string): void => {
    for (const seg of splitAssistantMessageBlock(rawContent)) {
      blocks.push({ type: 'message', stepId, timestamp, content: seg.content, kind: seg.kind });
    }
  };

  let sectionMeta: BlockUsage | null = null;
  const messageLines: string[] = [];
  let inToolBlock = false;
  let toolBlock: ConversationBlock | null = null;
  let inStepBlock = false;
  let stepLines: string[] = [];
  // 代码围栏状态：围栏内是引用的源码/输出原文，其中的字面量标记行与标题行
  // 不构成任何结构边界（工具块的围栏由下方 Input/Output 提取逻辑自行消费）
  let inFence = false;

  while (i < lines.length) {
    const currentLine = lines[i];

    if (!inToolBlock && currentLine.trimStart().startsWith('```')) {
      inFence = !inFence;
    }

    // 精确边界锚定（不用裸 --- ：工具输出/正文中可能出现分隔线）；围栏内不判界
    if (!inFence && isConversationBoundary(currentLine)) {
      break;
    }
    if (!inFence && extraBoundaryRe?.test(currentLine)) {
      break;
    }

    // 围栏内：纯内容收集，跳过全部结构判定
    if (inFence && !inToolBlock) {
      if (inStepBlock) {
        if (currentLine.trim() || stepLines.length > 0) {
          stepLines.push(currentLine);
        }
      } else {
        if (currentLine.trim() || messageLines.length > 0) {
          messageLines.push(currentLine);
        }
      }
      i += 1;
      continue;
    }

    // Usage metadata line (📊 key=value ...), not part of the visible content
    if (!inToolBlock && !inStepBlock && currentLine.startsWith('📊')) {
      const parsed = parseAssistantMetaLine(currentLine);
      if (parsed) {
        sectionMeta = parsed;
        i += 1;
        continue;
      }
    }

    // Check for tool block start（锚定行首：引用正文中出现同款文本不算工具块）
    const toolMatch = currentLine.match(/^#### 🔧 Tool:\s*(\w+)/);
    if (toolMatch) {
      // Save previous message content if any
      if (messageLines.length > 0 && !inToolBlock && !inStepBlock) {
        const msgContent = messageLines.join('\n').trim();
        if (msgContent) {
          pushAssistantText(msgContent);
        }
        messageLines.length = 0;
      }

      inToolBlock = true;
      toolBlock = {
        type: 'tool',
        timestamp,
        toolName: toolMatch[1],
        toolStatus: '',
        toolInput: '',
        toolOutput: '',
      };
      i += 1;
      continue;
    }

    // Check for step finish: ends tool block and/or step block
    if (STEP_FINISH_LINE_RE.test(currentLine)) {
      // Close step block first if still open (old-format files interleave
      // reasoning and tools inside one [step-start]…[step-finish] range;
      // saving step content first keeps block order aligned with the source)
      if (inStepBlock) {
        const stepContent = stepLines.join('\n').trim();
        if (stepContent) {
          pushAssistantText(stepContent);
        }
        inStepBlock = false;
        stepLines = [];
      }

      // Save tool block
      if (toolBlock) {
        blocks.push(toolBlock);
      }
      inToolBlock = false;
      toolBlock = null;
      i += 1;
      continue;
    }

    // Check for step block start: [step-start]
    if (STEP_START_LINE_RE.test(currentLine)) {
      // 连续两个 [step-start]（历史脏数据）：先落盘已积累的步骤内容再开新块，
      // 避免两段 reasoning 被合并进同一块
      if (inStepBlock) {
        const prevStep = stepLines.join('\n').trim();
        if (prevStep) {
          pushAssistantText(prevStep);
        }
      }

      // Save previous message content as question if any
      if (messageLines.length > 0 && !inToolBlock && !inStepBlock) {
        const msgContent = messageLines.join('\n').trim();
        if (msgContent) {
          pushAssistantText(msgContent);
        }
        messageLines.length = 0;
      }

      inStepBlock = true;
      stepLines = [];
      i += 1;
      continue;
    }

    // Check for step block end: [step-end]
    if (STEP_END_LINE_RE.test(currentLine)) {
      // Save step block as assistant answer
      if (inStepBlock) {
        const stepContent = stepLines.join('\n').trim();
        if (stepContent) {
          pushAssistantText(stepContent);
        }
        inStepBlock = false;
        stepLines = [];
      }
      // 状态机外的孤儿 [step-end]（历史脏数据）直接丢弃，
      // 不落入正文形成"[step-end]"垃圾卡片
      i += 1;
      continue;
    }

    // Collect content
    if (inToolBlock) {
      // Extract status
      const statusMatch = currentLine.match(/\*\*Status:\*\*\s*(\w+)/);
      if (statusMatch && toolBlock) {
        toolBlock.toolStatus = statusMatch[1];
      }

      // Extract input
      if (currentLine.includes('**Input:**')) {
        i += 1;
        // Skip ```json or ``` line
        if (i < lines.length && lines[i].startsWith('```')) {
          i += 1;
        }
        const inputLines: string[] = [];
        while (i < lines.length && !lines[i].startsWith('```')) {
          inputLines.push(lines[i]);
          i += 1;
        }
        if (toolBlock) {
          toolBlock.toolInput = inputLines.join('\n').trim();
        }
        continue;
      }

      // Extract output
      if (currentLine.includes('**Output:**')) {
        i += 1;
        // Skip ``` line
        if (i < lines.length && lines[i].startsWith('```')) {
          i += 1;
        }
        const outputLines: string[] = [];
        while (i < lines.length && !lines[i].startsWith('```')) {
          outputLines.push(lines[i]);
          i += 1;
        }
        if (toolBlock) {
          toolBlock.toolOutput = outputLines.join('\n').trim();
        }
        continue;
      }

      // Collect other tool block content (simple text output without **Output:** label)
      if (currentLine.trim() && !currentLine.startsWith('```')) {
        if (!['**Status:**', '**Input:**', '**Output:**'].some((k) => currentLine.includes(k))) {
          if (toolBlock && !toolBlock.toolOutput && !toolBlock.toolInput) {
            if (toolBlock.toolOutput === '') {
              toolBlock.toolOutput = currentLine.trim();
            } else {
              toolBlock.toolOutput += '\n' + currentLine.trim();
            }
          }
        }
      }
    } else if (inStepBlock) {
      // Collect step block content (AI thinking and answer)
      if (currentLine.trim() || stepLines.length > 0) {
        stepLines.push(currentLine);
      }
    } else {
      // Regular message content (question text after Assistant timestamp)
      if (currentLine.trim() || messageLines.length > 0) {
        messageLines.push(currentLine);
      }
    }

    i += 1;
  }

  // Save remaining message content
  if (messageLines.length > 0 && !inToolBlock && !inStepBlock) {
    const msgContent = messageLines.join('\n').trim();
    if (msgContent) {
      pushAssistantText(msgContent);
    }
  }

  // Save remaining step block
  if (stepLines.length > 0 && inStepBlock) {
    const stepContent = stepLines.join('\n').trim();
    if (stepContent) {
      pushAssistantText(stepContent);
    }
  }

  // Save remaining tool block
  if (toolBlock) {
    blocks.push(toolBlock);
  }

  // Attach usage metadata to the first message block of this section
  if (sectionMeta) {
    for (const b of blocks) {
      if (b.type === 'message') {
        b.usage = sectionMeta;
        break;
      }
    }
  }

  // 标题未带标签时按内容推导（reasoning > tool > text，与 formatter getAssistantTag 一致）
  let hasReasoningBlock = false;
  let hasToolBlock = false;
  for (const b of blocks) {
    if (b.type === 'tool') {
      hasToolBlock = true;
    } else if (b.kind === 'reasoning') {
      hasReasoningBlock = true;
    }
  }
  const sectionStepTag: AssistantStepTag =
    headingStepTag ?? (hasReasoningBlock ? '分析过程' : hasToolBlock ? '执行过程' : '回复内容');
  for (const b of blocks) {
    b.stepId = stepId;
    b.stepTag = sectionStepTag;
  }

  return { blocks, nextIndex: i };
}

/** formatter formatChildSession 写出的子会话级消息标题（4 级，与主会话 2/3 级不冲突） */
const CHILD_MESSAGE_HEADING_RE = /^#### (?:👤 User|🤖 Assistant)/;

/**
 * 解析 `### 📦 Subagent:` 开头的子会话段落为 child-session 容器块。
 * 子会话无轮次概念，内部消息平铺进 children：user 正文用围栏保护收集，
 * assistant 体复用 collectAssistantSection（以子会话级消息标题为额外边界，
 * 遇到下一个子会话/区块边界则交还上层）。
 */
function collectChildSessionSection(
  lines: string[],
  headingLineIndex: number,
  title: string,
): { block: ConversationBlock; nextIndex: number } {
  let i = headingLineIndex + 1;
  let startedAt = '';
  if (i < lines.length) {
    const startedMatch = lines[i].match(/^\*Started:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\*/);
    if (startedMatch) {
      startedAt = startedMatch[1];
      i += 1;
    }
  }

  const children: ConversationBlock[] = [];
  while (i < lines.length) {
    const line = lines[i];

    // 下一个子会话或区块级边界：交还上层处理
    if (CHILD_SECTION_BOUNDARY_RE.test(line)) break;

    if (/^#### 👤 User/.test(line)) {
      let timestamp = '';
      let j = i + 1;
      if (j < lines.length) {
        const timeMatch = lines[j].match(/\*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\*/);
        if (timeMatch) {
          timestamp = timeMatch[1];
          j += 1;
        }
      }

      const bodyLines: string[] = [];
      let inFence = false;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trimStart().startsWith('```')) {
          inFence = !inFence;
          bodyLines.push(l);
          j += 1;
          continue;
        }
        if (!inFence && (CHILD_MESSAGE_HEADING_RE.test(l) || CHILD_SECTION_BOUNDARY_RE.test(l))) break;
        bodyLines.push(l);
        j += 1;
      }

      const content = bodyLines.join('\n').trim();
      if (content) {
        children.push({ type: 'message', role: 'user', timestamp, content });
      }
      i = j;
      continue;
    }

    if (/^#### 🤖 Assistant/.test(line)) {
      const res = collectAssistantSection(lines, i, CHILD_MESSAGE_HEADING_RE);
      for (const b of res.blocks) {
        b.role = 'assistant';
      }
      children.push(...res.blocks);
      i = res.nextIndex;
      continue;
    }

    i += 1;
  }

  return {
    block: { type: 'child-session', timestamp: startedAt, childTitle: title, children },
    nextIndex: i,
  };
}

/**
 * 解析单个 session block 内的对话，按主会话级用户提问划分轮次。
 * - `<!-- AUTORECORD-TURN -->` 分隔符：新轮次起点（formatter 对每条真实输入写入）
 * - 旧格式 fallback：以 `## 👤 User` 标题为等价边界，但 synthetic-only
 *   注入消息不开新轮次，归入当前轮次（turn=0 表示任何轮次之前的前置内容）
 * - `### 📦 Subagent:` 段落恢复为 child-session 容器块，归属当前轮次
 */
export function parseBlockConversation(blockContent: string): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  const lines = blockContent.split('\n');
  let i = 0;
  let currentTurn = 0;
  let sawTurnSeparator = false;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === TURN_SEPARATOR) {
      sawTurnSeparator = true;
      i += 1;
      continue;
    }

    // Detect assistant message block
    if (ASSISTANT_HEADING_RE.test(line)) {
      const res = collectAssistantSection(lines, i);
      // 本节产出的全部 block 归属当前轮次（assistant 角色）
      for (const b of res.blocks) {
        b.role = 'assistant';
        if (currentTurn > 0) b.turn = currentTurn;
      }
      blocks.push(...res.blocks);
      i = res.nextIndex;
      continue;
    }

    // 子会话（subagent）段落：恢复为结构化 child-session 容器块，归属当前轮次
    const childHeadingMatch = line.match(/^### 📦 Subagent:\s*(.+?)\s*$/);
    if (childHeadingMatch) {
      const res = collectChildSessionSection(lines, i, childHeadingMatch[1]);
      if (currentTurn > 0) res.block.turn = currentTurn;
      blocks.push(res.block);
      i = res.nextIndex;
      continue;
    }

    // 主会话级 User 消息：轮次边界判定
    if (MAIN_USER_HEADING_RE.test(line)) {
      const section = collectUserSection(lines, i);
      i = section.nextIndex;

      let turn: number | undefined;
      if (sawTurnSeparator || !isSyntheticOnlyUserBody(section.bodyLines)) {
        currentTurn += 1;
        turn = currentTurn;
      } else {
        turn = currentTurn > 0 ? currentTurn : undefined;
      }
      sawTurnSeparator = false;

      const content = section.bodyLines.join('\n').trim();
      if (content) {
        blocks.push({
          type: 'message',
          role: 'user',
          turn,
          timestamp: section.timestamp,
          content,
        });
      }
      continue;
    }

    i += 1;
  }

  return blocks;
}

/**
 * 以文件为单位解析对话。先按 SESSION-BLOCK 注释切成独立会话块再逐块解析，
 * 保证同一 topic 文件中多个会话各自从第 1 轮编号、互不串扰。
 */
export function extractFullConversation(content: string): ConversationBlock[] {
  return splitSessionBlocks(content).flatMap(parseBlockConversation);
}

function extractSessionInfo(filePath: string, content: string): SessionInfo | null {
  const topicMatch = content.match(/# Topic:\s*(.+)/);
  const sessionMatch = content.match(/^Session:\s*(.+)/m);
  const oldSessionMatch = content.match(/# Session:\s*(.+)/);
  const title = topicMatch
    ? topicMatch[1].trim()
    : sessionMatch
      ? sessionMatch[1].trim()
      : oldSessionMatch
        ? oldSessionMatch[1].trim()
        : 'Unknown Session';

  // 锚定行首匹配，避免命中消息内容（如单行 JSON 工具输入）中的模板文本
  const dateMatch = content.match(/^\*\*Created:\*\*\s*(.+)/m);
  const date = dateMatch ? dateMatch[1].trim() : 'Unknown Date';

  const blocks = extractFullConversation(content);

  // Extract user request from the first real user message (skip synthetic-only injections)
  let userRequest = '无明确请求';
  const firstUserMessage = blocks.find((b) => b.role === 'user' && b.content);
  if (firstUserMessage?.content) {
    const realLine = firstUserMessage.content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith(INJECTED_CONTEXT_MARKER));
    if (realLine) {
      const cleaned = realLine
        .replace(/\[.*?\]/g, '')
        .replace(/<.*?>/g, '')
        .trim();
      userRequest = cleaned.length > 200 ? cleaned.substring(0, 200) + '...' : (cleaned || '无明确请求');
    }
  }

  return {
    title,
    date,
    userRequest,
    category: categorizeSession(title),
    filename: basename(filePath),
    conversationBlocks: blocks,
    stats: parseSessionStats(content) ?? undefined,
  };
}

// ─── Project Scanning ────────────────────────────────────────────────────────

// Helper functions for incremental scanning
async function listProjects(baseDir: string): Promise<Array<{ name: string; dir: string }>> {
  const entries = await readdir(baseDir, { withFileTypes: true });
  const projects: Array<{ name: string; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__pycache__' || entry.name === PROJECTS_DIR) {
      continue;
    }
    projects.push({ name: entry.name, dir: join(baseDir, entry.name) });
  }

  return projects;
}

async function listMdFiles(projectDir: string): Promise<string[]> {
  const files = await readdir(projectDir, { withFileTypes: true });
  return files
    .filter((f) => f.isFile() && f.name.endsWith('.md'))
    .map((f) => join(projectDir, f.name));
}

async function scanProjectsIncremental(
  baseDir: string,
  index: AutorecordIndex
): Promise<{ projects: ProjectData[]; unchangedProjects: string[] }> {
  const { newFiles, modifiedFiles, deletedFiles, unchangedProjects } = await getFilesToProcess(
    index,
    baseDir,
    listProjects,
    listMdFiles
  );

  // Remove deleted files from index
  for (const { filePath, projectName } of deletedFiles) {
    removeFileFromIndex(index, projectName, filePath);
  }

  // Process new and modified files
  const filesToProcess = [...newFiles, ...modifiedFiles];
  for (const { filePath, projectName, stat: fileStat } of filesToProcess) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const info = extractSessionInfo(filePath, content);
      if (info) {
        updateFileIndex(index, projectName, filePath, fileStat, info);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Update index timestamp
  index.primary.lastFullScan = Date.now();

  // Convert index to projects format
  return { projects: convertIndexToProjects(index), unchangedProjects };
}

// Fallback full scan (used when no index exists or for periodic rebuilds)
async function scanProjectsFull(baseDir: string): Promise<ProjectData[]> {
  const projects: ProjectData[] = [];
  const projectList = await listProjects(baseDir);

  for (const project of projectList) {
    const mdFiles = await listMdFiles(project.dir);
    if (mdFiles.length === 0) continue;

    const sessions: SessionInfo[] = [];
    let fallbackMtime = 0;

    for (const filePath of mdFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const info = extractSessionInfo(filePath, content);
        if (info) {
          sessions.push(info);
        }
        const s = await stat(filePath);
        if (s.mtimeMs > fallbackMtime) fallbackMtime = s.mtimeMs;
      } catch {
        // Skip unreadable files
      }
    }

    if (sessions.length > 0) {
      sessions.sort((a, b) => {
        const da = parseDate(a.date);
        const db = parseDate(b.date);
        return db.getTime() - da.getTime();
      });
      projects.push({
        name: project.name,
        sessions,
        count: sessions.length,
        lastModified: latestSessionTimeMs(sessions) ?? fallbackMtime,
      });
    }
  }

  projects.sort((a, b) => b.lastModified - a.lastModified);
  return projects;
}

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

// ─── HTML Overview Generator ─────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return dateStr.includes(' ') ? dateStr.split(' ')[0] : dateStr;
}

function formatTimestamp(ts: number): string {
  if (ts === 0) return '未知';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function computeCategoryStats(projects: ProjectData[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const p of projects) {
    for (const s of p.sessions) {
      stats[s.category] = (stats[s.category] || 0) + 1;
    }
  }
  return stats;
}

function buildDashboard(stats: Record<string, number>, total: number): string {
  const order = ['功能开发', '界面设计', '问题修复', '配置设置', '版本控制', '性能优化', '文档编写', '开发讨论'];
  const cards: string[] = [];

  for (const cat of order) {
    const count = stats[cat] || 0;
    if (count === 0) continue;
    const pct = Math.round((count / total) * 100);
    const color = CATEGORY_COLORS[cat]?.text || '#8E8E93';
    cards.push(`
      <div class="dashboard-card">
        <div class="dashboard-count" style="color:${color}">${count}</div>
        <div class="dashboard-label">${cat}</div>
        <div class="dashboard-bar"><div class="dashboard-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="dashboard-percentage">${pct}%</div>
      </div>`);
  }

  if (cards.length === 0) return '';
  return `<div class="dashboard-section"><div class="dashboard-grid">${cards.join('')}</div></div>`;
}

// ─── HTML 页面生成（二级索引架构：主索引页 + 项目页）──────────────────────────

// 项目页内联完整对话的会话数上限（超出部分仅保留元数据，完整内容见 md 文件）
const DETAIL_SESSION_LIMIT = 30;

// 跳转链接辅助
function projectPageHref(name: string): string {
  return `${PROJECTS_DIR}/${encodeURIComponent(name)}.html`;
}

function sessionAnchor(filename: string): string {
  return `#session-${encodeURIComponent(filename)}`;
}

// ─── 公共 CSS（主索引页与项目页共用）─────────────────────────────────────────

const COMMON_CSS = `
    :root {
      --font-display: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --font-text: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --nav-height: 68px;
    }
    /* ── 双主题：默认暗色（与官网 claode.cn 一致的暖黑 + 柠檬黄）── */
    [data-theme="dark"] {
      --bg: hsl(0, 9%, 7%);
      --bg-weak: hsl(0, 6%, 10%);
      --bg-strong: hsl(0, 5%, 12%);
      --surface: hsl(0, 6%, 10%);
      --text-strong: hsl(0, 15%, 94%);
      --text: hsl(0, 4%, 71%);
      --text-weak: hsl(0, 1%, 60%);
      --text-weaker: hsl(0, 3%, 28%);
      --border: hsl(0, 3%, 28%);
      --border-weak: hsl(0, 4%, 23%);
      --accent: hsl(62, 100%, 90%);
      --accent-weak: hsl(60, 20%, 8%);
      --accent-text: hsl(0, 9%, 7%);
      --code-bg: hsl(0, 6%, 9%);
      --code-header-bg: hsl(0, 5%, 14%);
      --code-border: hsl(0, 4%, 23%);
      --shadow: 0 20px 60px hsla(0, 100%, 0%, 0.5);
      --card-shadow: 0 2px 12px hsla(0, 100%, 0%, 0.35);
      --hover-shadow: 0 12px 40px hsla(0, 100%, 0%, 0.45);
      --step-analysis-text: hsl(262, 85%, 78%);
      --step-execution-text: hsl(28, 95%, 66%);
      --step-reply-text: hsl(140, 55%, 58%);
    }
    [data-theme="light"] {
      --bg: hsl(0, 20%, 99%);
      --bg-weak: hsl(0, 8%, 97%);
      --bg-strong: hsl(0, 8%, 94%);
      --surface: #FFFFFF;
      --text-strong: hsl(0, 5%, 12%);
      --text: hsl(0, 1%, 39%);
      --text-weak: hsl(0, 2%, 45%);
      --text-weaker: hsl(30, 2%, 60%);
      --border: hsl(30, 2%, 81%);
      --border-weak: hsla(0, 100%, 3%, 0.12);
      --accent: hsl(62, 70%, 42%);
      --accent-weak: hsl(64, 74%, 92%);
      --accent-text: #ffffff;
      --code-bg: #1d1f21;
      --code-header-bg: #2d2f33;
      --code-border: #3a3d42;
      --shadow: 0 20px 60px hsla(0, 50%, 10%, 0.08);
      --card-shadow: 0 2px 12px hsla(0, 50%, 10%, 0.05);
      --hover-shadow: 0 12px 40px hsla(0, 50%, 10%, 0.10);
      --step-analysis-text: #6941C6;
      --step-execution-text: #B54708;
      --step-reply-text: #1F9D41;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ::selection { background: var(--accent); color: var(--accent-text); }
    a { color: inherit; text-decoration: none; }
    body {
      font-family: var(--font-text);
      background: var(--bg);
      color: var(--text-strong);
      line-height: 1.47059;
      -webkit-font-smoothing: antialiased;
      transition: background 0.35s ease, color 0.35s ease;
    }
    .nav-bar {
      position: sticky; top: 0; z-index: 100;
      height: var(--nav-height);
      background: color-mix(in srgb, var(--bg) 78%, transparent);
      backdrop-filter: saturate(180%) blur(20px);
      border-bottom: 1px solid var(--border-weak);
      padding: 16px 32px;
    }
    .nav-content {
      max-width: 1200px; margin: 0 auto;
      display: flex; justify-content: space-between; align-items: center; gap: 24px;
    }
    .nav-left { display: flex; align-items: center; gap: 32px; flex: 1; }
    .nav-title {
      font-family: var(--font-display); font-size: 21px; font-weight: 600;
      letter-spacing: -0.021em; flex-shrink: 0; color: var(--text-strong);
    }
    .nav-version {
      font-size: 12px; font-weight: 500; color: var(--text-weak);
      background: var(--bg-strong); padding: 2px 8px; border-radius: 9999px;
      vertical-align: middle; margin-left: 8px;
    }
    .nav-gen-time {
      font-size: 13px; font-weight: 600; color: var(--accent);
      margin-left: 16px; flex-shrink: 0;
    }
    .nav-search-container { position: relative; max-width: 400px; width: 100%; }
    .nav-search-box {
      width: 100%; padding: 10px 16px 10px 40px; font-size: 15px;
      background: var(--surface); color: var(--text-strong);
      border: 1px solid var(--border-weak);
      border-radius: 9999px; outline: none; transition: all 0.2s ease;
    }
    .nav-search-box::placeholder { color: var(--text-weaker); }
    .nav-search-box:focus { border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent); }
    .nav-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-weak); pointer-events: none; }
    .nav-stats { display: flex; gap: 24px; flex-shrink: 0; align-items: center; }
    .nav-stat-value { font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--accent); }
    .nav-stat-label { font-size: 11px; color: var(--text-weak); text-transform: uppercase; letter-spacing: 0.05em; }
    .theme-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; flex-shrink: 0;
      border: 1px solid var(--border-weak); border-radius: 9999px;
      background: var(--surface); color: var(--text-weak);
      cursor: pointer; transition: color 0.2s, border-color 0.2s;
    }
    .theme-toggle:hover { color: var(--text-strong); border-color: var(--border); }
    .theme-toggle .icon-moon { display: none; }
    [data-theme="light"] .theme-toggle .icon-sun { display: none; }
    [data-theme="light"] .theme-toggle .icon-moon { display: block; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 14px; font-weight: 500; color: var(--text-weaker);
      background: var(--surface); border: 1px solid var(--border-weak);
      border-radius: 9999px; padding: 8px 16px;
      transition: all 0.25s ease; flex-shrink: 0;
    }
    .back-link:hover { color: var(--accent); border-color: var(--accent); }
    @media (max-width: 768px) {
      .nav-content { flex-wrap: wrap; gap: 16px; }
      .nav-left { width: 100%; gap: 16px; }
      .nav-search-container { max-width: none; order: 3; }
      .nav-stats { margin-left: auto; }
    }
    .dashboard-section { padding: 0 0 24px; }
    .dashboard-grid { display: flex; flex-wrap: nowrap; gap: 12px; overflow-x: auto; }
    .dashboard-card {
      background: var(--surface);
      border-radius: 16px; padding: 16px 8px; border: 1px solid var(--border-weak);
      box-shadow: var(--card-shadow); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column; align-items: center; text-align: center;
      flex: 1 1 0; min-width: 80px; max-width: 200px;
    }
    .dashboard-card:hover { transform: translateY(-3px); box-shadow: var(--hover-shadow); border-color: var(--border); }
    .dashboard-count { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.021em; margin-bottom: 2px; color: var(--text-strong); }
    .dashboard-label { font-size: 12px; font-weight: 500; color: var(--text-weaker); margin-bottom: 10px; white-space: nowrap; }
    .dashboard-bar { width: 100%; max-width: 80px; height: 4px; background: var(--border-weak); border-radius: 9999px; overflow: hidden; margin-bottom: 6px; }
    .dashboard-bar-fill { height: 100%; border-radius: 9999px; transition: width 0.8s cubic-bezier(0.4,0,0.2,1); }
    .dashboard-percentage { font-size: 11px; font-weight: 600; color: var(--text-weak); }
    @media (max-width: 768px) {
      .dashboard-section { padding: 0 0 16px; }
      .dashboard-grid { gap: 8px; }
      .dashboard-card { padding: 12px 6px; border-radius: 12px; min-width: 64px; }
      .dashboard-count { font-size: 22px; }
      .dashboard-label { font-size: 10px; }
      .dashboard-bar { max-width: 50px; }
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px 48px 64px; display: flex; gap: 24px; align-items: flex-start; }
    .sidebar {
      width: 260px; flex-shrink: 0; position: fixed;
      top: var(--nav-height); left: max(48px, calc(50% - 700px + 48px));
      background: var(--surface); border: 1px solid var(--border-weak);
      border-radius: 16px; padding: 16px 12px;
      box-shadow: var(--card-shadow);
      max-height: calc(100vh - var(--nav-height) - 32px); overflow-y: auto;
    }
    .sidebar-title { font-size: 12px; font-weight: 600; color: var(--text-weak); text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 8px 12px; }
    .sidebar-list { display: flex; flex-direction: column; gap: 2px; }
    .sidebar-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border-radius: 10px; transition: background 0.2s ease; font-size: 14px;
    }
    .sidebar-item:hover { background: var(--bg-weak); }
    .sidebar-item.hidden { display: none; }
    .sidebar-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; align-self: flex-start; margin-top: 5px; }
    .sidebar-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sidebar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-strong); font-weight: 500; }
    .sidebar-time { font-size: 11px; color: var(--text-weak); }
    .sidebar-count { font-size: 12px; color: var(--text-weak); background: var(--bg-strong); padding: 2px 8px; border-radius: 9999px; flex-shrink: 0; }
    .main-content { flex: 1; min-width: 0; margin-left: 284px; }
    .view-switcher { display: flex; gap: 12px; margin-bottom: 32px; justify-content: center; }
    .view-btn {
      display: flex; align-items: center; gap: 8px; padding: 10px 20px;
      font-family: var(--font-text); font-size: 14px; font-weight: 500;
      color: var(--text-weaker); background: var(--surface);
      border: 1px solid var(--border-weak); border-radius: 9999px;
      cursor: pointer; transition: all 0.25s ease;
    }
    .view-btn:hover { background: var(--bg-weak); border-color: var(--border); }
    .view-btn.active { color: var(--accent-text); background: var(--accent); border-color: var(--accent); }
    .projects-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 24px; }
    .projects-list.hidden { display: none; }
    .project-card {
      background: var(--surface);
      border-radius: 24px; border: 1px solid var(--border-weak);
      box-shadow: var(--card-shadow);
      overflow: hidden; transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
    }
    .project-card:hover {
      background: var(--bg-strong);
      box-shadow: var(--hover-shadow);
      transform: translateY(-4px) scale(1.005);
    }
    .project-card.hidden { display: none; }
    .project-header {
      padding: 20px 24px; cursor: pointer; display: flex;
      justify-content: space-between; align-items: flex-start;
      background: var(--surface); border-bottom: 1px solid transparent;
      transition: all 0.3s ease; gap: 12px;
    }
    .project-header:hover { background: var(--bg-strong); }
    .project-title-section { display: flex; align-items: center; gap: 16px; }
    .project-icon {
      width: 40px; height: 40px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center; color: white;
      background: var(--project-accent-color, var(--accent));
    }
    .project-info { display: flex; flex-direction: column; gap: 4px; }
    .project-header h2 { font-family: var(--font-display); font-size: 19px; font-weight: 600; letter-spacing: -0.021em; color: var(--text-strong); }
    .last-modified { font-size: 12px; color: var(--text-weak); font-weight: 400; letter-spacing: -0.01em; }
    .project-meta { display: flex; align-items: center; gap: 16px; }
    .badge { background: var(--bg-weak); color: var(--text-weaker); padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 500; }
    .project-content { background: var(--bg-weak); flex-shrink: 0; border-top: 1px solid var(--border-weak); }
    .sessions-list { padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; }
    .sessions-list::-webkit-scrollbar { width: 6px; }
    .sessions-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 9999px; }
    .session-item {
      background: var(--surface); border-radius: 12px; padding: 16px 20px;
      box-shadow: var(--card-shadow); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      border: 1px solid var(--border-weak); cursor: pointer; display: block;
    }
    .session-item:hover { box-shadow: var(--hover-shadow); transform: translateX(4px); }
    .session-item.hidden { display: none; }
    .session-title { font-family: var(--font-display); font-size: 14px; font-weight: 600; line-height: 1.4; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; color: var(--text-strong); }
    .session-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .session-date { font-size: 12px; color: var(--text-weak); display: flex; align-items: center; gap: 6px; }
    .session-date::before { content: ''; width: 4px; height: 4px; background: var(--border); border-radius: 50%; }
    .category-tag { padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: -0.01em; }
    .session-request { font-size: 13px; color: var(--text-weaker); line-height: 1.4; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-weak); }
    .session-more { text-align: center; font-size: 13px; font-weight: 500; color: var(--accent); padding: 12px 16px; }
    .global-timeline-wrapper { max-width: 800px; margin: 0 auto; }
    .global-timeline-wrapper.hidden { display: none; }
    .global-timeline-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; padding: 0 8px; }
    .global-timeline-header h3 { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.021em; color: var(--text-strong); }
    .global-timeline-count { font-size: 14px; color: var(--text-weak); font-weight: 500; }
    .global-timeline { position: relative; padding-left: 0; }
    .global-timeline::before { content: ''; position: absolute; left: 48px; top: 0; bottom: 0; width: 2px; background: linear-gradient(to bottom, var(--accent), var(--border)); border-radius: 1px; }
    .global-timeline .timeline-item { display: flex; align-items: flex-start; padding-bottom: 28px; padding-left: 0; }
    .global-timeline .timeline-item:last-child { padding-bottom: 0; }
    .global-timeline .timeline-serial { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--accent); background: var(--surface); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--accent); flex-shrink: 0; margin: 16px 16px 0 0; }
    .global-timeline .timeline-item.recent .timeline-serial { background: var(--accent); color: var(--accent-text); box-shadow: 0 0 0 3px var(--bg), 0 0 0 5px color-mix(in srgb, var(--accent) 35%, transparent); }
    .global-timeline .timeline-content { flex: 1; min-width: 0; margin-left: 16px; background: var(--surface); border-radius: 16px; padding: 24px; box-shadow: var(--card-shadow); border: 1px solid var(--border-weak); transition: all 0.3s cubic-bezier(0.4,0,0.2,1); position: relative; }
    .global-timeline .timeline-content:hover { box-shadow: var(--hover-shadow); transform: translateX(4px); border-color: var(--border); }
    .global-timeline .timeline-meta-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .global-timeline .timeline-project { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-strong); background: var(--bg-weak); padding: 6px 12px; border-radius: 9999px; }
    .global-timeline .timeline-project-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
    .global-timeline .timeline-date { font-size: 13px; color: var(--text-weak); display: flex; align-items: center; gap: 6px; }
    .global-timeline .timeline-date::before { content: ''; width: 4px; height: 4px; background: var(--border); border-radius: 50%; }
    .global-timeline .timeline-title { font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 1.4; letter-spacing: -0.016em; margin-bottom: 12px; color: var(--text-strong); overflow-wrap: anywhere; word-break: break-word; }
    .global-timeline .timeline-request { font-size: 14px; color: var(--text-weaker); line-height: 1.5; padding-top: 12px; border-top: 1px solid var(--border-weak); overflow-wrap: anywhere; word-break: break-word; }
    .global-timeline .timeline-category { display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: -0.01em; position: absolute; top: 24px; right: 24px; }
    @media (max-width: 768px) {
      .container { padding: 32px 16px; }
      .projects-list { grid-template-columns: 1fr; gap: 16px; }
      .project-header { padding: 16px 20px; }
      .project-icon { width: 36px; height: 36px; }
      .sessions-list { padding: 16px 20px; }
      .session-item { padding: 14px 16px; }
      .view-switcher { margin-bottom: 24px; }
      .view-btn { padding: 8px 16px; font-size: 13px; }
      .global-timeline-header h3 { font-size: 20px; }
      .global-timeline::before { left: 36px; }
      .global-timeline .timeline-item { padding-bottom: 24px; }
      .global-timeline .timeline-serial { width: 24px; height: 24px; font-size: 15px; margin: 12px 12px 0 0; }
      .global-timeline .timeline-content { margin-left: 12px; padding: 20px; }
      .global-timeline .timeline-title { font-size: 15px; }
      .global-timeline .timeline-meta-row { gap: 8px; }
      .global-timeline .timeline-project { padding: 4px 10px; font-size: 12px; }
      .container { flex-direction: column; gap: 16px; }
      .sidebar { width: 100%; position: static; max-height: 220px; }
      .main-content { margin-left: 0; }
    }
    footer { text-align: center; padding: 64px 32px; margin-top: 48px; }
    .footer-text { font-size: 12px; color: var(--text-weak); }
    .footer-meta { font-size: 12px; color: var(--text-weak); margin-top: 8px; display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; }
    .footer-meta a { color: var(--accent); text-decoration: none; }
    .footer-meta a:hover { text-decoration: underline; }
    .footer-meta-sep { color: var(--border); }
`;

// ─── 项目页专属 CSS（会话详情弹窗 + 代码块）───────────────────────────────────

const DETAIL_CSS = `
    .session-detail-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 2000; display: none; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; }
    .session-detail-modal-overlay.active { display: flex; opacity: 1; }
    [data-theme="light"] .session-detail-modal-overlay { background: hsla(0, 20%, 8%, 0.35); }
    .session-detail-modal-container { background: var(--bg); border-radius: 0; border: 1px solid var(--border-weak); box-shadow: var(--shadow); width: 100%; max-width: 100%; height: 100%; max-height: 100%; overflow: hidden; transform: scale(0.9) translateY(20px); transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); display: flex; flex-direction: column; }
    .session-detail-modal-overlay.active .session-detail-modal-container { transform: scale(1) translateY(0); }
    .session-detail-modal-header { padding: 32px 40px 24px; background: var(--surface); border-bottom: 1px solid var(--border-weak); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
    .session-detail-modal-title-section { display: flex; align-items: center; gap: 16px; flex: 1; }
    .session-detail-modal-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; background: var(--accent); }
    .session-detail-modal-title-content h2 { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.021em; margin-bottom: 6px; color: var(--text-strong); }
    .session-detail-modal-title-content .session-date { font-size: 14px; color: var(--text-weak); }
    .session-detail-modal-close { width: 36px; height: 36px; border-radius: 50%; background: var(--bg-strong); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-weaker); transition: all 0.2s ease; flex-shrink: 0; }
    .session-detail-modal-close:hover { background: var(--border-weak); color: var(--text-strong); }
    /* ── 弹窗正文两列：左目录树 + 右对话内容 ── */
    .session-detail-modal-content { display: grid; grid-template-columns: 280px minmax(0, 1fr); overflow: hidden; flex: 1; min-height: 0; background: var(--bg-weak); }
    .session-detail-modal-content.no-toc { display: block; overflow-y: auto; padding: 32px 40px 40px; }
    .detail-toc { overflow-y: auto; min-height: 0; padding: 24px 14px 40px 18px; border-right: 1px solid var(--border-weak); background: var(--surface); }
    .detail-toc-title { font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-weaker); margin-bottom: 12px; padding-left: 8px; }
    .toc-section-label { font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-weak); padding: 12px 8px 6px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toc-section-label:hover { color: var(--accent); }
    .toc-turn-block { margin-bottom: 2px; }
    .toc-item { font-size: 13px; color: var(--text-strong); padding: 5px 8px; border-radius: 8px; cursor: pointer; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: none; }
    .toc-item:hover { background: var(--bg-weak); }
    .toc-item.active { background: var(--accent-weak); }
    .toc-level-turn { font-weight: 600; }
    .toc-turn-summary { font-weight: 400; font-size: 12px; color: var(--text-weak); }
    .toc-sub { margin-left: 13px; padding-left: 9px; border-left: 2px solid var(--border-weak); display: flex; flex-direction: column; }
    .toc-level-step { font-size: 12px; color: var(--text-weak); }
    .toc-level-step.analysis:hover { color: var(--step-analysis-text); }
    .toc-level-step.execution:hover { color: var(--step-execution-text); }
    .toc-level-step.reply:hover { color: var(--step-reply-text); }
    .toc-level-child { font-size: 12px; color: var(--text-weak); }
    .toc-level-child:hover { color: #32ADE6; }
    .detail-body { overflow-y: auto; min-width: 0; padding: 32px 40px 40px; }
    .section-anchor { display: block; height: 0; }
    .turn-group, .step-group, .child-session-block, .section-anchor { scroll-margin-top: 12px; }
    /* ── 子会话卡片（📦 Subagent）：青色系，与步骤组三色区分 ── */
    .conversation-block.child-session-block { border-left: 3px solid #32ADE6; background: linear-gradient(135deg, rgba(50,173,230,0.05), rgba(50,173,230,0.01)); padding: 0; overflow: hidden; }
    .child-session-header { display: flex; align-items: center; gap: 10px; padding: 13px 16px; cursor: pointer; user-select: none; transition: background 0.2s ease; flex-wrap: wrap; }
    .child-session-header:hover { background: rgba(50,173,230,0.07); }
    .child-session-badge { flex-shrink: 0; font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: #32ADE6; background: rgba(50,173,230,0.14); padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .child-session-title { flex: 1; min-width: 0; font-family: var(--font-display); font-size: 14px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .child-session-meta { flex-shrink: 0; font-size: 12px; color: var(--text-weak); }
    .child-session-body { display: none; padding: 14px 16px 16px; border-top: 1px solid var(--border-weak); background: var(--bg-weak); }
    .child-session-block.open .child-session-body { display: block; }
    .child-session-block.open > .child-session-header .turn-chevron { transform: rotate(90deg); }
    .child-session-body .conversation-block { margin-bottom: 14px; }
    .child-session-body .conversation-block:last-child { margin-bottom: 0; }
    .conversation-block { background: var(--surface); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: var(--card-shadow); border: 1px solid var(--border-weak); }
    .conversation-block:last-child { margin-bottom: 0; }
    .conversation-block-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-weak); }
    .conversation-block-role { font-family: var(--font-display); font-size: 15px; font-weight: 600; }
    .conversation-block-role.user { color: var(--accent); }
    .conversation-block-role.assistant { color: var(--text-strong); }
    .conversation-block-role.tool { color: #FF9500; }
    .conversation-block-time { font-size: 13px; color: var(--text-weak); margin-left: auto; }
    .conversation-block-content { font-size: 14px; line-height: 1.6; color: var(--text-strong); white-space: pre-wrap; }
    .conversation-block-content details { margin: 12px 0; background: var(--bg-weak); border: 1px solid var(--border-weak); border-radius: 8px; padding: 10px 16px; }
    .conversation-block-content summary { cursor: pointer; font-weight: 600; font-size: 13px; color: var(--text-weaker); user-select: none; margin-bottom: 4px; }
    .conversation-block-content summary:hover { color: var(--accent); }
    .conversation-block-content details[open] summary { margin-bottom: 8px; }
    .conversation-block-content code:not(pre code) { background: var(--accent-weak); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px; color: var(--accent); }
    .conversation-block-content pre { position: relative; background: var(--code-bg); border-radius: 12px; overflow-x: auto; margin: 12px 0; border: 1px solid var(--code-border); padding: 0; }
    .conversation-block-content pre code { display: block; padding: 40px 16px 16px; background: none; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; }
    .code-block-header { position: absolute; top: 0; left: 0; right: 0; height: 36px; background: var(--code-header-bg); border-bottom: 1px solid var(--code-border); border-radius: 12px 12px 0 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; z-index: 2; }
    .code-block-lang { font-size: 11px; font-weight: 600; color: #9aa0a6; text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono); }
    .code-block-copy { font-size: 12px; font-weight: 500; color: #9aa0a6; background: transparent; border: 1px solid #5f6368; border-radius: 6px; padding: 3px 10px; cursor: pointer; transition: all 0.2s ease; font-family: var(--font-text); }
    .code-block-copy:hover { color: var(--accent); border-color: var(--accent); background: transparent; }
    .code-block-copy.copied { color: #34C759; border-color: #34C759; }
    .tool-block { background: linear-gradient(135deg, rgba(255,149,0,0.05), rgba(255,149,0,0.02)); border: 1px solid rgba(255,149,0,0.15); }
    .tool-block .conversation-block-role.tool { color: #FF9500; }
    .tool-detail { margin-top: 12px; }
    .tool-detail-label { font-size: 12px; font-weight: 600; color: var(--text-weaker); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .tool-detail-content { position: relative; background: var(--code-bg); border-radius: 8px; padding: 40px 12px 12px; font-family: var(--font-mono); font-size: 13px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; color: #abb2bf; border: 1px solid var(--code-border); }
    /* ── 助手步骤组：分析/执行/回复 层级容器 ── */
    .conversation-block.step-group { border-left: 3px solid #AF52DE; background: linear-gradient(135deg, rgba(175,82,222,0.04), rgba(175,82,222,0.01)); }
    .conversation-block.step-group.execution { border-left-color: #FF9500; background: linear-gradient(135deg, rgba(255,149,0,0.05), rgba(255,149,0,0.02)); }
    .conversation-block.step-group.reply { border-left-color: #34C759; background: linear-gradient(135deg, rgba(52,199,89,0.05), rgba(52,199,89,0.02)); }
    .step-group-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border-weak); flex-wrap: wrap; }
    .step-badge { font-family: var(--font-display); font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .step-badge.analysis { color: var(--step-analysis-text); background: rgba(175,82,222,0.12); }
    .step-badge.execution { color: var(--step-execution-text); background: rgba(255,149,0,0.14); }
    .step-badge.reply { color: var(--step-reply-text); background: rgba(52,199,89,0.14); }
    .step-tool-count { font-size: 12px; font-weight: 600; color: var(--step-execution-text); background: rgba(255,149,0,0.10); padding: 2px 8px; border-radius: 9999px; white-space: nowrap; }
    .step-group-body { position: relative; margin-left: 4px; padding-left: 16px; border-left: 2px solid var(--border-weak); display: flex; flex-direction: column; gap: 10px; }
    .step-section-label { font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 0.03em; }
    .step-section-label.analysis { color: var(--step-analysis-text); }
    .step-section-label.execution { color: var(--step-execution-text); }
    .step-section-label.reply { color: var(--step-reply-text); }
    .step-group-body .conversation-block { margin-bottom: 0; }
    .step-tool-wrap { min-width: 0; }
    .tool-detail-content .code-block-header { border-radius: 8px 8px 0 0; }
    .tool-detail-content pre { border-radius: 8px; }
    .session-detail-note { text-align: center; padding: 40px 20px; color: var(--text-weak); font-size: 14px; line-height: 1.8; }
    .session-stats-bar { display: flex; gap: 8px; flex-wrap: wrap; flex-basis: 100%; min-width: 0; overflow-x: auto; margin-top: 12px; }
    .session-stats-bar.hidden { display: none; }
    .stats-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--text-weaker); background: var(--bg-strong); border: 1px solid var(--border-weak); padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .stats-chip.cost { color: #FF9500; background: rgba(255,149,0,0.10); border-color: rgba(255,149,0,0.2); }
    .usage-stats-table-wrap { width: 100%; max-width: 100%; overflow-x: auto; }
    .usage-stats-table { border-collapse: collapse; font-size: 12px; line-height: 1.5; white-space: nowrap; }
    .usage-stats-table th { font-weight: 600; color: var(--text-weaker); background: var(--bg-strong); padding: 5px 12px; text-align: right; border-bottom: 1px solid var(--border-weak); white-space: nowrap; }
    .usage-stats-table th:first-child { text-align: left; border-radius: 8px 0 0 0; }
    .usage-stats-table th:last-child { border-radius: 0 8px 0 0; }
    .usage-stats-table td { padding: 5px 12px; color: var(--text-strong); text-align: right; border-bottom: 1px solid var(--border-weak); font-variant-numeric: tabular-nums; }
    .usage-stats-table td:first-child { text-align: left; color: var(--text-weaker); font-weight: 500; }
    .usage-stats-table tr.total td { font-weight: 600; border-top: 2px solid var(--border); border-bottom: none; background: rgba(142,142,147,0.06); }
    .usage-stats-table tr.total td:first-child { color: var(--text-strong); border-radius: 0 0 0 8px; }
    .usage-stats-table tr.total td:last-child { border-radius: 0 0 8px 0; }
    .usage-stats-table tr.total td:not(:first-child):not(:last-child) { color: var(--text-weak); font-weight: 400; }
    .usage-tokens-note { margin-top: 6px; font-size: 11px; color: var(--text-weak); }
    .usage-badge { display: inline-flex; align-items: center; gap: 6px; margin-left: 10px; font-size: 11px; font-weight: 500; color: var(--text-weaker); background: rgba(142,142,147,0.10); border: 1px solid rgba(142,142,147,0.18); padding: 2px 9px; border-radius: 9999px; white-space: nowrap; flex-shrink: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; max-width: 50%; box-sizing: border-box; }
    .usage-badge.warn { color: #FF9500; background: rgba(255,149,0,0.10); border-color: rgba(255,149,0,0.25); }
    .usage-badge.error { color: #FF3B30; background: rgba(255,59,48,0.10); border-color: rgba(255,59,48,0.25); }
    .usage-badge.compaction { color: #AF52DE; background: rgba(175,82,222,0.10); border-color: rgba(175,82,222,0.25); }
    .session-section-divider { display: flex; align-items: center; gap: 12px; margin: 28px 0 20px; color: var(--text-weak); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .session-section-divider::before, .session-section-divider::after { content: ''; flex: 1; height: 1px; background: var(--border-weak); }
    .turn-group { background: var(--surface); border: 1px solid var(--border-weak); border-radius: 14px; margin-bottom: 14px; box-shadow: var(--card-shadow); overflow: hidden; }
    .turn-group:last-child { margin-bottom: 0; }
    .turn-header { display: flex; align-items: center; gap: 12px; padding: 13px 16px; cursor: pointer; user-select: none; transition: background 0.2s ease; }
    .turn-header:hover { background: var(--bg-weak); }
    .turn-chevron { flex-shrink: 0; color: var(--text-weak); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); }
    .turn-group.open .turn-chevron { transform: rotate(90deg); }
    .turn-badge { flex-shrink: 0; font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: var(--accent-text); background: var(--accent); padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .turn-badge.context { color: var(--text-weaker); background: var(--border-weak); }
    .turn-summary { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .turn-meta { flex-shrink: 0; font-size: 12px; color: var(--text-weak); }
    .turn-body { display: none; padding: 14px 16px 16px; border-top: 1px solid var(--border-weak); background: var(--bg-weak); }
    .turn-group.open .turn-body { display: block; }
    .turn-body .conversation-block { margin-bottom: 14px; }
    .turn-body .conversation-block:last-child { margin-bottom: 0; }
    @media (max-width: 768px) {
      .session-detail-modal-container { width: 100%; max-height: 100%; border-radius: 0; }
      .session-detail-modal-header { padding: 24px 24px 20px; }
      .session-detail-modal-icon { width: 40px; height: 40px; }
      .session-detail-modal-title-content h2 { font-size: 18px; }
      .session-detail-modal-content, .session-detail-modal-content.no-toc { display: block; overflow-y: auto; padding: 24px 24px 32px; }
      .detail-toc { display: none; }
      .detail-body { overflow: visible; padding: 0; }
      .conversation-block { padding: 16px; }
      .turn-header { padding: 11px 12px; gap: 8px; }
      .turn-summary { font-size: 13px; }
      .turn-body { padding: 12px; }
    }
`;

// ─── 主索引页生成 ─────────────────────────────────────────────────────────────

function buildProjectCards(projects: ProjectData[]): string {
  return projects.map((p) => {
    const color = getProjectColor(p.name);
    const icon = getProjectIcon(p.name);
    const lastMod = formatTimestamp(p.lastModified);
    const href = projectPageHref(p.name);
    const sessionsHtml = p.sessions.slice(0, 3).map((s) => {
      const catColor = CATEGORY_COLORS[s.category] || CATEGORY_COLORS['开发讨论'];
      return `
        <a class="session-item" href="${href}${sessionAnchor(s.filename)}" data-title="${escapeHtml(s.title)}" data-request="${escapeHtml(s.userRequest)}">
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-meta">
            <span class="session-date">${formatDate(s.date)}</span>
            <span class="category-tag" style="background:${catColor.bg};color:${catColor.text}">${s.category}</span>
          </div>
        </a>`;
    }).join('');

    return `
      <div class="project-card" data-project="${escapeHtml(p.name)}" data-action="open-project" style="--project-accent-color:${color}; cursor: pointer;">
        <div class="project-header">
          <div class="project-title-section">
            <div class="project-icon" style="background:${color}">
              <i data-lucide="${icon}" style="width:20px;height:20px;color:white"></i>
            </div>
            <div class="project-info">
              <h2>${escapeHtml(p.name)}</h2>
              <span class="last-modified">最后对话: ${lastMod}</span>
            </div>
          </div>
          <div class="project-meta">
            <span class="badge">${p.count} 个会话</span>
          </div>
        </div>
        <div class="project-content">
          <div class="sessions-list">${sessionsHtml}
            <a class="session-item session-more" href="${href}">查看全部 ${p.count} 个会话 →</a>
          </div>
        </div>
      </div>`;
  }).join('');
}

function buildProjectSidebar(projects: ProjectData[]): string {
  return projects.map((p) => {
    const color = getProjectColor(p.name);
    const href = projectPageHref(p.name);
    return `
      <a class="sidebar-item" href="${href}" data-project="${escapeHtml(p.name)}">
        <span class="sidebar-dot" style="background:${color}"></span>
        <span class="sidebar-main">
          <span class="sidebar-name">${escapeHtml(p.name)}</span>
          <span class="sidebar-time">${formatTimestamp(p.lastModified)}</span>
        </span>
        <span class="sidebar-count">${p.count}</span>
      </a>`;
  }).join('');
}

function buildGlobalTimeline(projects: ProjectData[]): string {
  const allSessions: Array<SessionInfo & { projectName: string; projectColor: string }> = [];
  for (const p of projects) {
    const color = getProjectColor(p.name);
    for (const s of p.sessions) {
      allSessions.push({ ...s, projectName: p.name, projectColor: color });
    }
  }

  allSessions.sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime());

  return allSessions.map((s, idx) => {
    const serial = allSessions.length - idx;
    const isFirst = idx === 0;
    const catColor = CATEGORY_COLORS[s.category] || CATEGORY_COLORS['开发讨论'];
    const icon = getProjectIcon(s.projectName);
    const href = projectPageHref(s.projectName) + sessionAnchor(s.filename);

    return `
      <a class="timeline-item ${isFirst ? 'recent' : ''}" href="${href}" data-project="${escapeHtml(s.projectName)}" data-title="${escapeHtml(s.title)}" data-request="${escapeHtml(s.userRequest)}">
        <div class="timeline-serial">${serial}</div>
        <div class="timeline-content">
          <span class="timeline-category" style="background:${catColor.bg};color:${catColor.text}">${s.category}</span>
          <div class="timeline-meta-row">
            <div class="timeline-project">
              <div class="timeline-project-icon" style="background:${s.projectColor}">
                <i data-lucide="${icon}" style="width:14px;height:14px;color:white"></i>
              </div>
              <span style="color:${s.projectColor}">${escapeHtml(s.projectName)}</span>
            </div>
            <div class="timeline-date">${s.date}</div>
          </div>
          <div class="timeline-title">${escapeHtml(s.title)}</div>
          <div class="timeline-request">${escapeHtml(s.userRequest)}</div>
        </div>
      </a>`;
  }).join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFooterMetaHtml(): string {
  const parts: string[] = [];
  if (pluginRepoUrl) {
    parts.push(`<a href="${escapeHtml(pluginRepoUrl)}" target="_blank" rel="noopener">GitHub 仓库</a>`);
  }
  if (parts.length === 0) {
    return '';
  }
  return `<p class="footer-meta">${parts.join('<span class="footer-meta-sep">·</span>')}</p>`;
}

// 主索引页：仅含元数据（项目卡片 + 全局时间线 + 搜索），不内联对话内容
function buildOverviewHtml(projects: ProjectData[], totalSessions: number): string {
  const generatedTime = new Date().toLocaleString('zh-CN');
  const projectCount = projects.length;
  const categoryStats = computeCategoryStats(projects);
  const dashboard = buildDashboard(categoryStats, totalSessions);

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Overview</title>
  <script>try{var t=localStorage.getItem('autorecord-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}</script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    ${COMMON_CSS}
  </style>
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-content">
      <div class="nav-left">
        <div class="nav-title">OpenCode Overview <span class="nav-version">v${pluginVersion}</span></div>
        <div class="nav-gen-time">${generatedTime}</div>
        <div class="nav-search-container">
          <span class="nav-search-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
          <input type="text" class="nav-search-box" id="searchInput" placeholder="搜索项目或会话..." onkeyup="filterProjects()">
        </div>
      </div>
      <div class="nav-stats">
        <div class="nav-stat"><div class="nav-stat-value">${projectCount}</div><div class="nav-stat-label">项目</div></div>
        <div class="nav-stat"><div class="nav-stat-value">${totalSessions}</div><div class="nav-stat-label">会话</div></div>
        <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换主题">
          <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>
          <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
        </button>
      </div>
    </div>
  </nav>

  <div class="container">
    <aside class="sidebar">
      <div class="sidebar-title">项目列表（${projectCount}）</div>
      <div class="sidebar-list" id="projectSidebarList">${buildProjectSidebar(projects)}</div>
    </aside>

    <div class="main-content">
      ${dashboard}
      <div class="view-switcher">
        <button class="view-btn active" id="btnGrid" data-action="switch-view" data-view="grid">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          项目视图
        </button>
        <button class="view-btn" id="btnTimeline" data-action="switch-view" data-view="timeline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          时间线视图
        </button>
      </div>

      <div class="projects-list" id="projectsList">${buildProjectCards(projects)}</div>

      <div class="global-timeline-wrapper hidden" id="globalTimelineWrapper">
        <div class="global-timeline-header">
          <h3>全部会话时间线</h3>
          <span class="global-timeline-count">共 ${totalSessions} 个会话</span>
        </div>
        <div class="global-timeline" id="globalTimeline">${buildGlobalTimeline(projects)}</div>
      </div>
    </div>
  </div>

  <footer>
    <p class="footer-text">Generated by opencode-autorecord plugin</p>
    ${buildFooterMetaHtml()}
  </footer>

  <script>
    (function() {
      var btn = document.getElementById('themeToggle');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('autorecord-theme', next); } catch (e) {}
      });
    })();

    function getProjectColor(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash;
      }
      const colors = ['#007AFF','#AF52DE','#FF9500','#34C759','#5AC8FA','#FF2D55','#00C7BE','#FFCC00','#5856D6','#8E8E93'];
      return colors[Math.abs(hash) % colors.length];
    }

    function initProjectsData() {
      document.querySelectorAll('.project-card').forEach(card => {
        const projectName = card.getAttribute('data-project');
        const color = getProjectColor(projectName);
        card.style.setProperty('--project-accent-color', color);
      });
    }

    function filterProjects() {
      const filter = document.getElementById('searchInput').value.toLowerCase();
      const isTimeline = document.getElementById('btnTimeline').classList.contains('active');

      document.querySelectorAll('#projectSidebarList .sidebar-item').forEach(item => {
        const name = (item.getAttribute('data-project') || '').toLowerCase();
        item.classList.toggle('hidden', !name.includes(filter));
      });

      if (!isTimeline) {
        document.querySelectorAll('.project-card').forEach(card => {
          const projectName = (card.getAttribute('data-project') || '').toLowerCase();
          const sessions = card.querySelectorAll('.session-item');
          let hasVisible = projectName.includes(filter);
          if (!hasVisible) {
            sessions.forEach(s => {
              const title = s.getAttribute('data-title') || '';
              const request = s.getAttribute('data-request') || '';
              const match = title.includes(filter) || request.includes(filter);
              s.classList.toggle('hidden', !match);
              if (match) hasVisible = true;
            });
          } else {
            sessions.forEach(s => s.classList.remove('hidden'));
          }
          card.classList.toggle('hidden', !hasVisible);
        });
      } else {
        let visibleCount = 0;
        document.querySelectorAll('#globalTimeline .timeline-item').forEach(item => {
          const project = (item.getAttribute('data-project') || '').toLowerCase();
          const title = (item.getAttribute('data-title') || '').toLowerCase();
          const request = (item.getAttribute('data-request') || '').toLowerCase();
          const match = project.includes(filter) || title.includes(filter) || request.includes(filter);
          item.classList.toggle('hidden', !match);
          if (match) visibleCount++;
        });
        document.querySelector('.global-timeline-count').textContent = '共 ' + visibleCount + ' 个会话';
      }
    }

    function switchView(view) {
      document.getElementById('btnGrid').classList.toggle('active', view === 'grid');
      document.getElementById('btnTimeline').classList.toggle('active', view === 'timeline');
      document.getElementById('projectsList').classList.toggle('hidden', view !== 'grid');
      document.getElementById('globalTimelineWrapper').classList.toggle('hidden', view !== 'timeline');
      filterProjects();
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('a[href]')) return;
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      switch (action) {
        case 'open-project':
          location.href = 'projects/' + encodeURIComponent(actionEl.dataset.project || '') + '.html';
          break;
        case 'switch-view':
          switchView(actionEl.dataset.view || 'grid');
          break;
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      initProjectsData();
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      } else {
        document.querySelectorAll('[data-lucide]').forEach(el => {
          const projectName = el.closest('[data-project]')?.getAttribute('data-project') ||
                             el.closest('.timeline-project')?.querySelector('span')?.textContent ||
                             '?';
          const initial = (projectName[0] || '?').toUpperCase();
          const color = el.closest('[style*="--project-accent-color"]')?.style.getPropertyValue('--project-accent-color') ||
                       el.parentElement?.style.background || '#007AFF';
          el.outerHTML = '<svg width="20" height="20" viewBox="0 0 40 40" style="border-radius:50%"><circle cx="20" cy="20" r="20" fill="' + color + '"/><text x="20" y="27" text-anchor="middle" fill="white" font-size="18" font-weight="600">' + initial + '</text></svg>';
        });
      }
    });
  </script>
</body>
</html>`;
}

// ─── 项目页生成 ───────────────────────────────────────────────────────────────

export function buildProjectHtml(project: ProjectData): string {
  const color = getProjectColor(project.name);
  const lastMod = formatTimestamp(project.lastModified);

  const sessions = project.sessions;
  const timeRangeText: string = ((): string => {
    if (sessions.length === 0) return '无';
    const dates = sessions.map((s) => parseDate(s.date).getTime());
    const oldest = Math.min(...dates);
    const newest = Math.max(...dates);
    const diffDays = Math.ceil((newest - oldest) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return '1 天内';
    if (diffDays < 30) return diffDays + ' 天';
    return Math.ceil(diffDays / 30) + ' 个月';
  })();

  // 截断策略：仅最近 N 个会话内联完整对话，更老会话只保留元数据
  const detailFilenames = new Set(sessions.slice(0, DETAIL_SESSION_LIMIT).map((s) => s.filename));
  const projectData = {
    name: project.name,
    title: project.name,
    lastModified: lastMod,
    color,
    sessions: sessions.map((s) => ({
      title: s.title,
      request: s.userRequest,
      date: s.date,
      category: s.category,
      filename: s.filename,
      stats: s.stats,
      conversationBlocks: detailFilenames.has(s.filename) ? (s.conversationBlocks || []) : undefined,
    })),
  };

  const timelineItems = sessions.map((s, idx) => {
    const serial = sessions.length - idx;
    const isFirst = idx === 0;
    const catColor = CATEGORY_COLORS[s.category] || CATEGORY_COLORS['开发讨论'];

    return `
      <div class="timeline-item ${isFirst ? 'recent' : ''}" data-action="open-session" data-filename="${escapeHtml(s.filename)}" data-title="${escapeHtml(s.title)}" data-request="${escapeHtml(s.userRequest)}" style="cursor: pointer;">
        <div class="timeline-serial">${serial}</div>
        <div class="timeline-content">
          <span class="timeline-category" style="background:${catColor.bg};color:${catColor.text}">${s.category}</span>
          <div class="timeline-meta-row">
            <div class="timeline-date">${s.date}</div>
          </div>
          <div class="timeline-title">${escapeHtml(s.title)}</div>
          <div class="timeline-request">${escapeHtml(s.userRequest)}</div>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(project.name)} - OpenCode Overview</title>
  <script>try{var t=localStorage.getItem('autorecord-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}</script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-yaml.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markdown.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-css.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markup.min.js"></script>
  <style>
    ${COMMON_CSS}
    ${DETAIL_CSS}
  </style>
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-content">
      <div class="nav-left">
        <a class="back-link" href="../opencode-overview.html">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          返回总览
        </a>
        <div class="nav-title">${escapeHtml(project.name)}</div>
        <div class="nav-gen-time">${lastMod}</div>
        <div class="nav-search-container">
          <span class="nav-search-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
          <input type="text" class="nav-search-box" id="searchInput" placeholder="搜索会话..." onkeyup="filterProjects()">
        </div>
      </div>
      <div class="nav-stats">
        <div class="nav-stat"><div class="nav-stat-value">${sessions.length}</div><div class="nav-stat-label">会话</div></div>
        <div class="nav-stat"><div class="nav-stat-value">${timeRangeText}</div><div class="nav-stat-label">时间跨度</div></div>
        <button class="theme-toggle" id="themeToggle" type="button" aria-label="切换主题">
          <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>
          <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
        </button>
      </div>
    </div>
  </nav>

  <div class="container">
    <div class="global-timeline-wrapper">
      <div class="global-timeline-header">
        <h3>会话时间线</h3>
        <span class="global-timeline-count">共 ${sessions.length} 个会话</span>
      </div>
      <div class="global-timeline" id="globalTimeline">${timelineItems}</div>
    </div>
  </div>

  <footer>
    <p class="footer-text">Generated by opencode-autorecord plugin</p>
    ${buildFooterMetaHtml()}
  </footer>

  <div class="session-detail-modal-overlay" id="sessionDetailModalOverlay">
    <div class="session-detail-modal-container">
      <div class="session-detail-modal-header">
        <div class="session-detail-modal-title-section">
          <div class="session-detail-modal-icon" id="sessionDetailModalIcon" style="background:${color}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div class="session-detail-modal-title-content">
            <h2 id="sessionDetailModalTitle">会话标题</h2>
            <span class="session-date" id="sessionDetailModalDate">--</span>
          </div>
        </div>
        <button class="session-detail-modal-close" data-action="close-session-detail">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="session-stats-bar hidden" id="sessionDetailModalStats"></div>
      </div>
      <div class="session-detail-modal-content" id="sessionDetailModalContent">
      </div>
    </div>
  </div>

  <script>
    (function() {
      var btn = document.getElementById('themeToggle');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('autorecord-theme', next); } catch (e) {}
      });
    })();

    const projectData = ${JSON.stringify(projectData).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--')};
    const INJECTED_MARKER = ${JSON.stringify(INJECTED_CONTEXT_MARKER)};

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function findSessionByFilename(filename) {
      return projectData.sessions.find(s => s.filename === filename);
    }

    function fmtNum(n) {
      return Number(n || 0).toLocaleString('en-US');
    }

    function renderSessionStatsBar(stats) {
      const bar = document.getElementById('sessionDetailModalStats');
      if (!bar) return;
      const models = Object.entries((stats && stats.byModel) || {});
      if (!stats || (models.length === 0 && !(stats.totalCost > 0))) {
        bar.innerHTML = '';
        bar.classList.add('hidden');
        return;
      }

      let callsTotal = 0;
      const rows = models.map(([model, r]) => {
        callsTotal += r.calls || 0;
        return '<tr>'
          + '<td>' + escapeHtml(model) + '</td>'
          + '<td>' + fmtNum(r.calls) + '</td>'
          + '<td>' + fmtNum(r.input) + '</td>'
          + '<td>' + fmtNum(r.output) + '</td>'
          + '<td>' + fmtNum(r.reasoning) + '</td>'
          + '<td>' + fmtNum(r.cacheRead) + '</td>'
          + '<td>' + fmtNum(r.cacheWrite) + '</td>'
          + '<td>' + Number(r.cost || 0).toFixed(4) + '</td>'
          + '</tr>';
      });

      let html = '<div class="usage-stats-table-wrap"><table class="usage-stats-table">';
      html += '<thead><tr><th>模型</th><th>调用</th><th>输入</th><th>输出</th><th>推理</th><th>缓存读取</th><th>缓存写入</th><th>成本 ($)</th></tr></thead>';
      html += '<tbody>' + rows.join('') + '</tbody>';
      html += '<tfoot><tr class="total"><td>Total</td><td>' + fmtNum(callsTotal) + '</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>' + Number(stats.totalCost || 0).toFixed(4) + '</td></tr></tfoot>';
      html += '</table></div>';
      html += '<div class="usage-tokens-note">🪙 Total tokens: ' + fmtNum(stats.totalTokens) + ' (输入 + 输出 + 推理)</div>';

      bar.innerHTML = html;
      bar.classList.remove('hidden');
    }

    function formatUsageBadge(u) {
      if (!u) return '';
      const bits = [];
      if (u.modelID) bits.push(u.modelID);
      const inTok = u.input || 0, outTok = u.output || 0;
      if (inTok || outTok) bits.push('↑' + fmtNum(inTok) + ' ↓' + fmtNum(outTok));
      if (u.reasoning) bits.push('🧠' + fmtNum(u.reasoning));
      if (u.cacheRead || u.cacheWrite) bits.push('⚡' + fmtNum((u.cacheRead || 0) + (u.cacheWrite || 0)));
      if (u.cost) bits.push('$' + Number(u.cost).toFixed(4));
      if (u.durationMs) bits.push((u.durationMs / 1000).toFixed(1) + 's');

      let cls = 'usage-badge';
      let prefix = '';
      if (u.error) { cls += ' error'; prefix = '❌ '; }
      else if (u.finish && /max|length/i.test(u.finish)) { cls += ' warn'; prefix = '⚠️ '; }
      else if (u.finish && /abort|cancel|interrupt/i.test(u.finish)) { cls += ' warn'; prefix = '🛑 '; }
      if (u.compaction) { cls += ' compaction'; prefix += '📦 '; }

      const full = [];
      if (u.providerID) full.push('provider=' + u.providerID);
      if (u.modelID) full.push('model=' + u.modelID);
      full.push('in=' + fmtNum(u.input), 'out=' + fmtNum(u.output));
      if (u.reasoning) full.push('reason=' + fmtNum(u.reasoning));
      if (u.cacheRead) full.push('cacheread=' + fmtNum(u.cacheRead));
      if (u.cacheWrite) full.push('cachewrite=' + fmtNum(u.cacheWrite));
      if (typeof u.cost === 'number') full.push('cost=$' + Number(u.cost).toFixed(4));
      if (u.durationMs) full.push('dur=' + (u.durationMs / 1000).toFixed(1) + 's');
      if (u.finish) full.push('finish=' + u.finish);
      if (u.compaction) full.push('compaction');
      if (u.error) full.push('error="' + u.error + '"');
      const titleAttr = ' title="' + escapeHtml(full.join('\\n')).replace(/"/g, '&quot;') + '"';

      return '<span class="' + cls + '"' + titleAttr + '>' + prefix + escapeHtml(bits.join(' · ')) + '</span>';
    }

    function openSessionDetailModal(filename) {
      const session = findSessionByFilename(filename);
      if (!session) return;
      document.getElementById('sessionDetailModalTitle').textContent = session.title;
      document.getElementById('sessionDetailModalDate').textContent = session.date;
      renderSessionStatsBar(session.stats);

      const contentEl = document.getElementById('sessionDetailModalContent');

      if (session.conversationBlocks && session.conversationBlocks.length > 0) {
        const rendered = renderTurnSections(session.conversationBlocks);
        contentEl.innerHTML =
          '<aside class="detail-toc">' +
          '<div class="detail-toc-title">目录</div>' +
          rendered.toc +
          '</aside>' +
          '<div class="detail-body">' + rendered.html + '</div>';
        contentEl.classList.remove('no-toc');
      } else {
        contentEl.innerHTML = '<div class="session-detail-note">该会话时间较早，HTML 中未内联完整对话内容。<br>完整内容请查看对应 Markdown 文件：<br><code>' + escapeHtml(session.filename) + '</code></div>';
        contentEl.classList.add('no-toc');
      }
      document.getElementById('sessionDetailModalOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function renderBlockCard(block) {
      if (block.type === 'child-session') {
        return renderChildSessionCard(block, null);
      }
      if (block.type === 'message') {
        const isUser = block.role === 'user';
        const roleClass = isUser ? 'user' : 'assistant';
        const roleText = isUser ? '用户' : '助手';
        let html = '<div class="conversation-block">';
        html += '<div class="conversation-block-header">';
        html += '<span class="conversation-block-role ' + roleClass + '">' + roleText + '</span>';
        if (!isUser && block.usage) {
          html += formatUsageBadge(block.usage);
        }
        html += '<span class="conversation-block-time">' + escapeHtml(block.timestamp) + '</span>';
        html += '</div>';
        html += '<div class="conversation-block-content">' + formatConversationContent(block.content || '') + '</div>';
        html += '</div>';
        return html;
      }

      let html = '<div class="conversation-block tool-block">';
      html += '<div class="conversation-block-header">';
      html += '<span class="conversation-block-role tool">🔧 Tool: ' + escapeHtml(block.toolName || 'unknown') + '</span>';
      html += '<span class="conversation-block-time">' + escapeHtml(block.timestamp) + '</span>';
      html += '</div>';

      if (block.toolStatus) {
        html += '<div style="margin-bottom: 12px;"><span style="font-size: 12px; font-weight: 600; color: var(--text-weaker); text-transform: uppercase; letter-spacing: 0.05em;">状态</span><span style="margin-left: 8px; font-size: 13px; color: var(--text-strong);">' + escapeHtml(block.toolStatus) + '</span></div>';
      }
      if (block.toolInput) {
        html += '<div class="tool-detail"><div class="tool-detail-label">输入</div><div class="tool-detail-content">' + formatToolContent(block.toolInput) + '</div></div>';
      }
      if (block.toolOutput) {
        html += '<div class="tool-detail"><div class="tool-detail-label">输出</div><div class="tool-detail-content">' + formatToolContent(block.toolOutput) + '</div></div>';
      }

      html += '</div>';
      return html;
    }

    // ─── 助手步骤组：分析/执行/回复 层级渲染 ─────────────────────────────────

    const STEP_TAG_META = {
      '分析过程': { icon: '🧠', cls: 'analysis' },
      '执行过程': { icon: '🔧', cls: 'execution' },
      '回复内容': { icon: '💬', cls: 'reply' }
    };

    function hasStepInfo(b) {
      return !!(b && b.role === 'assistant' && typeof b.stepId === 'number');
    }

    /** 相邻且 stepId 相同的 assistant 块聚合为步骤组；无 stepId 的旧数据各自成组（降级平铺） */
    function groupAssistantSteps(blocks) {
      const out = [];
      let cur = null;
      for (const b of blocks) {
        if (cur && cur.join && hasStepInfo(b) && cur.id === b.stepId) {
          cur.blocks.push(b);
        } else {
          cur = { id: hasStepInfo(b) ? b.stepId : null, join: hasStepInfo(b), blocks: [b] };
          out.push(cur);
        }
      }
      return out.map(g => g.blocks);
    }

    /** reasoning 卡片去掉 💭 头行，由小节标签替代 */
    function stripReasoningHeader(content) {
      const marker = '💭 **Reasoning:**';
      if (!content || content.indexOf(marker) !== 0) return content;
      const rest = content.substring(marker.length).trim();
      return rest || content;
    }

    function renderStepGroup(gBlocks, anchorId) {
      const first = gBlocks[0];
      const meta = STEP_TAG_META[first.stepTag] || { icon: '🤖', cls: 'analysis' };
      let usageBlock = null;
      let toolCount = 0;
      for (const b of gBlocks) {
        if (!usageBlock && b.usage) usageBlock = b;
        if (b.type === 'tool') toolCount += 1;
      }

      let html = '<div class="conversation-block step-group ' + meta.cls + '"' + (anchorId ? ' id="' + anchorId + '"' : '') + '>';
      html += '<div class="step-group-header">';
      html += '<span class="step-badge ' + meta.cls + '">' + meta.icon + ' ' + escapeHtml(first.stepTag || '助手') + '</span>';
      if (toolCount > 0) {
        html += '<span class="step-tool-count">🔧 ×' + toolCount + '</span>';
      }
      if (usageBlock) {
        html += formatUsageBadge(usageBlock.usage);
      }
      html += '<span class="conversation-block-time">' + escapeHtml(first.timestamp || '') + '</span>';
      html += '</div>';
      html += '<div class="step-group-body">';

      let toolLabeled = false;
      for (const b of gBlocks) {
        if (b.type === 'tool') {
          if (!toolLabeled) {
            html += '<div class="step-section-label execution">🔧 工具调用</div>';
            toolLabeled = true;
          }
          html += '<div class="step-tool-wrap">' + renderBlockCard(b) + '</div>';
        } else if (b.kind === 'reasoning') {
          html += '<div class="step-section-label analysis">🧠 分析本体</div>';
          html += '<div class="step-section-content conversation-block-content">' + formatConversationContent(stripReasoningHeader(b.content || '')) + '</div>';
        } else {
          html += '<div class="step-section-label reply">💬 回复内容</div>';
          html += '<div class="step-section-content conversation-block-content">' + formatConversationContent(b.content || '') + '</div>';
        }
      }

      html += '</div>';
      html += '</div>';
      return html;
    }

    /** 子会话卡片：📦 头部 + 可折叠体；内部消息复用步骤组/卡片渲染（无轮次概念） */
    function renderChildSessionCard(block, anchorId) {
      const children = block.children || [];
      let html = '<div class="conversation-block child-session-block" data-child-group' + (anchorId ? ' id="' + anchorId + '"' : '') + '>';
      html += '<div class="child-session-header" data-action="toggle-turn">';
      html += '<svg class="turn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      html += '<span class="child-session-badge">📦 Subagent</span>';
      html += '<span class="child-session-title">' + escapeHtml(block.childTitle || '子代理') + '</span>';
      let metaBits = [];
      if (children.length > 0) metaBits.push(children.length + ' 条消息');
      if (block.timestamp) metaBits.push(escapeHtml(block.timestamp));
      if (metaBits.length > 0) {
        html += '<span class="child-session-meta">' + metaBits.join(' · ') + '</span>';
      }
      html += '</div>';
      html += '<div class="child-session-body">';
      html += renderTurnBody(children, null);
      html += '</div>';
      html += '</div>';
      return html;
    }

    /** 轮次体渲染：有 stepId 的 assistant 块聚合为步骤组容器，其余保持原卡片；
     * anchorBase 提供时给每个组容器写入稳定 id（目录树跳转目标，编号 tsi-gigki） */
    function renderTurnBody(blocks, anchorBase) {
      return groupAssistantSteps(blocks).map(function(gBlocks, ki) {
        const gid = anchorBase ? anchorBase + 'g' + ki : null;
        if (gBlocks[0].type === 'child-session') {
          return renderChildSessionCard(gBlocks[0], gid);
        }
        if (hasStepInfo(gBlocks[0])) {
          return renderStepGroup(gBlocks, gid);
        }
        return gBlocks.map(renderBlockCard).join('');
      }).join('');
    }

    /**
     * 按用户提问划分轮次渲染（可折叠手风琴），同时产出左侧目录树。
     * 分段规则：turn===1 且 role==='user' 的块开启新的会话段（对应 topic 文件中的一个 session 块）；
     * 段内按 turn 编号分组。旧数据（无 role/turn 字段）降级为平铺渲染。
     * 返回 { html, toc }。锚点编号：段 sec-si、轮次 turn-tsi-gi、组内条目 tsi-gig-ki
     * （TOC 与正文用同一 groupAssistantSteps 分组，编号必然对齐）。
     */
    function renderTurnSections(blocks) {
      const hasTurnInfo = blocks.some(b => b.role === 'user' && typeof b.turn === 'number' && b.turn > 0);
      if (!hasTurnInfo) {
        return { html: renderTurnBody(blocks, null), toc: '' };
      }

      const sections = [];
      for (const b of blocks) {
        if (sections.length === 0 || (b.role === 'user' && b.turn === 1)) {
          sections.push([]);
        }
        const sec = sections[sections.length - 1];
        const turnKey = typeof b.turn === 'number' && b.turn > 0 ? b.turn : 0;
        let group = sec[sec.length - 1];
        if (!group || group.key !== turnKey) {
          group = { key: turnKey, blocks: [] };
          sec.push(group);
        }
        group.blocks.push(b);
      }

      const multiSection = sections.length > 1;
      let html = '';
      let toc = '';
      sections.forEach((sec, si) => {
        html += '<span id="sec-' + si + '" class="section-anchor"></span>';
        if (si > 0) {
          html += '<div class="session-section-divider"><span>续篇会话 · ' + (si + 1) + '/' + sections.length + '</span></div>';
        }
        if (multiSection) {
          toc += '<div class="toc-section-label" data-action="toc-jump" data-target-id="sec-' + si + '">会话 ' + (si + 1) + '/' + sections.length + '</div>';
        }

        sec.forEach((group, gi) => {
          const firstUser = group.blocks.find(b => b.role === 'user' && b.content);
          const summarySource = (firstUser ? firstUser.content : '') || '';
          const summaryLine = summarySource.split('\\n').map(l => l.trim()).find(l => l && l.indexOf(INJECTED_MARKER) !== 0) || '';
          const shortSummary = summaryLine.length > 80 ? summaryLine.substring(0, 80) + '…' : (summaryLine || '(无文本)');
          const timeLabel = firstUser ? firstUser.timestamp : '';
          const isContext = group.key === 0;
          const base = 't' + si + '-' + gi;

          html += '<div class="turn-group" data-turn-group id="turn-' + base + '">';
          html += '<div class="turn-header" data-action="toggle-turn">';
          html += '<svg class="turn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
          html += '<span class="turn-badge' + (isContext ? ' context' : '') + '">' + (isContext ? '上下文' : '第 ' + group.key + ' 轮') + '</span>';
          html += '<span class="turn-summary">' + escapeHtml(shortSummary) + '</span>';
          if (timeLabel) {
            html += '<span class="turn-meta">' + escapeHtml(timeLabel) + '</span>';
          }
          html += '</div>';
          html += '<div class="turn-body">';
          html += renderTurnBody(group.blocks, base);
          html += '</div>';
          html += '</div>';

          // TOC：轮次节点（摘要截短，与正文手风琴一一对应）
          const tocLabel = isContext ? '上下文' : '第 ' + group.key + ' 轮';
          const tocSummary = summaryLine.length > 26 ? summaryLine.substring(0, 26) + '…' : (summaryLine || '');
          toc += '<div class="toc-turn-block">';
          toc += '<div class="toc-item toc-level-turn" data-action="toc-jump" data-target-id="turn-' + base + '">' + escapeHtml(tocLabel) + (tocSummary ? '<span class="toc-turn-summary">' + escapeHtml(tocSummary) + '</span>' : '') + '</div>';

          // TOC：步骤组/子会话节点（与 renderTurnBody 相同分组规则）
          toc += '<div class="toc-sub">';
          groupAssistantSteps(group.blocks).forEach((gBlocks, ki) => {
            const gid = base + 'g' + ki;
            const head = gBlocks[0];
            if (head.type === 'child-session') {
              const childTitle = head.childTitle || '子代理';
              const shortChild = childTitle.length > 20 ? childTitle.substring(0, 20) + '…' : childTitle;
              toc += '<div class="toc-item toc-level-child" data-action="toc-jump" data-target-id="' + gid + '">📦 ' + escapeHtml(shortChild) + '</div>';
            } else if (hasStepInfo(head)) {
              const meta = STEP_TAG_META[head.stepTag] || { icon: '🤖', cls: 'analysis', label: head.stepTag || '助手' };
              let toolCount = 0;
              for (const gb of gBlocks) {
                if (gb.type === 'tool') toolCount += 1;
              }
              toc += '<div class="toc-item toc-level-step ' + meta.cls + '" data-action="toc-jump" data-target-id="' + gid + '">' + meta.icon + ' ' + escapeHtml(head.stepTag || '助手') + (toolCount > 0 ? ' ×' + toolCount : '') + '</div>';
            }
          });
          toc += '</div>';
          toc += '</div>';
        });
      });
      return { html: html, toc: toc };
    }

    function closeSessionDetailModal() {
      document.getElementById('sessionDetailModalOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    function copyCodeBlock(btn) {
      const copyId = btn.getAttribute('data-copy-id');
      const codeEl = document.getElementById(copyId);
      if (!codeEl) return;
      let rawCode = codeEl.getAttribute('data-raw-code');
      if (rawCode) {
        try { rawCode = decodeURIComponent(rawCode); } catch { rawCode = codeEl.textContent || ''; }
      } else {
        rawCode = codeEl.textContent || '';
      }
      navigator.clipboard.writeText(rawCode).then(() => {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = rawCode;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
        } catch {}
        document.body.removeChild(ta);
      });
    }

    function formatConversationContent(content) {
      if (!content) return '';
      const backtick = String.fromCharCode(96);
      const tripleBacktick = backtick + backtick + backtick;

      const parts = content.split(tripleBacktick);
      const processedParts = [];

      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          // 保护 details 折叠块与 <br> 标签，避免被转义显示为原始文本
          let text = parts[i]
            .replace(/<details>/g, '\\u0001')
            .replace(/<\\/details>/g, '\\u0002')
            .replace(/<summary>/g, '\\u0003')
            .replace(/<\\/summary>/g, '\\u0004')
            .replace(/<br>/gi, '\\u0005');
          text = escapeHtml(text);
          const inlineParts = text.split(backtick);
          for (let j = 1; j < inlineParts.length - 1; j += 2) {
            if (j + 1 < inlineParts.length) {
              inlineParts[j] = '<code>' + inlineParts[j] + '</code>';
            }
          }
          text = inlineParts.join('');
          text = text.split('\\n').join('<br>');
          text = text
            .split('\\u0001').join('<details>')
            .split('\\u0002').join('</details>')
            .split('\\u0003').join('<summary>')
            .split('\\u0004').join('</summary>')
            .split('\\u0005').join('<br>');
          processedParts.push(text);
        } else {
          let code = parts[i];
          let lang = '';
          const newlineIdx = code.indexOf('\\n');
          if (newlineIdx === 0) {
            const nextNewline = code.indexOf('\\n', 1);
            const firstLine = nextNewline > 0 ? code.substring(1, nextNewline).trim() : code.substring(1).trim();
            if (firstLine && /^[a-zA-Z0-9\\-+_]+$/.test(firstLine) && firstLine.length <= 20) {
              lang = firstLine.toLowerCase();
              code = nextNewline > 0 ? code.substring(nextNewline + 1) : '';
            }
          } else if (newlineIdx > 0) {
            const firstLine = code.substring(0, newlineIdx).trim();
            if (firstLine && /^[a-zA-Z0-9\\-+_]+$/.test(firstLine) && firstLine.length <= 20) {
              lang = firstLine.toLowerCase();
              code = code.substring(newlineIdx + 1);
            }
          }

          const langMap = {
            'js': 'javascript', 'jsx': 'javascript',
            'ts': 'typescript', 'tsx': 'typescript',
            'sh': 'bash', 'shell': 'bash', 'zsh': 'bash',
            'py': 'python', 'python3': 'python',
            'yml': 'yaml',
            'md': 'markdown',
            'jsonc': 'json',
          };
          const prismLang = langMap[lang] || lang;
          const langClass = prismLang ? 'language-' + prismLang : '';
          const langLabel = lang || 'text';

          const escapedCode = escapeHtml(code);
          const escapedLangLabel = escapeHtml(langLabel);
          const escapedLangClass = escapeHtml(langClass);
          const copyId = 'copy-' + Math.random().toString(36).substr(2, 9);
          const headerHtml = '<div class="code-block-header"><span class="code-block-lang">' + escapedLangLabel + '</span><button class="code-block-copy" data-copy-id="' + copyId + '" onclick="copyCodeBlock(this)">复制</button></div>';
          processedParts.push('<pre>' + headerHtml + '<code' + (escapedLangClass ? ' class="' + escapedLangClass + '"' : '') + ' id="' + copyId + '" data-raw-code="' + encodeURIComponent(code) + '"' + '>' + escapedCode + '</code></pre>');
        }
      }

      return processedParts.join('');
    }

    function formatToolContent(content) {
      if (!content) return '';
      let code;
      try {
        const json = JSON.parse(content);
        code = JSON.stringify(json, null, 2);
      } catch {
        code = content;
      }
      const escaped = escapeHtml(code);
      const copyId = 'copy-tool-' + Math.random().toString(36).substr(2, 9);
      const headerHtml = '<div class="code-block-header"><span class="code-block-lang">json</span><button class="code-block-copy" data-copy-id="' + copyId + '" onclick="copyCodeBlock(this)">复制</button></div>';
      return '<pre>' + headerHtml + '<code class="language-json" id="' + copyId + '" data-raw-code="' + encodeURIComponent(code) + '">' + escaped + '</code></pre>';
    }

    function filterProjects() {
      const filter = document.getElementById('searchInput').value.toLowerCase();
      let visibleCount = 0;
      document.querySelectorAll('#globalTimeline .timeline-item').forEach(item => {
        const title = (item.getAttribute('data-title') || '').toLowerCase();
        const request = (item.getAttribute('data-request') || '').toLowerCase();
        const match = title.includes(filter) || request.includes(filter);
        item.classList.toggle('hidden', !match);
        if (match) visibleCount++;
      });
      document.querySelector('.global-timeline-count').textContent = '共 ' + visibleCount + ' 个会话';
    }

    function openSessionFromHash() {
      let hash;
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (hash.startsWith('session-')) {
        const filename = hash.slice('session-'.length);
        const session = findSessionByFilename(filename);
        if (session) {
          openSessionDetailModal(filename);
        }
      }
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeSessionDetailModal();
      }
    });
    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      switch (action) {
        case 'open-session':
          openSessionDetailModal(actionEl.dataset.filename);
          break;
        case 'close-session-detail':
          closeSessionDetailModal();
          break;
        case 'toggle-turn': {
          // child-session 卡片嵌套在轮次手风琴内部，closest 取最近的折叠容器，
          // 点击子会话头部时不会误展开外层轮次
          const groupEl = actionEl.closest('[data-child-group], [data-turn-group]');
          if (groupEl) {
            groupEl.classList.toggle('open');
            if (groupEl.classList.contains('open') && typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
              Prism.highlightAllUnder(groupEl);
            }
          }
          break;
        }
        case 'toc-jump': {
          const targetId = actionEl.getAttribute('data-target-id');
          const target = targetId ? document.getElementById(targetId) : null;
          if (!target) break;
          // 先展开目标所在的折叠容器（轮次手风琴/子会话卡片），再滚动定位
          let acc = target.closest('.turn-group, .child-session-block');
          while (acc) {
            const changed = !acc.classList.contains('open');
            acc.classList.add('open');
            if (changed && typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
              Prism.highlightAllUnder(acc);
            }
            acc = acc.parentElement ? acc.parentElement.closest('.turn-group, .child-session-block') : null;
          }
          const tocRoot = document.getElementById('sessionDetailModalContent');
          if (tocRoot) {
            const prev = tocRoot.querySelector('.toc-item.active');
            if (prev) prev.classList.remove('active');
            actionEl.classList.add('active');
          }
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          break;
        }
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      }
      openSessionFromHash();
    });
  </script>
</body>
</html>`;
}

// ─── 写入与增量辅助 ──────────────────────────────────────────────────────────

async function writeHtmlAtomically(filePath: string, content: string): Promise<void> {
  // 唯一临时名：CLI 与运行中的插件可能并发再生同一页面，
  // 固定 .tmp 名会互相截断（rename 发布半成品导致 HTML 损坏）；
  // 各写各的 tmp + 原子 rename，最终发布的始终是某个进程的完整产物
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

// 检查哪些项目的索引缓存缺少完整对话（需要全量重读）
function projectsMissingDetail(index: AutorecordIndex, projects: ProjectData[]): Set<string> {
  const missing = new Set<string>();
  for (const p of projects) {
    const secIndex = index.secondary.get(p.name);
    const hasDetail =
      secIndex &&
      Object.values(secIndex.files).every((f) => Array.isArray(f.sessionInfo.conversationBlocks));
    if (!hasDetail) {
      missing.add(p.name);
    }
  }
  return missing;
}

// 删除已不存在项目对应的残留 HTML 页面
async function cleanupStaleProjectPages(
  projectsDir: string,
  projects: ProjectData[]
): Promise<number> {
  let removedCount = 0;
  try {
    const existing = new Set(projects.map((p) => p.name));
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      let projectName: string;
      try {
        projectName = decodeURIComponent(entry.name.slice(0, -5));
      } catch {
        projectName = '';
      }
      if (existing.has(projectName)) continue;
      await rm(join(projectsDir, entry.name), { force: true });
      removedCount += 1;
    }
  } catch {
    // 清理失败静默忽略，不影响视图再生主流程
  }
  return removedCount;
}

// 确保项目数据包含完整对话：索引缓存缺失时全量重读该项目 md 并回写索引
async function ensureProjectDetail(
  project: ProjectData,
  baseDir: string,
  index: AutorecordIndex
): Promise<ProjectData> {
  const secIndex = index.secondary.get(project.name);
  const hasDetail =
    secIndex &&
    Object.values(secIndex.files).every((f) => Array.isArray(f.sessionInfo.conversationBlocks));
  if (hasDetail) {
    return project;
  }

  const projectDir = join(baseDir, project.name);
  const mdFiles = await listMdFiles(projectDir);
  const sessions: SessionInfo[] = [];

  for (const filePath of mdFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const info = extractSessionInfo(filePath, content);
      if (info) {
        sessions.push(info);
        const s = await stat(filePath);
        updateFileIndex(index, project.name, filePath, { mtime: s.mtime, size: s.size }, info);
      }
    } catch {
      // Skip unreadable files
    }
  }

  sessions.sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime());
  return {
    name: project.name,
    sessions,
    count: sessions.length,
    lastModified:
      (sessions.length > 0 ? latestSessionTimeMs(sessions) : null) ?? project.lastModified,
  };
}


// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * 视图渲染结构版本。HTML 渲染逻辑发生结构性变化（如轮次手风琴分组、
 * 两列目录树/subagent 子会话恢复）时 +1，
 * regenerateViews 检测到不一致会强制重建全部项目页（存量页面刷新）。
 */
const VIEW_VERSION = 7;

/**
 * 再生成全部 HTML 视图。
 * 返回 'ok' 表示完成（含增量）；'skipped-newer-index' 表示磁盘索引由更高版本代码
 * 写入，已按 fail-closed 跳过本次再生与索引写入。
 */
export async function regenerateViews(globalSaveDir: string): Promise<'ok' | 'skipped-newer-index'> {
  const baseDir = globalSaveDir;
  const logPath = join(baseDir, '.autorecord-views.log');

  try {
    // fail-closed：磁盘索引由更高版本代码写入（index/view 版本超过本地认知）时，
    // 放弃本次再生与 saveIndex，避免旧逻辑降级覆盖新格式数据造成版本震荡
    const stored = await readStoredIndexVersions(baseDir);
    if (
      (stored.primaryIndexVersion ?? 0) > INDEX_VERSION ||
      (stored.viewVersion ?? 0) > VIEW_VERSION
    ) {
      await writeViewLog(
        logPath,
        `WARN: Skipped regeneration - index written by newer code (index v${String(stored.primaryIndexVersion)}/view v${String(stored.viewVersion)} > local index v${INDEX_VERSION}/view v${VIEW_VERSION})`
      );
      return 'skipped-newer-index';
    }

    // Validate and repair indexes (also handles v1 migration)
    const index = await validateAndRepairIndexes(baseDir);
    let projects: ProjectData[];
    let isIncremental = false;
    let unchangedProjects: string[] = [];

    // 解析逻辑升级（VIEW_VERSION 变更）时必须丢弃缓存的解析结果：
    // 将缓存 mtime 置为失效值，使增量扫描把所有文件视为已修改并重新解析，
    // 否则旧代码写入的 sessionInfo（含错误解析的对话块）会被直接复用
    if (index.primary.viewVersion !== VIEW_VERSION) {
      for (const secondary of index.secondary.values()) {
        for (const entry of Object.values(secondary.files)) {
          entry.mtime = -1;
        }
      }
    }

    if (index.primary.lastFullScan > 0 && Object.keys(index.primary.projects).length > 0) {
      // Use incremental scanning with index
      const result = await scanProjectsIncremental(baseDir, index);
      projects = result.projects;
      unchangedProjects = result.unchangedProjects;
      isIncremental = true;
    } else {
      // Fallback to full scan and create new index
      projects = await scanProjectsFull(baseDir);

      // Build index from full scan results
      for (const project of projects) {
        const projectDir = join(baseDir, project.name);
        const mdFiles = await listMdFiles(projectDir);

        for (const filePath of mdFiles) {
          try {
            const content = await readFile(filePath, 'utf-8');
            const info = extractSessionInfo(filePath, content);
            if (info) {
              const s = await stat(filePath);
              updateFileIndex(index, project.name, filePath, { mtime: s.mtime, size: s.size }, info);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      index.primary.lastFullScan = Date.now();
      unchangedProjects = [];
    }

    const projectsDir = join(baseDir, PROJECTS_DIR);
    await mkdir(projectsDir, { recursive: true });

    if (projects.length === 0) {
      await writeViewLog(logPath, 'INFO: No projects with markdown files found');
    } else {
      const totalSessions = projects.reduce((sum, p) => sum + p.count, 0);

      // 渲染结构版本不一致（代码升级）时强制重建全部项目页
      const forceAllPages = index.primary.viewVersion !== VIEW_VERSION;
      if (forceAllPages) {
        await writeViewLog(logPath, `INFO: View structure version changed (cached: ${String(index.primary.viewVersion)}, current: ${VIEW_VERSION}), rebuilding all project pages`);
        index.primary.viewVersion = VIEW_VERSION;
      }

      // 1. 主索引页：仅元数据（剥离对话内容，避免文件无限膨胀）
      const metaProjects = projects.map((p) => ({
        ...p,
        sessions: p.sessions.map((s) => ({ ...s, conversationBlocks: undefined })),
      }));
      const overviewPath = join(baseDir, 'opencode-overview.html');
      await writeHtmlAtomically(overviewPath, buildOverviewHtml(metaProjects, totalSessions));

      // 2. 项目页：增量重建（仅变更项目或缓存缺对话的项目）
      const missingDetail = projectsMissingDetail(index, projects);
      let rebuiltCount = 0;

      for (const p of projects) {
        const needsRebuild = forceAllPages || missingDetail.has(p.name) || !unchangedProjects.includes(p.name);
        if (!needsRebuild) continue;

        const fullProject = await ensureProjectDetail(p, baseDir, index);
        const pagePath = join(projectsDir, `${encodeURIComponent(p.name)}.html`);
        await writeHtmlAtomically(pagePath, buildProjectHtml(fullProject));
        rebuiltCount += 1;
      }

      const scanMode = isIncremental ? 'incremental' : 'full';
      await writeViewLog(
        logPath,
        `INFO: Views regenerated (${scanMode}) - ${projects.length} projects, ${totalSessions} sessions, overview: ${overviewPath}, rebuilt project pages: ${rebuiltCount}`
      );
    }

    // 清理已删除项目的残留 HTML 页面（独立于项目是否存在，保证全删时也能清理）
    const removedStale = await cleanupStaleProjectPages(projectsDir, projects);
    if (removedStale > 0) {
      await writeViewLog(logPath, `INFO: Removed ${removedStale} stale project page(s)`);
    }

    // Always save index, even if projects.length === 0
    // This ensures orphan cleanup in validateAndRepairIndexes is persisted
    await saveIndex(baseDir, index);
    return 'ok';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeViewLog(logPath, `ERROR: Failed to regenerate views - ${message}`);
    throw error;
  }
}
