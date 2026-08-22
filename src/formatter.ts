import { INJECTED_CONTEXT_MARKER, TURN_SEPARATOR } from './types.js';
import type {
  MessageData,
  PartData,
  TextPartData,
  ToolPartData,
  FilePartData,
  ReasoningPartData,
  ChildSessionData,
  SessionUsageStats,
} from './types.js';

/**
 * 真实用户输入判定：user 消息中存在非 synthetic 内容 part
 * （非 synthetic 文本，或文件等其他类型 part；step-start/step-finish 边界标记除外）。
 * 仅由系统注入（synthetic-only）构成的消息不开新轮次，归入当前轮次。
 */
export function isRealUserInput(message: MessageData): boolean {
  if (message.role !== 'user') return false;
  return message.parts.some((part) => {
    if (part.type === 'text' && 'text' in part) return !part.synthetic;
    return part.type !== 'step-start' && part.type !== 'step-finish';
  });
}

export function formatSession(
  _sessionId: string,
  title: string,
  createdAt: Date,
  messages: MessageData[],
  childSessions: ChildSessionData[]
): string {
  const lines: string[] = [];

  lines.push(`Session: ${title}`);
  lines.push('');
  lines.push(`**Created:** ${formatTimestamp(createdAt)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const stats = computeSessionUsageStats(messages, childSessions);
  if (stats) {
    lines.push(formatUsageStatsSection(stats));
    lines.push('');
  }

  for (const message of messages) {
    if (isRealUserInput(message)) {
      lines.push(TURN_SEPARATOR);
      lines.push('');
    }
    lines.push(formatMessage(message));
    lines.push('');
  }

  if (childSessions.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Child Sessions');
    lines.push('');

    for (const child of childSessions) {
      lines.push(formatChildSession(child));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Aggregate token/cost usage across a session's messages (main + child).
 * Returns null when no message carries usage information.
 */
export function computeSessionUsageStats(
  messages: MessageData[],
  childSessions?: ChildSessionData[]
): SessionUsageStats | null {
  let stats: SessionUsageStats | null = null;

  const addMessage = (message: MessageData): void => {
    if (!message.tokens && typeof message.cost !== 'number') return;
    if (!stats) {
      stats = {
        byModel: {},
        totalCost: 0,
        totalTokens: 0,
        assistantMessages: 0,
      };
    }
    const s = stats;
    s.assistantMessages += 1;

    const tokens = message.tokens;
    const input = tokens?.input ?? 0;
    const output = tokens?.output ?? 0;
    const reasoning = tokens?.reasoning ?? 0;
    const cacheRead = tokens?.cacheRead ?? 0;
    const cacheWrite = tokens?.cacheWrite ?? 0;
    const cost = typeof message.cost === 'number' ? message.cost : 0;

    s.totalCost += cost;
    s.totalTokens += input + output + reasoning;

    const modelKey = message.modelID || 'unknown';
    let row = s.byModel[modelKey];
    if (!row) {
      row = { calls: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      s.byModel[modelKey] = row;
    }
    row.calls += 1;
    row.input += input;
    row.output += output;
    row.reasoning += reasoning;
    row.cacheRead += cacheRead;
    row.cacheWrite += cacheWrite;
    row.cost += cost;
  };

  for (const message of messages) {
    addMessage(message);
  }
  for (const child of childSessions ?? []) {
    for (const message of child.messages) {
      addMessage(message);
    }
  }

  return stats;
}

/**
 * One-line machine-parseable usage metadata for an assistant message.
 *
 * Format (order fixed, keys omitted when value is zero/absent):
 * `📊 provider=anthropic model=claude-x in=1 out=2 reason=3 cacheread=4 cachewrite=5 cost=$0.1 dur=1.5s finish=stop compaction error="..."`
 */
export function formatAssistantMeta(message: MessageData): string {
  if (!message.tokens && typeof message.cost !== 'number') {
    return '';
  }

  const parts: string[] = ['📊'];
  if (message.providerID) parts.push(`provider=${message.providerID}`);
  if (message.modelID) parts.push(`model=${message.modelID}`);

  const tokens = message.tokens;
  if (tokens) {
    parts.push(`in=${tokens.input}`, `out=${tokens.output}`);
    if (tokens.reasoning > 0) parts.push(`reason=${tokens.reasoning}`);
    if (tokens.cacheRead > 0) parts.push(`cacheread=${tokens.cacheRead}`);
    if (tokens.cacheWrite > 0) parts.push(`cachewrite=${tokens.cacheWrite}`);
  }
  if (typeof message.cost === 'number') {
    parts.push(`cost=$${message.cost.toFixed(4)}`);
  }
  if (typeof message.durationMs === 'number' && message.durationMs > 0) {
    parts.push(`dur=${(message.durationMs / 1000).toFixed(1)}s`);
  }
  if (message.finishReason) parts.push(`finish=${message.finishReason}`);
  if (message.summary) parts.push('compaction');
  if (message.errorMessage) parts.push(`error="${message.errorMessage.replace(/"/g, "'")}"`);

  return parts.join(' ');
}

