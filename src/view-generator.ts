import { readdir, readFile, writeFile, appendFile, stat, mkdir, rename, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { version: pluginVersion } = require('../package.json');
import { INJECTED_CONTEXT_MARKER, TURN_SEPARATOR } from './types.js';
import {
  saveIndex,
  updateFileIndex,
  removeFileFromIndex,
  getFilesToProcess,
  convertIndexToProjects,
  latestSessionTimeMs,
  validateAndRepairIndexes,
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
  '#FF2D55', '#00C7BE', '#FFCC00', '#5856D6', '#1D1D1F',
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
 * 解析单个 session block 内的对话，按主会话级用户提问划分轮次。
 * - `<!-- AUTORECORD-TURN -->` 分隔符：新轮次起点（formatter 对每条真实输入写入）
 * - 旧格式 fallback：以 `## 👤 User` 标题为等价边界，但 synthetic-only
 *   注入消息不开新轮次，归入当前轮次（turn=0 表示任何轮次之前的前置内容）
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
      // Extract timestamp from next line
      let timestamp = '';
      if (i + 1 < lines.length) {
        const timeMatch = lines[i + 1].match(/\*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\*/);
        if (timeMatch) {
          timestamp = timeMatch[1];
          i += 1;
        }
      }

      // Collect message content until next block
      i += 1;
      const sectionStartIndex = blocks.length;
      let sectionMeta: BlockUsage | null = null;
      const messageLines: string[] = [];
      let inToolBlock = false;
      let toolBlock: ConversationBlock | null = null;
      let inStepBlock = false;
      let stepLines: string[] = [];

      while (i < lines.length) {
        const currentLine = lines[i];

        // 精确边界锚定（不用裸 --- ：工具输出/正文中可能出现分隔线）
        if (isConversationBoundary(currentLine)) {
          break;
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

        // Check for tool block start
        const toolMatch = currentLine.match(/#### 🔧 Tool:\s*(\w+)/);
        if (toolMatch) {
          // Save previous message content if any
          if (messageLines.length > 0 && !inToolBlock && !inStepBlock) {
            const msgContent = messageLines.join('\n').trim();
            if (msgContent) {
              blocks.push({
                type: 'message',
                timestamp,
                content: msgContent,
              });
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
        if (currentLine.includes('[step-finish')) {
          // Save tool block
          if (toolBlock) {
            blocks.push(toolBlock);
          }
          inToolBlock = false;
          toolBlock = null;

          // Also close step block if still open (step-finish part marks step end)
          if (inStepBlock) {
            const stepContent = stepLines.join('\n').trim();
            if (stepContent) {
              blocks.push({
                type: 'message',
                timestamp,
                content: stepContent,
              });
            }
            inStepBlock = false;
            stepLines = [];
          }
          i += 1;
          continue;
        }

        // Check for step block start: [step-start part]
        if (currentLine.includes('[step-start')) {
          // Save previous message content as question if any
          if (messageLines.length > 0 && !inToolBlock && !inStepBlock) {
            const msgContent = messageLines.join('\n').trim();
            if (msgContent) {
              blocks.push({
                type: 'message',
                timestamp,
                content: msgContent,
              });
            }
            messageLines.length = 0;
          }

          inStepBlock = true;
          stepLines = [];
          i += 1;
          continue;
        }

        // Check for step block end: [step-end part]
        if (inStepBlock && currentLine.includes('[step-end')) {
          // Save step block as assistant answer
          const stepContent = stepLines.join('\n').trim();
          if (stepContent) {
            blocks.push({
              type: 'message',
              timestamp,
              content: stepContent,
            });
          }
          inStepBlock = false;
          stepLines = [];
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
          blocks.push({
            type: 'message',
            timestamp,
            content: msgContent,
          });
        }
      }

      // Save remaining step block
      if (stepLines.length > 0 && inStepBlock) {
        const stepContent = stepLines.join('\n').trim();
        if (stepContent) {
          blocks.push({
            type: 'message',
            timestamp,
            content: stepContent,
          });
        }
      }

      // Save remaining tool block
      if (toolBlock) {
        blocks.push(toolBlock);
      }

      // Attach usage metadata to the first message block of this section
      if (sectionMeta) {
        for (let bi = sectionStartIndex; bi < blocks.length; bi++) {
          if (blocks[bi].type === 'message') {
            blocks[bi].usage = sectionMeta;
            break;
          }
        }
      }

      // 本节产出的全部 block 归属当前轮次（assistant 角色）
      for (let bi = sectionStartIndex; bi < blocks.length; bi++) {
        blocks[bi].role = 'assistant';
        if (currentTurn > 0) blocks[bi].turn = currentTurn;
      }

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
      --apple-blue: #007AFF;
      --apple-gray-1: #F5F5F7;
      --apple-gray-2: #E8E8ED;
      --apple-gray-3: #D1D1D6;
      --apple-gray-4: #8E8E93;
      --apple-gray-5: #636366;
      --apple-black: #1D1D1F;
      --apple-white: #FFFFFF;
      --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
      --font-text: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      --nav-height: 68px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    a { color: inherit; text-decoration: none; }
    body {
      font-family: var(--font-text);
      background: var(--apple-gray-1);
      color: var(--apple-black);
      line-height: 1.47059;
      -webkit-font-smoothing: antialiased;
    }
    .nav-bar {
      position: sticky; top: 0; z-index: 100;
      height: var(--nav-height);
      background: rgba(251,251,253,0.72);
      backdrop-filter: saturate(180%) blur(20px);
      border-bottom: 1px solid rgba(0,0,0,0.06);
      padding: 16px 32px;
    }
    .nav-content {
      max-width: 1200px; margin: 0 auto;
      display: flex; justify-content: space-between; align-items: center; gap: 24px;
    }
    .nav-left { display: flex; align-items: center; gap: 32px; flex: 1; }
    .nav-title {
      font-family: var(--font-display); font-size: 21px; font-weight: 600;
      letter-spacing: -0.021em; flex-shrink: 0;
    }
    .nav-version {
      font-size: 12px; font-weight: 500; color: var(--apple-gray-4);
      background: var(--apple-gray-2); padding: 2px 8px; border-radius: 9999px;
      vertical-align: middle; margin-left: 8px;
    }
    .nav-gen-time {
      font-size: 13px; font-weight: 600; color: #5856D6;
      margin-left: 16px; flex-shrink: 0;
    }
    .nav-search-container { position: relative; max-width: 400px; width: 100%; }
    .nav-search-box {
      width: 100%; padding: 10px 16px 10px 40px; font-size: 15px;
      background: var(--apple-white); border: 1px solid var(--apple-gray-3);
      border-radius: 9999px; outline: none; transition: all 0.2s ease;
    }
    .nav-search-box:focus { border-color: var(--apple-blue); box-shadow: 0 0 0 4px rgba(0,122,255,0.15); }
    .nav-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--apple-gray-4); pointer-events: none; }
    .nav-stats { display: flex; gap: 24px; flex-shrink: 0; }
    .nav-stat-value { font-family: var(--font-display); font-size: 24px; font-weight: 600; color: var(--apple-blue); }
    .nav-stat-label { font-size: 11px; color: var(--apple-gray-4); text-transform: uppercase; letter-spacing: 0.05em; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 14px; font-weight: 500; color: var(--apple-gray-5);
      background: var(--apple-white); border: 1px solid var(--apple-gray-2);
      border-radius: 9999px; padding: 8px 16px;
      transition: all 0.25s ease; flex-shrink: 0;
    }
    .back-link:hover { color: var(--apple-blue); border-color: var(--apple-blue); }
    @media (max-width: 768px) {
      .nav-content { flex-wrap: wrap; gap: 16px; }
      .nav-left { width: 100%; gap: 16px; }
      .nav-search-container { max-width: none; order: 3; }
      .nav-stats { margin-left: auto; }
    }
    .dashboard-section { padding: 0 0 24px; }
    .dashboard-grid { display: flex; flex-wrap: nowrap; gap: 12px; overflow-x: auto; }
    .dashboard-card {
      background: rgba(255,255,255,0.85); backdrop-filter: saturate(180%) blur(20px);
      border-radius: 16px; padding: 16px 8px; border: 1px solid rgba(255,255,255,0.6);
      box-shadow: 0 2px 12px rgba(0,0,0,0.04); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column; align-items: center; text-align: center;
      flex: 1 1 0; min-width: 80px; max-width: 200px;
    }
    .dashboard-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); background: rgba(255,255,255,0.95); }
    .dashboard-count { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.021em; margin-bottom: 2px; }
    .dashboard-label { font-size: 12px; font-weight: 500; color: var(--apple-gray-5); margin-bottom: 10px; white-space: nowrap; }
    .dashboard-bar { width: 100%; max-width: 80px; height: 4px; background: var(--apple-gray-2); border-radius: 9999px; overflow: hidden; margin-bottom: 6px; }
    .dashboard-bar-fill { height: 100%; border-radius: 9999px; transition: width 0.8s cubic-bezier(0.4,0,0.2,1); }
    .dashboard-percentage { font-size: 11px; font-weight: 600; color: var(--apple-gray-4); }
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
      background: var(--apple-white); border: 1px solid var(--apple-gray-2);
      border-radius: 16px; padding: 16px 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
      max-height: calc(100vh - var(--nav-height) - 32px); overflow-y: auto;
    }
    .sidebar-title { font-size: 12px; font-weight: 600; color: var(--apple-gray-4); text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 8px 12px; }
    .sidebar-list { display: flex; flex-direction: column; gap: 2px; }
    .sidebar-item {
      display: flex; align-items: center; gap: 10px; padding: 8px 10px;
      border-radius: 10px; transition: background 0.2s ease; font-size: 14px;
    }
    .sidebar-item:hover { background: var(--apple-gray-1); }
    .sidebar-item.hidden { display: none; }
    .sidebar-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; align-self: flex-start; margin-top: 5px; }
    .sidebar-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sidebar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--apple-black); font-weight: 500; }
    .sidebar-time { font-size: 11px; color: var(--apple-gray-4); }
    .sidebar-count { font-size: 12px; color: var(--apple-gray-4); background: var(--apple-gray-1); padding: 2px 8px; border-radius: 9999px; flex-shrink: 0; }
    .main-content { flex: 1; min-width: 0; margin-left: 284px; }
    .view-switcher { display: flex; gap: 12px; margin-bottom: 32px; justify-content: center; }
    .view-btn {
      display: flex; align-items: center; gap: 8px; padding: 10px 20px;
      font-family: var(--font-text); font-size: 14px; font-weight: 500;
      color: var(--apple-gray-5); background: var(--apple-white);
      border: 1px solid var(--apple-gray-2); border-radius: 9999px;
      cursor: pointer; transition: all 0.25s ease;
    }
    .view-btn:hover { background: var(--apple-gray-1); border-color: var(--apple-gray-3); }
    .view-btn.active { color: var(--apple-white); background: var(--apple-black); border-color: var(--apple-black); }
    .projects-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 24px; }
    .projects-list.hidden { display: none; }
    .project-card {
      background: linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.65));
      backdrop-filter: saturate(200%) blur(30px); -webkit-backdrop-filter: saturate(200%) blur(30px);
      border-radius: 24px; border: 1px solid rgba(255,255,255,0.6);
      box-shadow: 0 4px 24px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02), inset 0 1px 0 rgba(255,255,255,0.8);
      overflow: hidden; transition: all 0.4s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
    }
    .project-card:hover {
      background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,255,255,0.75));
      box-shadow: 0 12px 40px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9);
      transform: translateY(-4px) scale(1.005);
    }
    .project-card.hidden { display: none; }
    .project-header {
      padding: 20px 24px; cursor: pointer; display: flex;
      justify-content: space-between; align-items: flex-start;
      background: var(--apple-white); border-bottom: 1px solid transparent;
      transition: all 0.3s ease; gap: 12px;
    }
    .project-header:hover { background: #FAFAFA; }
    .project-title-section { display: flex; align-items: center; gap: 16px; }
    .project-icon {
      width: 40px; height: 40px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center; color: white;
      background: var(--project-accent-color, var(--apple-blue));
    }
    .project-info { display: flex; flex-direction: column; gap: 4px; }
    .project-header h2 { font-family: var(--font-display); font-size: 19px; font-weight: 600; letter-spacing: -0.021em; }
    .last-modified { font-size: 12px; color: var(--apple-gray-4); font-weight: 400; letter-spacing: -0.01em; }
    .project-meta { display: flex; align-items: center; gap: 16px; }
    .badge { background: var(--apple-gray-1); color: var(--apple-gray-5); padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 500; }
    .project-content { background: var(--apple-gray-1); flex-shrink: 0; border-top: 1px solid var(--apple-gray-2); }
    .sessions-list { padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; }
    .sessions-list::-webkit-scrollbar { width: 6px; }
    .sessions-list::-webkit-scrollbar-thumb { background: var(--apple-gray-3); border-radius: 9999px; }
    .session-item {
      background: var(--apple-white); border-radius: 12px; padding: 16px 20px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      border: 1px solid var(--apple-gray-2); cursor: pointer; display: block;
    }
    .session-item:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateX(4px); }
    .session-item.hidden { display: none; }
    .session-title { font-family: var(--font-display); font-size: 14px; font-weight: 600; line-height: 1.4; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
    .session-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .session-date { font-size: 12px; color: var(--apple-gray-4); display: flex; align-items: center; gap: 6px; }
    .session-date::before { content: ''; width: 4px; height: 4px; background: var(--apple-gray-3); border-radius: 50%; }
    .category-tag { padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: -0.01em; }
    .session-request { font-size: 13px; color: var(--apple-gray-5); line-height: 1.4; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--apple-gray-2); }
    .session-more { text-align: center; font-size: 13px; font-weight: 500; color: var(--apple-blue); padding: 12px 16px; }
    .global-timeline-wrapper { max-width: 800px; margin: 0 auto; }
    .global-timeline-wrapper.hidden { display: none; }
    .global-timeline-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; padding: 0 8px; }
    .global-timeline-header h3 { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.021em; }
    .global-timeline-count { font-size: 14px; color: var(--apple-gray-4); font-weight: 500; }
    .global-timeline { position: relative; padding-left: 0; }
    .global-timeline::before { content: ''; position: absolute; left: 48px; top: 0; bottom: 0; width: 2px; background: linear-gradient(to bottom, var(--apple-blue), var(--apple-gray-3)); border-radius: 1px; }
    .global-timeline .timeline-item { display: flex; align-items: flex-start; padding-bottom: 28px; padding-left: 0; }
    .global-timeline .timeline-item:last-child { padding-bottom: 0; }
    .global-timeline .timeline-serial { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--apple-blue); background: var(--apple-white); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--apple-blue); flex-shrink: 0; margin: 16px 16px 0 0; }
    .global-timeline .timeline-item.recent .timeline-serial { background: var(--apple-blue); color: var(--apple-white); box-shadow: 0 0 0 3px var(--apple-gray-1), 0 0 0 5px rgba(0,122,255,0.2); }
    .global-timeline .timeline-content { flex: 1; margin-left: 16px; background: var(--apple-white); border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid var(--apple-gray-2); transition: all 0.3s cubic-bezier(0.4,0,0.2,1); position: relative; }
    .global-timeline .timeline-content:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateX(4px); }
    .global-timeline .timeline-meta-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .global-timeline .timeline-project { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--apple-black); background: var(--apple-gray-1); padding: 6px 12px; border-radius: 9999px; }
    .global-timeline .timeline-project-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
    .global-timeline .timeline-date { font-size: 13px; color: var(--apple-gray-4); display: flex; align-items: center; gap: 6px; }
    .global-timeline .timeline-date::before { content: ''; width: 4px; height: 4px; background: var(--apple-gray-3); border-radius: 50%; }
    .global-timeline .timeline-title { font-family: var(--font-display); font-size: 17px; font-weight: 600; line-height: 1.4; letter-spacing: -0.016em; margin-bottom: 12px; color: var(--apple-black); }
    .global-timeline .timeline-request { font-size: 14px; color: var(--apple-gray-5); line-height: 1.5; padding-top: 12px; border-top: 1px solid var(--apple-gray-2); }
    .global-timeline .timeline-category { display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: -0.01em; position: absolute; top: 24px; right: 24px; }
    .project-hero {
      display: flex; align-items: center; gap: 20px;
      background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7));
      backdrop-filter: saturate(200%) blur(30px); -webkit-backdrop-filter: saturate(200%) blur(30px);
      border-radius: 24px; border: 1px solid rgba(255,255,255,0.6);
      box-shadow: 0 4px 24px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8);
      padding: 28px 32px; margin-bottom: 40px;
    }
    .project-hero-icon { width: 64px; height: 64px; border-radius: 18px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; background: var(--project-accent-color, var(--apple-blue)); }
    .project-hero h1 { font-family: var(--font-display); font-size: 28px; font-weight: 700; letter-spacing: -0.021em; margin-bottom: 8px; }
    .project-hero-meta { display: flex; gap: 16px; flex-wrap: wrap; }
    .project-hero-meta span { font-size: 13px; color: var(--apple-gray-5); background: var(--apple-gray-1); padding: 4px 12px; border-radius: 9999px; }
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
      .project-hero { padding: 20px 20px; }
      .project-hero-icon { width: 48px; height: 48px; border-radius: 14px; }
      .project-hero h1 { font-size: 22px; }
      .container { flex-direction: column; gap: 16px; }
      .sidebar { width: 100%; position: static; max-height: 220px; }
      .main-content { margin-left: 0; }
    }
    footer { text-align: center; padding: 64px 32px; margin-top: 48px; }
    .footer-text { font-size: 12px; color: var(--apple-gray-4); }