/** Human-readable warning block appended after the meta line on abnormal finish. */
function formatFinishWarning(message: MessageData): string {
  if (message.errorMessage) {
    return `> ❌ **请求失败 / Request failed**: ${message.errorMessage}`;
  }
  const finish = message.finishReason?.toLowerCase() ?? '';
  if (finish.includes('max') || finish.includes('length')) {
    return `> ⚠️ **输出被截断 / Output truncated** (finish=${message.finishReason})`;
  }
  if (finish.includes('abort') || finish.includes('cancel') || finish.includes('interrupt')) {
    return `> 🛑 **输出被中断 / Output interrupted** (finish=${message.finishReason})`;
  }
  return '';
}

/** Markdown statistics table for the whole session (main + child sessions). */
export function formatUsageStatsSection(stats: SessionUsageStats): string {
  const lines: string[] = [];

  lines.push('## 📊 Usage / 用量统计');
  lines.push('');
  lines.push('| Model | Calls | Input | Output | Reasoning | Cache Read | Cache Write | Cost ($) |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const [model, row] of Object.entries(stats.byModel)) {
    lines.push(
      `| ${model} | ${row.calls} | ${row.input} | ${row.output} | ${row.reasoning} | ${row.cacheRead} | ${row.cacheWrite} | ${row.cost.toFixed(4)} |`
    );
  }
  lines.push(
    `| **Total** | ${stats.assistantMessages} | - | - | - | - | - | ${stats.totalCost.toFixed(4)} |`
  );

  lines.push('');
  lines.push(`Total tokens: ${stats.totalTokens.toLocaleString('en-US')} (input + output + reasoning)`);

  return lines.join('\n');
}

export function formatMessage(message: MessageData): string {
  const lines: string[] = [];
  const roleEmoji = message.role === 'user' ? '👤' : '🤖';
  const roleLabel = message.role === 'user' ? 'User' : 'Assistant';
  const headingLevel = message.role === 'user' ? '##' : '###';

  const tags: string[] = [];
  const assistantTag = message.role === 'assistant' ? getAssistantTag(message.parts) : '';
  if (assistantTag) tags.push(assistantTag);
  if (message.summary) tags.push('📦 Compaction Summary / 压缩摘要');

  lines.push(`${headingLevel} ${roleEmoji} ${roleLabel}${tags.length > 0 ? ` ${tags.join(' · ')}` : ''}`);
  lines.push(`*${formatTimestamp(new Date(message.createdAt))}*`);

  if (message.role === 'assistant') {
    const meta = formatAssistantMeta(message);
    if (meta) {
      lines.push('');
      lines.push(meta);
      const warning = formatFinishWarning(message);
      if (warning) {
        lines.push('');
        lines.push(warning);
      }
    }
  }
  lines.push('');

  for (const part of message.parts) {
    const formattedPart = formatPart(part);
    if (formattedPart) {
      lines.push(formattedPart);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

export function formatPart(part: PartData): string {
  if (part.type === 'text' && 'text' in part) {
    return formatTextPart(part as TextPartData);
  }
  if (part.type === 'tool' && 'tool' in part && 'state' in part) {
    return formatToolPart(part as ToolPartData);
  }
  if (part.type === 'file' && 'url' in part && 'mime' in part) {
    return formatFilePart(part as FilePartData);
  }
  if (part.type === 'reasoning' && 'text' in part) {
    return formatReasoningPart(part as ReasoningPartData);
  }
  // step-start / step-finish 为 agent 步骤边界标记，无展示价值，不写入文档
  if (part.type === 'step-start' || part.type === 'step-finish') {
    return '';
  }
  return `*[${part.type} part]*`;
}

export function formatTextPart(part: TextPartData): string {
  if (part.synthetic) {
    return [INJECTED_CONTEXT_MARKER, '', part.text].join('\n');
  }
  return part.text;
}

export function formatToolPart(part: ToolPartData): string {
  const lines: string[] = [];
  const { tool, state } = part;

  lines.push(`#### 🔧 Tool: ${tool}`);
  lines.push(`**Status:** ${state.status}`);

  if (state.title) {
    lines.push(`**Title:** ${state.title}`);
  }

  if (state.input && Object.keys(state.input).length > 0) {
    lines.push('');
    lines.push('**Input:**');
    lines.push('```json');
    lines.push(JSON.stringify(state.input, null, 2));
    lines.push('```');
  }

  if (state.output) {
    const lang = detectLanguage(state.output);
    lines.push('');
    lines.push('**Output:**');
    lines.push(`\`\`\`${lang}`);
    lines.push(state.output);
    lines.push('```');
  }

  if (state.error) {
    const lang = detectLanguage(state.error);
    lines.push('');
    lines.push('**Error:**');
    lines.push(`\`\`\`${lang}`);
    lines.push(state.error);
    lines.push('```');
  }

  lines.push('[step-finish]');

  return lines.join('\n');
}

export function formatFilePart(part: FilePartData): string {
  const filename = part.filename || 'unnamed';

  if (part.localPath && part.mime.startsWith('image/')) {
    return `![${filename}](${part.localPath})`;
  }

  const lines: string[] = [];
  lines.push(`📁 **File:** ${filename}`);
  lines.push(`- MIME: ${part.mime}`);
  if (!part.url.startsWith('data:')) {
    lines.push(`- URL: ${part.url}`);
  }

  return lines.join('\n');
}

export function formatReasoningPart(part: ReasoningPartData): string {
  const lines: string[] = [];
  const textWithBr = part.text.replace(/\n/g, '<br>');

  lines.push('[step-start]');
  lines.push('💭 **Reasoning:**');
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Click to expand reasoning</summary>');
  lines.push(textWithBr);
  lines.push('</details>');
  lines.push('[step-end]');

  return lines.join('\n');
}

export function formatChildSession(child: ChildSessionData): string {
  const lines: string[] = [];

  lines.push(`### 📦 Subagent: ${child.title}`);
  lines.push(`*Started: ${formatTimestamp(child.createdAt)}*`);
  lines.push('');

  for (const message of child.messages) {
    const roleEmoji = message.role === 'user' ? '👤' : '🤖';
    const roleLabel = message.role === 'user' ? 'User' : 'Assistant';

  lines.push(`#### ${roleEmoji} ${roleLabel}`);
  lines.push(`*${formatTimestamp(new Date(message.createdAt))}*`);

  if (message.role === 'assistant') {
    const meta = formatAssistantMeta(message);
    if (meta) {
      lines.push('');
      lines.push(meta);
      const warning = formatFinishWarning(message);
      if (warning) {
        lines.push('');
        lines.push(warning);
      }
    }
  }
  lines.push('');

    for (const part of message.parts) {
      const formattedPart = formatPart(part);
      if (formattedPart) {
        lines.push(formattedPart);
        lines.push('');
      }
    }
  }

  return lines.join('\n').trim();
}

function detectLanguage(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return '';
  }

  const firstLine = trimmed.split('\n')[0].toLowerCase();

  // 1. Shebang detection (most reliable)
  if (firstLine.startsWith('#!')) {
    if (firstLine.includes('python')) return 'python';
    if (firstLine.includes('node')) return 'javascript';
    if (firstLine.includes('bash') || firstLine.includes('sh')) return 'bash';
    if (firstLine.includes('ruby')) return 'ruby';
    if (firstLine.includes('perl')) return 'perl';
    if (firstLine.includes('php')) return 'php';
    return '';
  }

  // 2. Feature-based detection
  const sample = trimmed.substring(0, 3000);

  // Python
  if (/(?:^|\n)\s*(?:def\s+\w+\s*\(|class\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|if\s+__name__\s*==)\b/.test(sample)) {
    return 'python';
  }

  // JavaScript / TypeScript
  if (/(?:^|\n)\s*(?:const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+\s*\(|=>|require\s*\(|console\.log)\b/.test(sample)) {
    if (/(?:^|\n)\s*(?:interface\s+\w+|type\s+\w+\s*=|:\s*(?:string|number|boolean|any|void)\b)/.test(sample)) {
      return 'typescript';
    }
    return 'javascript';
  }

  // Shell / Bash
  if (/(?:^|\n)\s*(?:echo\s|export\s|source\s|cd\s|mkdir\s|rm\s|cat\s|grep\s|awk\s|sed\s|curl\s|wget\s|sudo\s|chmod\s|chown\s|tar\s|zip\s|unzip\s|ssh\s|scp\s)\b/.test(sample)) {
    return 'bash';
  }

  // JSON
  if (/^\s*[\{\[]/.test(trimmed) && /"[^"]+"\s*:/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // not valid JSON, continue
    }
  }

  // HTML
  if (/^\s*<(!DOCTYPE|html|div|span|p|script|style|body|head|meta|link|title|h[1-6]|a\s|ul|ol|li|table|form|input|button|img)/i.test(trimmed)) {
    return 'html';
  }

  // CSS
  if (/(?:^|\n)\s*(?:@import|@media|body\s*\{|#\w+\s*\{|\.\w+\s*\{|color\s*:|font-size\s*:|display\s*:|margin\s*:|padding\s*:|background\s*:)/i.test(sample)) {
    return 'css';
  }

  // SQL
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b.*\b(?:FROM|INTO|TABLE|DATABASE)\b/i.test(sample)) {
    return 'sql';
  }

  // YAML
  if (/^\s*(?:\w+\s*:\s*\S|-\s+\w+\s*:\s*\S)/m.test(trimmed)) {
    return 'yaml';
  }

  return '';
}

function getAssistantTag(parts: PartData[]): string {
  const hasReasoning = parts.some(p => p.type === 'reasoning');
  const hasTool = parts.some(p => p.type === 'tool');
  const hasText = parts.some(p => p.type === 'text');

  if (hasReasoning) {
    return '[分析过程]';
  }
  if (hasTool) {
    return '[执行过程]';
  }
  if (hasText) {
    return '[回复内容]';
  }
  return '';
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function extractTopicFromMessage(messageText: string, maxLength: number): string {
  const cleaned = messageText
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned || 'untitled';
  }

  const truncated = cleaned.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.5) {
    return truncated.substring(0, lastSpace);
  }

  return truncated;
}