`;

// ─── 项目页专属 CSS（会话详情弹窗 + 代码块）───────────────────────────────────

const DETAIL_CSS = `
    .session-detail-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 2000; display: none; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; }
    .session-detail-modal-overlay.active { display: flex; opacity: 1; }
    .session-detail-modal-container { background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.9)); backdrop-filter: saturate(200%) blur(30px); -webkit-backdrop-filter: saturate(200%) blur(30px); border-radius: 0; border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 25px 80px rgba(0,0,0,0.15), 0 10px 30px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.9); width: 100%; max-width: 100%; height: 100%; max-height: 100%; overflow: hidden; transform: scale(0.9) translateY(20px); transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); display: flex; flex-direction: column; }
    .session-detail-modal-overlay.active .session-detail-modal-container { transform: scale(1) translateY(0); }
    .session-detail-modal-header { padding: 32px 40px 24px; background: var(--apple-white); border-bottom: 1px solid var(--apple-gray-2); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .session-detail-modal-title-section { display: flex; align-items: center; gap: 16px; flex: 1; }
    .session-detail-modal-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; background: var(--apple-blue); }
    .session-detail-modal-title-content h2 { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.021em; margin-bottom: 6px; }
    .session-detail-modal-title-content .session-date { font-size: 14px; color: var(--apple-gray-4); }
    .session-detail-modal-close { width: 36px; height: 36px; border-radius: 50%; background: var(--apple-gray-1); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--apple-gray-5); transition: all 0.2s ease; flex-shrink: 0; }
    .session-detail-modal-close:hover { background: var(--apple-gray-2); color: var(--apple-black); }
    .session-detail-modal-content { padding: 32px 40px 40px; overflow-y: auto; flex: 1; background: var(--apple-gray-1); }
    .conversation-block { background: var(--apple-white); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid var(--apple-gray-2); }
    .conversation-block:last-child { margin-bottom: 0; }
    .conversation-block-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--apple-gray-2); }
    .conversation-block-role { font-family: var(--font-display); font-size: 15px; font-weight: 600; }
    .conversation-block-role.user { color: var(--apple-blue); }
    .conversation-block-role.assistant { color: var(--apple-black); }
    .conversation-block-role.tool { color: #FF9500; }
    .conversation-block-time { font-size: 13px; color: var(--apple-gray-4); margin-left: auto; }
    .conversation-block-content { font-size: 14px; line-height: 1.6; color: var(--apple-black); white-space: pre-wrap; }
    .conversation-block-content details { margin: 12px 0; background: var(--apple-gray-1); border: 1px solid var(--apple-gray-2); border-radius: 8px; padding: 10px 16px; }
    .conversation-block-content summary { cursor: pointer; font-weight: 600; font-size: 13px; color: var(--apple-gray-5); user-select: none; margin-bottom: 4px; }
    .conversation-block-content summary:hover { color: var(--apple-blue); }
    .conversation-block-content details[open] summary { margin-bottom: 8px; }
    .conversation-block-content code:not(pre code) { background: var(--apple-gray-1); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: var(--apple-black); }
    .conversation-block-content pre { position: relative; background: #1d1f21; border-radius: 12px; overflow-x: auto; margin: 12px 0; border: 1px solid #3a3d42; padding: 0; }
    .conversation-block-content pre code { display: block; padding: 40px 16px 16px; background: none; font-family: 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; }
    .code-block-header { position: absolute; top: 0; left: 0; right: 0; height: 36px; background: #2d2f33; border-bottom: 1px solid #3a3d42; border-radius: 12px 12px 0 0; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; z-index: 2; }
    .code-block-lang { font-size: 11px; font-weight: 600; color: #9aa0a6; text-transform: uppercase; letter-spacing: 0.05em; }
    .code-block-copy { font-size: 12px; font-weight: 500; color: #9aa0a6; background: transparent; border: 1px solid #5f6368; border-radius: 6px; padding: 3px 10px; cursor: pointer; transition: all 0.2s ease; font-family: var(--font-text); }
    .code-block-copy:hover { color: var(--apple-white); background: #5f6368; border-color: #5f6368; }
    .code-block-copy.copied { color: #34C759; border-color: #34C759; }
    .tool-block { background: linear-gradient(135deg, rgba(255,149,0,0.05), rgba(255,149,0,0.02)); border: 1px solid rgba(255,149,0,0.15); }
    .tool-block .conversation-block-role.tool { color: #FF9500; }
    .tool-detail { margin-top: 12px; }
    .tool-detail-label { font-size: 12px; font-weight: 600; color: var(--apple-gray-5); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .tool-detail-content { position: relative; background: #1d1f21; border-radius: 8px; padding: 40px 12px 12px; font-family: 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; color: #abb2bf; border: 1px solid #3a3d42; }
    .tool-detail-content .code-block-header { border-radius: 8px 8px 0 0; }
    .tool-detail-content pre { border-radius: 8px; }
    .session-detail-note { text-align: center; padding: 40px 20px; color: var(--apple-gray-4); font-size: 14px; line-height: 1.8; }
    .session-stats-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .session-stats-bar.hidden { display: none; }
    .stats-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--apple-gray-5); background: var(--apple-gray-1); border: 1px solid var(--apple-gray-2); padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .stats-chip.cost { color: #FF9500; background: rgba(255,149,0,0.10); border-color: rgba(255,149,0,0.2); }
    .usage-badge { display: inline-flex; align-items: center; gap: 6px; margin-left: 10px; font-size: 11px; font-weight: 500; color: var(--apple-gray-5); background: rgba(142,142,147,0.10); border: 1px solid rgba(142,142,147,0.18); padding: 2px 9px; border-radius: 9999px; white-space: nowrap; flex-shrink: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; max-width: 50%; box-sizing: border-box; }
    .usage-badge.warn { color: #FF9500; background: rgba(255,149,0,0.10); border-color: rgba(255,149,0,0.25); }
    .usage-badge.error { color: #FF3B30; background: rgba(255,59,48,0.10); border-color: rgba(255,59,48,0.25); }
    .usage-badge.compaction { color: #AF52DE; background: rgba(175,82,222,0.10); border-color: rgba(175,82,222,0.25); }
    .session-section-divider { display: flex; align-items: center; gap: 12px; margin: 28px 0 20px; color: var(--apple-gray-4); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .session-section-divider::before, .session-section-divider::after { content: ''; flex: 1; height: 1px; background: var(--apple-gray-2); }
    .turn-group { background: var(--apple-white); border: 1px solid var(--apple-gray-2); border-radius: 14px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); overflow: hidden; }
    .turn-group:last-child { margin-bottom: 0; }
    .turn-header { display: flex; align-items: center; gap: 12px; padding: 13px 16px; cursor: pointer; user-select: none; transition: background 0.2s ease; }
    .turn-header:hover { background: var(--apple-gray-1); }
    .turn-chevron { flex-shrink: 0; color: var(--apple-gray-4); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); }
    .turn-group.open .turn-chevron { transform: rotate(90deg); }
    .turn-badge { flex-shrink: 0; font-family: var(--font-display); font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: var(--apple-white); background: var(--apple-blue); padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .turn-badge.context { color: var(--apple-gray-5); background: var(--apple-gray-2); }
    .turn-summary { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--apple-black); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .turn-meta { flex-shrink: 0; font-size: 12px; color: var(--apple-gray-4); }
    .turn-body { display: none; padding: 14px 16px 16px; border-top: 1px solid var(--apple-gray-2); background: var(--apple-gray-1); }
    .turn-group.open .turn-body { display: block; }
    .turn-body .conversation-block { margin-bottom: 14px; }
    .turn-body .conversation-block:last-child { margin-bottom: 0; }
    @media (max-width: 768px) {
      .session-detail-modal-container { width: 100%; max-height: 100%; border-radius: 0; }
      .session-detail-modal-header { padding: 24px 24px 20px; }
      .session-detail-modal-icon { width: 40px; height: 40px; }
      .session-detail-modal-title-content h2 { font-size: 18px; }
      .session-detail-modal-content { padding: 24px 24px 32px; }
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

// 主索引页：仅含元数据（项目卡片 + 全局时间线 + 搜索），不内联对话内容
function buildOverviewHtml(projects: ProjectData[], totalSessions: number): string {
  const generatedTime = new Date().toLocaleString('zh-CN');
  const projectCount = projects.length;
  const categoryStats = computeCategoryStats(projects);
  const dashboard = buildDashboard(categoryStats, totalSessions);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Overview</title>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
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

  <footer><p class="footer-text">Generated by opencode-autorecord plugin</p></footer>

  <script>
    function getProjectColor(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash;
      }
      const colors = ['#007AFF','#AF52DE','#FF9500','#34C759','#5AC8FA','#FF2D55','#00C7BE','#FFCC00','#5856D6','#1D1D1F'];
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

function buildProjectHtml(project: ProjectData): string {
  const color = getProjectColor(project.name);
  const icon = getProjectIcon(project.name);
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
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(project.name)} - OpenCode Overview</title>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
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
      </div>
    </div>
  </nav>

  <div class="container">
    <div class="project-hero" style="--project-accent-color:${color}">
      <div class="project-hero-icon" style="background:${color}">
        <i data-lucide="${icon}" style="width:28px;height:28px;color:white"></i>
      </div>
      <div>
        <h1>${escapeHtml(project.name)}</h1>
        <div class="project-hero-meta">
          <span>${sessions.length} 个会话</span>
          <span>时间跨度: ${timeRangeText}</span>
          <span>最后对话: ${lastMod}</span>
        </div>
      </div>
    </div>

    <div class="global-timeline-wrapper">
      <div class="global-timeline-header">
        <h3>会话时间线</h3>
        <span class="global-timeline-count">共 ${sessions.length} 个会话</span>
      </div>
      <div class="global-timeline" id="globalTimeline">${timelineItems}</div>
    </div>
  </div>

  <footer><p class="footer-text">Generated by opencode-autorecord plugin</p></footer>

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
            <div class="session-stats-bar" id="sessionDetailModalStats"></div>
          </div>
        </div>
        <button class="session-detail-modal-close" data-action="close-session-detail">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="session-detail-modal-content" id="sessionDetailModalContent">
      </div>
    </div>
  </div>

  <script>
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
      if (stats && (stats.totalCost > 0 || stats.totalTokens > 0)) {
        const chips = [
          '<span class="stats-chip cost">💰 $' + Number(stats.totalCost).toFixed(4) + '</span>',
          '<span class="stats-chip">🪙 ' + fmtNum(stats.totalTokens) + ' tokens</span>'
        ];
        Object.entries(stats.byModel || {}).forEach(([model, row]) => {
          chips.push('<span class="stats-chip">' + escapeHtml(model) + ' × ' + (row.calls || 0) + '</span>');
        });
        bar.innerHTML = chips.join('');
        bar.classList.remove('hidden');
      } else {
        bar.innerHTML = '';
        bar.classList.add('hidden');
      }
    }

    function formatUsageBadge(u) {
      if (!u) return '';
      const bits = [];
      if (u.modelID) bits.push(u.modelID);
      const inTok = u.input || 0, outTok = u.output || 0;
      if (inTok || outTok) bits.push('↑' + fmtNum(inTok) + ' ↓' + fmtNum(outTok));
      if (u.cost) bits.push('$' + Number(u.cost).toFixed(4));
      if (u.durationMs) bits.push((u.durationMs / 1000).toFixed(1) + 's');

      let cls = 'usage-badge';
      let prefix = '';
      if (u.error) { cls += ' error'; prefix = '❌ '; }
      else if (u.finish && /max|length/i.test(u.finish)) { cls += ' warn'; prefix = '⚠️ '; }
      else if (u.finish && /abort|cancel|interrupt/i.test(u.finish)) { cls += ' warn'; prefix = '🛑 '; }
      if (u.compaction) { cls += ' compaction'; prefix += '📦 '; }

      return '<span class="' + cls + '">' + prefix + escapeHtml(bits.join(' · ')) + '</span>';
    }

    function openSessionDetailModal(filename) {
      const session = findSessionByFilename(filename);
      if (!session) return;
      document.getElementById('sessionDetailModalTitle').textContent = session.title;
      document.getElementById('sessionDetailModalDate').textContent = session.date;
      renderSessionStatsBar(session.stats);

      const contentEl = document.getElementById('sessionDetailModalContent');
      let html = '';

      if (session.conversationBlocks && session.conversationBlocks.length > 0) {
        html = renderTurnSections(session.conversationBlocks);
      } else {
        html = '<div class="session-detail-note">该会话时间较早，HTML 中未内联完整对话内容。<br>完整内容请查看对应 Markdown 文件：<br><code>' + escapeHtml(session.filename) + '</code></div>';
      }

      contentEl.innerHTML = html;
      document.getElementById('sessionDetailModalOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function renderBlockCard(block) {
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
        html += '<div style="margin-bottom: 12px;"><span style="font-size: 12px; font-weight: 600; color: var(--apple-gray-5); text-transform: uppercase; letter-spacing: 0.05em;">状态</span><span style="margin-left: 8px; font-size: 13px; color: var(--apple-black);">' + escapeHtml(block.toolStatus) + '</span></div>';
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

    /**
     * 按用户提问划分轮次渲染（可折叠手风琴）。
     * 分段规则：turn===1 且 role==='user' 的块开启新的会话段（对应 topic 文件中的一个 session 块）；
     * 段内按 turn 编号分组。旧数据（无 role/turn 字段）降级为平铺渲染。
     */
    function renderTurnSections(blocks) {
      const hasTurnInfo = blocks.some(b => b.role === 'user' && typeof b.turn === 'number' && b.turn > 0);
      if (!hasTurnInfo) {
        return blocks.map(renderBlockCard).join('');
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

      let html = '';
      sections.forEach((sec, si) => {
        if (si > 0) {
          html += '<div class="session-section-divider"><span>续篇会话 · ' + (si + 1) + '/' + sections.length + '</span></div>';
        }
        sec.forEach((group) => {
          const firstUser = group.blocks.find(b => b.role === 'user' && b.content);
          const summarySource = (firstUser ? firstUser.content : '') || '';
          const summaryLine = summarySource.split('\\n').map(l => l.trim()).find(l => l && l.indexOf(INJECTED_MARKER) !== 0) || '';
          const shortSummary = summaryLine.length > 80 ? summaryLine.substring(0, 80) + '…' : (summaryLine || '(无文本)');
          const timeLabel = firstUser ? firstUser.timestamp : '';
          const isContext = group.key === 0;

          html += '<div class="turn-group" data-turn-group>';
          html += '<div class="turn-header" data-action="toggle-turn">';
          html += '<svg class="turn-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
          html += '<span class="turn-badge' + (isContext ? ' context' : '') + '">' + (isContext ? '上下文' : '第 ' + group.key + ' 轮') + '</span>';
          html += '<span class="turn-summary">' + escapeHtml(shortSummary) + '</span>';
          if (timeLabel) {
            html += '<span class="turn-meta">' + escapeHtml(timeLabel) + '</span>';
          }
          html += '</div>';
          html += '<div class="turn-body">';
          group.blocks.forEach(b => { html += renderBlockCard(b); });
          html += '</div>';
          html += '</div>';
        });
      });
      return html;
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
          const groupEl = actionEl.closest('[data-turn-group]');
          if (groupEl) {
            groupEl.classList.toggle('open');
            const body = groupEl.querySelector('.turn-body');
            if (groupEl.classList.contains('open') && body && typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
              Prism.highlightAllUnder(body);
            }
          }
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
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, filePath);
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
 * 视图渲染结构版本。HTML 渲染逻辑发生结构性变化（如轮次手风琴分组）时 +1，
 * regenerateViews 检测到不一致会强制重建全部项目页（存量页面刷新）。
 */
const VIEW_VERSION = 1;

export async function regenerateViews(globalSaveDir: string): Promise<void> {
  const baseDir = globalSaveDir;
  const logPath = join(baseDir, '.autorecord-views.log');

  try {
    // Validate and repair indexes (also handles v1 migration)
    const index = await validateAndRepairIndexes(baseDir);
    let projects: ProjectData[];
    let isIncremental = false;
    let unchangedProjects: string[] = [];

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeViewLog(logPath, `ERROR: Failed to regenerate views - ${message}`);
    throw error;
  }
}
