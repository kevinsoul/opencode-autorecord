import { readdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  loadIndex,
  saveIndex,
  createEmptyIndex,
  updateFileIndex,
  removeFileFromIndex,
  getFilesToProcess,
  convertIndexToProjects,
  type AutorecordIndex,
  type SessionInfo,
  type ProjectData,
} from './index-manager.js';

// Re-export types for backward compatibility
export type { SessionInfo, ProjectData };

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConversationBlock {
  type: 'message' | 'tool';
  timestamp: string;
  content?: string;
  toolName?: string;
  toolStatus?: string;
  toolInput?: string;
  toolOutput?: string;
}

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

function extractFullConversation(content: string): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect assistant message block
    if (line.includes('### 🤖 Assistant')) {
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
      const messageLines: string[] = [];
      let inToolBlock = false;
      let toolBlock: ConversationBlock | null = null;
      let inStepBlock = false;
      let stepLines: string[] = [];

      while (i < lines.length) {
        const currentLine = lines[i];

        // Check for next assistant block or end of conversation
        if (currentLine.includes('### 🤖 Assistant') || currentLine.startsWith('---')) {
          break;
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

        // Check for tool block end
        if (inToolBlock && currentLine.includes('[step-finish')) {
          // Save tool block
          if (toolBlock) {
            blocks.push(toolBlock);
          }
          inToolBlock = false;
          toolBlock = null;
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

      continue;
    }

    i += 1;
  }

  return blocks;
}

function extractSessionInfo(filePath: string, content: string): SessionInfo | null {
  const sessionMatch = content.match(/# Session:\s*(.+)/);
  const title = sessionMatch ? sessionMatch[1].trim() : 'Unknown Session';

  const dateMatch = content.match(/\*\*Created:\*\*\s*(.+)/);
  const date = dateMatch ? dateMatch[1].trim() : 'Unknown Date';

  const blocks = extractFullConversation(content);

  // Extract user request from first message block
  let userRequest = '无明确请求';
  const firstMessage = blocks.find((b) => b.type === 'message');
  if (firstMessage?.content) {
    userRequest = firstMessage.content
      .replace(/\[.*?\]/g, '')
      .replace(/<.*?>/g, '')
      .trim();
    if (userRequest.length > 200) {
      userRequest = userRequest.substring(0, 200) + '...';
    }
  }

  return {
    title,
    date,
    userRequest,
    category: categorizeSession(title),
    filename: basename(filePath),
  };
}

// ─── Project Scanning ────────────────────────────────────────────────────────

// Helper functions for incremental scanning
async function listProjects(baseDir: string): Promise<Array<{ name: string; dir: string }>> {
  const entries = await readdir(baseDir, { withFileTypes: true });
  const projects: Array<{ name: string; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '__pycache__') {
      continue;
    }
    projects.push({ name: entry.name, dir: join(baseDir, entry.name) });
  }

  return projects;
}

async function listMdFiles(projectDir: string): Promise<string[]> {
  const files = await readdir(projectDir, { withFileTypes: true });
  return files
    .filter((f) => f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('对话式问答文档'))
    .map((f) => join(projectDir, f.name));
}

async function scanProjectsIncremental(
  baseDir: string,
  index: AutorecordIndex
): Promise<ProjectData[]> {
  const { newFiles, modifiedFiles, deletedFiles } = await getFilesToProcess(
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
  index.lastFullScan = Date.now();

  // Convert index to projects format
  return convertIndexToProjects(index);
}

// Fallback full scan (used when no index exists or for periodic rebuilds)
async function scanProjectsFull(baseDir: string): Promise<ProjectData[]> {
  const projects: ProjectData[] = [];
  const projectList = await listProjects(baseDir);

  for (const project of projectList) {
    const mdFiles = await listMdFiles(project.dir);
    if (mdFiles.length === 0) continue;

    const sessions: SessionInfo[] = [];
    let lastModified = 0;

    for (const filePath of mdFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const info = extractSessionInfo(filePath, content);
        if (info) {
          sessions.push(info);
        }
        const s = await stat(filePath);
        if (s.mtimeMs > lastModified) lastModified = s.mtimeMs;
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
        lastModified,
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

// ─── QA Document Generator ───────────────────────────────────────────────────

function formatConversationBlock(block: ConversationBlock, index: number): string {
  const lines: string[] = [];

  if (block.type === 'message') {
    const content = block.content || '';

    // Clean up step markers
    const cleanContent = content
      .replace(/\*\[step-start.*?\]\*/g, '')
      .replace(/\*\[step-end.*?\]\*/g, '')
      .replace(/\*\[step-finish.*?\]\*/g, '')
      .trim();

    if (!cleanContent) {
      return '';
    }

    // Determine if this is a user request (first message) or assistant reply
    if (index === 0) {
      lines.push(`**[${block.timestamp}]** 💭 用户请求`);
      lines.push(`> ${cleanContent}`);
    } else {
      lines.push(`**[${block.timestamp}]** 🤖 助手`);
      lines.push(`${cleanContent}`);
    }
  } else if (block.type === 'tool') {
    lines.push(`#### 🔧 Tool: ${block.toolName}`);

    if (block.toolStatus) {
      lines.push(`- **状态**: ${block.toolStatus}`);
    }

    if (block.toolInput) {
      // Try to format as JSON if possible
      try {
        const inputJson = JSON.parse(block.toolInput);
        const inputFormatted = JSON.stringify(inputJson, null, 2);
        lines.push(`- **输入**:`);
        lines.push(`\`\`\`json`);
        lines.push(inputFormatted);
        lines.push(`\`\`\``);
      } catch {
        lines.push(`- **输入**: \`${block.toolInput}\``);
      }
    }

    if (block.toolOutput) {
      lines.push(`- **输出**:`);
      lines.push(`\`\`\``);
      lines.push(block.toolOutput);
      lines.push(`\`\`\``);
    }
  }

  return lines.join('\n');
}

async function generateQADocument(projectDir: string, sessions: SessionInfo[], contentMap: Map<string, string>): Promise<number> {
  if (sessions.length === 0) return 0;

  const projectName = basename(projectDir);
  const lines: string[] = [];

  lines.push(`# ${projectName} 项目开发问答记录\n`);
  lines.push(`> 本文档整理了 **${projectName}** 项目的完整开发对话记录，包含所有用户请求、助手回复、工具调用和思考过程。\n`);
  lines.push('---\n');

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const dateStr = s.date.includes(' ') ? s.date.split(' ')[0] : s.date;

    lines.push(`## ${i + 1}. ${s.title}\n`);
    lines.push(`**时间**: ${dateStr}  `);
    lines.push(`**来源**: \`${s.filename}\`  `);
    lines.push(`**分类**: ${s.category}\n`);
    lines.push(`### 对话记录\n`);

    // Extract full conversation from original content
    const originalContent = contentMap.get(s.filename);
    if (originalContent) {
      const blocks = extractFullConversation(originalContent);
      for (let idx = 0; idx < blocks.length; idx++) {
        const formatted = formatConversationBlock(blocks[idx], idx);
        if (formatted) {
          lines.push(formatted);
          lines.push('');
        }
      }
    }

    lines.push('---\n');
  }

  const outputPath = join(projectDir, '对话式问答文档.md');
  await writeFile(outputPath, lines.join('\n'), 'utf-8');
  return sessions.length;
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

function buildProjectCards(projects: ProjectData[]): string {
  return projects.map((p) => {
    const color = getProjectColor(p.name);
    const icon = getProjectIcon(p.name);
    const lastMod = formatTimestamp(p.lastModified);

    return `
      <div class="project-card" data-project="${escapeHtml(p.name)}" style="--project-accent-color:${color}">
        <div class="project-header" onclick="openModal('${escapeHtml(p.name)}')">
          <div class="project-title-section">
            <div class="project-icon" style="background:${color}">
              <i data-lucide="${icon}" style="width:20px;height:20px;color:white"></i>
            </div>
            <div class="project-info">
              <h2>${escapeHtml(p.name)}</h2>
              <span class="last-modified">最后更新: ${lastMod}</span>
            </div>
          </div>
          <div class="project-meta">
            <span class="badge">${p.count} 个会话</span>
          </div>
        </div>
      </div>`;
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

    return `
      <div class="timeline-item ${isFirst ? 'recent' : ''}" data-project="${escapeHtml(s.projectName.toLowerCase())}" data-title="${escapeHtml(s.title)}" data-request="${escapeHtml(s.userRequest)}">
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
            <div class="timeline-date">${formatDate(s.date)}</div>
          </div>
          <div class="timeline-title">${escapeHtml(s.title)}</div>
          <div class="timeline-request">${escapeHtml(s.userRequest)}</div>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildHtml(projects: ProjectData[], totalSessions: number, contentMap: Map<string, string>): string {
  const generatedTime = new Date().toLocaleString('zh-CN');
  const projectCount = projects.length;
  const categoryStats = computeCategoryStats(projects);
  const dashboard = buildDashboard(categoryStats, totalSessions);
  const projectCards = buildProjectCards(projects);
  const globalTimeline = buildGlobalTimeline(projects);

  // Build full project data for modal (not limited to 3 sessions)
  const fullProjectsData: Record<string, unknown> = {};
  for (const p of projects) {
    fullProjectsData[p.name] = {
      name: p.name,
      title: p.name,
      lastModified: formatTimestamp(p.lastModified),
      color: getProjectColor(p.name),
      sessions: p.sessions.map((s) => {
        // Extract full conversation blocks for this session
        const qaBlocks: Array<{ timestamp: string; role: 'user' | 'assistant'; content: string }> = [];
        const originalContent = contentMap.get(s.filename);
        if (originalContent) {
          const blocks = extractFullConversation(originalContent);
          let isFirstMessage = true;
          for (const block of blocks) {
            if (block.type === 'message' && block.content) {
              qaBlocks.push({
                timestamp: block.timestamp || s.date,
                role: isFirstMessage ? 'user' : 'assistant',
                content: block.content,
              });
              isFirstMessage = false;
            }
          }
        }
        return {
          title: s.title,
          request: s.userRequest,
          date: s.date,
          category: s.category,
          categoryStyle: `background:${(CATEGORY_COLORS[s.category] || CATEGORY_COLORS['开发讨论']).bg};color:${(CATEGORY_COLORS[s.category] || CATEGORY_COLORS['开发讨论']).text}`,
          qaBlocks,
        };
      }),
    };
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Overview</title>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  <style>
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
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-text);
      background: var(--apple-gray-1);
      color: var(--apple-black);
      line-height: 1.47059;
      -webkit-font-smoothing: antialiased;
    }
    .nav-bar {
      position: sticky; top: 0; z-index: 100;
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
    @media (max-width: 768px) {
      .nav-content { flex-wrap: wrap; gap: 16px; }
      .nav-left { width: 100%; gap: 16px; }
      .nav-search-container { max-width: none; order: 3; }
      .nav-stats { margin-left: auto; }
    }
    .dashboard-section {
      background: linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(245,245,247,0.6) 100%);
      border-bottom: 1px solid rgba(0,0,0,0.04); padding: 24px 48px 32px;
    }
    .dashboard-grid { max-width: 1400px; margin: 0 auto; display: flex; flex-wrap: nowrap; gap: 12px; overflow-x: auto; }
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
      .dashboard-section { padding: 16px 12px 20px; }
      .dashboard-grid { gap: 8px; }
      .dashboard-card { padding: 12px 6px; border-radius: 12px; min-width: 64px; }
      .dashboard-count { font-size: 22px; }
      .dashboard-label { font-size: 10px; }
      .dashboard-bar { max-width: 50px; }
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 48px 48px 64px; }
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
      border: 1px solid var(--apple-gray-2); cursor: pointer;
    }
    .session-item:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transform: translateX(4px); }
    .session-item.hidden { display: none; }
    .session-title { font-family: var(--font-display); font-size: 14px; font-weight: 600; line-height: 1.4; letter-spacing: -0.016em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 6px; }
    .session-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .session-date { font-size: 12px; color: var(--apple-gray-4); display: flex; align-items: center; gap: 6px; }
    .session-date::before { content: ''; width: 4px; height: 4px; background: var(--apple-gray-3); border-radius: 50%; }
    .category-tag { padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: -0.01em; }
    .session-request { font-size: 13px; color: var(--apple-gray-5); line-height: 1.4; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--apple-gray-2); }
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
    }
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 1000; display: none; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; }
    .modal-overlay.active { display: flex; opacity: 1; }
    .session-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 1001; display: none; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; }
    .session-modal-overlay.active { display: flex; opacity: 1; }
    .session-modal-container { background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.9)); backdrop-filter: saturate(200%) blur(30px); -webkit-backdrop-filter: saturate(200%) blur(30px); border-radius: 28px; border: 1px solid rgba(255,255,255,0.6); box-shadow: 0 25px 80px rgba(0,0,0,0.15), 0 10px 30px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.9); width: 90%; max-width: 900px; max-height: 85vh; overflow: hidden; transform: scale(0.9) translateY(20px); transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); display: flex; flex-direction: column; }
    .session-modal-overlay.active .session-modal-container { transform: scale(1) translateY(0); }
    .session-modal-header { padding: 32px 40px 24px; background: var(--apple-white); border-bottom: 1px solid var(--apple-gray-2); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .session-modal-title-section { display: flex; align-items: center; gap: 16px; flex: 1; }
    .session-modal-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; background: var(--project-accent-color, var(--apple-blue)); }
    .session-modal-title-content h2 { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.021em; margin-bottom: 6px; }
    .session-modal-meta { font-size: 14px; color: var(--apple-gray-4); }
    .session-modal-close { width: 36px; height: 36px; border-radius: 50%; background: var(--apple-gray-1); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--apple-gray-5); transition: all 0.2s ease; flex-shrink: 0; }
    .session-modal-close:hover { background: var(--apple-gray-2); color: var(--apple-black); }
    .session-modal-content { padding: 32px 40px 40px; overflow-y: auto; flex: 1; background: var(--apple-gray-1); }
    .session-modal-request { background: var(--apple-white); border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid var(--apple-gray-2); }
    .session-modal-label { font-size: 12px; font-weight: 600; color: var(--apple-gray-4); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .session-modal-request-text { font-size: 15px; color: var(--apple-black); line-height: 1.6; }
    .session-modal-divider { height: 1px; background: var(--apple-gray-2); margin: 24px 0; }
    .session-modal-qa { display: flex; flex-direction: column; gap: 16px; }
    .session-modal-qa-item { background: var(--apple-white); border-radius: 16px; padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid var(--apple-gray-2); }
    .session-modal-qa-item .qa-timestamp { font-size: 12px; color: var(--apple-gray-4); margin-bottom: 8px; }
    .session-modal-qa-item .qa-role { font-size: 13px; font-weight: 600; color: var(--apple-blue); margin-bottom: 8px; }
    .session-modal-qa-item .qa-content { font-size: 14px; color: var(--apple-black); line-height: 1.6; white-space: pre-wrap; }
    .session-modal-qa-item .qa-content code { background: var(--apple-gray-1); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace; font-size: 13px; }
    .session-modal-qa-item .qa-content pre { background: #1a1a2e; color: #e4e4e7; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
    .session-modal-qa-item .qa-content pre code { background: none; padding: 0; color: #e4e4e7; }
    .session-modal-qa-item .qa-content ul { margin: 8px 0; padding-left: 20px; }
    .session-modal-qa-item .qa-content li { margin: 4px 0; }
    .session-modal-qa-item .qa-content p { margin: 8px 0; }
    .session-modal-qa-item .qa-content h1, .session-modal-qa-item .qa-content h2, .session-modal-qa-item .qa-content h3 { margin: 12px 0 8px; font-weight: 600; }
    .session-modal-qa-item .qa-content blockquote { border-left: 3px solid var(--apple-gray-3); padding-left: 12px; margin: 8px 0; color: var(--apple-gray-5); }
    @media (max-width: 768px) {
      .session-modal-container { width: 95%; max-height: 90vh; border-radius: 24px; }
      .session-modal-header { padding: 24px 24px 20px; }
      .session-modal-icon { width: 40px; height: 40px; }
      .session-modal-title-content h2 { font-size: 20px; }
      .session-modal-content { padding: 24px 24px 32px; }
    }
    .modal-container {
      background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.9));
      backdrop-filter: saturate(200%) blur(30px); -webkit-backdrop-filter: saturate(200%) blur(30px);
      border-radius: 28px; border: 1px solid rgba(255,255,255,0.6);
      box-shadow: 0 25px 80px rgba(0,0,0,0.15), 0 10px 30px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.9);
      width: 90%; max-width: 800px; max-height: 85vh; overflow: hidden;
      transform: scale(0.9) translateY(20px); transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
    }
    .modal-overlay.active .modal-container { transform: scale(1) translateY(0); }
    .modal-header { padding: 32px 40px 24px; background: var(--apple-white); border-bottom: 1px solid var(--apple-gray-2); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .modal-title-section { display: flex; align-items: center; gap: 16px; flex: 1; }
    .modal-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; background: var(--project-accent-color, var(--apple-blue)); }
    .modal-title-content h2 { font-family: var(--font-display); font-size: 24px; font-weight: 600; letter-spacing: -0.021em; margin-bottom: 6px; }
    .modal-title-content .last-modified { font-size: 14px; color: var(--apple-gray-4); }
    .modal-close { width: 36px; height: 36px; border-radius: 50%; background: var(--apple-gray-1); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--apple-gray-5); transition: all 0.2s ease; flex-shrink: 0; }
    .modal-close:hover { background: var(--apple-gray-2); color: var(--apple-black); }
    .modal-content { padding: 32px 40px 40px; overflow-y: auto; flex: 1; background: var(--apple-gray-1); }
    .modal-stats { display: flex; gap: 24px; margin-bottom: 32px; padding: 20px 24px; background: var(--apple-white); border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .modal-stat { display: flex; flex-direction: column; gap: 4px; }
    .modal-stat-value { font-family: var(--font-display); font-size: 28px; font-weight: 600; color: var(--apple-blue); }
    .modal-stat-label { font-size: 13px; color: var(--apple-gray-4); }
    footer { text-align: center; padding: 64px 32px; margin-top: 48px; }
    .footer-text { font-size: 12px; color: var(--apple-gray-4); }
    @media (max-width: 768px) {
      .modal-container { width: 95%; max-height: 90vh; border-radius: 24px; }
      .modal-header { padding: 24px 24px 20px; }
      .modal-icon { width: 40px; height: 40px; }
      .modal-title-content h2 { font-size: 20px; }
      .modal-content { padding: 24px 24px 32px; }
      .modal-stats { padding: 16px 20px; gap: 20px; }
      .modal-stat-value { font-size: 22px; }
    }
  </style>
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-content">
      <div class="nav-left">
        <div class="nav-title">OpenCode Overview</div>
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

  ${dashboard}

  <div class="container">
    <div class="view-switcher">
      <button class="view-btn active" id="btnGrid" onclick="switchView('grid')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        项目视图
      </button>
      <button class="view-btn" id="btnTimeline" onclick="switchView('timeline')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        时间线视图
      </button>
    </div>

    <div class="projects-list" id="projectsList">${projectCards}</div>

    <div class="global-timeline-wrapper hidden" id="globalTimelineWrapper">
      <div class="global-timeline-header">
        <h3>全部会话时间线</h3>
        <span class="global-timeline-count">共 ${totalSessions} 个会话</span>
      </div>
      <div class="global-timeline" id="globalTimeline">${globalTimeline}</div>
    </div>
  </div>

  <div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
    <div class="modal-container" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title-section">
          <div class="modal-icon" id="modalIcon" style="background: var(--apple-blue)">
            <i data-lucide="folder" style="width:24px;height:24px;color:white"></i>
          </div>
          <div class="modal-title-content">
            <h2 id="modalTitle">项目名称</h2>
            <span class="last-modified" id="modalLastModified">最后更新: --</span>
          </div>
        </div>
        <button class="modal-close" onclick="closeModal()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-content">
        <div class="modal-stats">
          <div class="modal-stat"><span class="modal-stat-value" id="modalSessionCount">0</span><span class="modal-stat-label">会话</span></div>
          <div class="modal-stat"><span class="modal-stat-value" id="modalTimeRange">--</span><span class="modal-stat-label">时间跨度</span></div>
        </div>
        <div id="modalTimeline"></div>
      </div>
    </div>
  </div>

  <div class="session-modal-overlay" id="sessionModalOverlay" onclick="closeSessionModal(event)">
    <div class="session-modal-container" onclick="event.stopPropagation()">
      <div class="session-modal-header">
        <div class="session-modal-title-section">
          <div class="session-modal-icon" id="sessionModalIcon" style="background: var(--apple-blue)">
            <i data-lucide="message-square" style="width:20px;height:20px;color:white"></i>
          </div>
          <div class="session-modal-title-content">
            <h2 id="sessionModalTitle">会话标题</h2>
            <span class="session-modal-meta" id="sessionModalMeta">项目名 · 分类 · 日期</span>
          </div>
        </div>
        <button class="session-modal-close" onclick="closeSessionModal()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="session-modal-content" id="sessionModalContent">
        <div class="session-modal-request">
          <div class="session-modal-label">用户请求</div>
          <div class="session-modal-request-text" id="sessionModalRequest"></div>
        </div>
        <div class="session-modal-divider"></div>
        <div class="session-modal-qa" id="sessionModalQA"></div>
      </div>
    </div>
  </div>

  <footer><p class="footer-text">Generated by opencode-autorecord plugin</p></footer>

  <script>
    const projectsData = ${JSON.stringify(fullProjectsData)};

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

    function openSessionModal(projectName, sessionTitle) {
      const project = projectsData[projectName];
      if (!project) return;
      
      const session = project.sessions.find(s => s.title === sessionTitle);
      if (!session) return;
      
      document.getElementById('sessionModalTitle').textContent = session.title;
      document.getElementById('sessionModalMeta').textContent = projectName + ' · ' + session.category + ' · ' + session.date;
      document.getElementById('sessionModalIcon').style.background = project.color;
      document.getElementById('sessionModalRequest').textContent = session.request;
      
      // Generate QA blocks from session content
      let qaHtml = '';
      if (session.qaBlocks && session.qaBlocks.length > 0) {
        session.qaBlocks.forEach(block => {
          qaHtml += '<div class="session-modal-qa-item">';
          qaHtml += '<div class="qa-timestamp">' + escapeHtml(block.timestamp) + '</div>';
          qaHtml += '<div class="qa-role">' + (block.role === 'user' ? '💭 用户' : '🤖 助手') + '</div>';
          qaHtml += '<div class="qa-content">' + formatQAContent(block.content) + '</div>';
          qaHtml += '</div>';
        });
      } else {
        qaHtml = '<div class="session-modal-qa-item"><div class="qa-content" style="color:var(--apple-gray-4)">暂无详细对话记录</div></div>';
      }
      document.getElementById('sessionModalQA').innerHTML = qaHtml;
      
      const overlay = document.getElementById('sessionModalOverlay');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    function openSessionModalByIdx(projectName, sessionIdx) {
      const project = projectsData[projectName];
      if (!project) return;
      
      const session = project.sessions[sessionIdx];
      if (!session) return;
      
      document.getElementById('sessionModalTitle').textContent = session.title;
      document.getElementById('sessionModalMeta').textContent = projectName + ' · ' + session.category + ' · ' + session.date;
      document.getElementById('sessionModalIcon').style.background = project.color;
      document.getElementById('sessionModalRequest').textContent = session.request;
      
      // Generate QA blocks from session content
      let qaHtml = '';
      if (session.qaBlocks && session.qaBlocks.length > 0) {
        session.qaBlocks.forEach(block => {
          qaHtml += '<div class="session-modal-qa-item">';
          qaHtml += '<div class="qa-timestamp">' + escapeHtml(block.timestamp) + '</div>';
          qaHtml += '<div class="qa-role">' + (block.role === 'user' ? '💭 用户' : '🤖 助手') + '</div>';
          qaHtml += '<div class="qa-content">' + formatQAContent(block.content) + '</div>';
          qaHtml += '</div>';
        });
      } else {
        qaHtml = '<div class="session-modal-qa-item"><div class="qa-content" style="color:var(--apple-gray-4)">暂无详细对话记录</div></div>';
      }
      document.getElementById('sessionModalQA').innerHTML = qaHtml;
      
      const overlay = document.getElementById('sessionModalOverlay');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    function closeSessionModal(event) {
      if (event && event.target !== event.currentTarget) return;
      document.getElementById('sessionModalOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }
    
    function formatQAContent(content) {
      // Simple markdown-like formatting
      var bt = String.fromCharCode(96);
      var tripleBt = bt + bt + bt;
      let formatted = escapeHtml(content);
      
      // Code blocks with language support
      formatted = formatted.replace(new RegExp(tripleBt+'([\\s\\S]*?)'+tripleBt, 'g'), '<pre><code>$1</code></pre>');
      // Inline code
      formatted = formatted.replace(new RegExp(bt+'([^'+bt+']+)'+bt, 'g'), '<code>$1</code>');
      
      // Headers
      formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      formatted = formatted.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      formatted = formatted.replace(/^# (.*$)/gim, '<h1>$1</h1>');
      
      // Bold and italic
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // eslint-disable-line no-useless-escape
      formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>'); // eslint-disable-line no-useless-escape
      
      // Lists
      formatted = formatted.replace(/^- (.*$)/gim, '<li>$1</li>');
      formatted = formatted.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
      
      // Blockquotes
      formatted = formatted.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
      
      // Line breaks and paragraphs
      formatted = formatted.replace(/\\n/g, '<br>');
      formatted = formatted.replace(/\n\n/g, '</p><p>');
      
      // Wrap in paragraph if not already wrapped
      if (!formatted.startsWith('<')) {
        formatted = '<p>' + formatted + '</p>';
      }
      
      return formatted;
    }
    
    function openModal(projectName) {
      const project = projectsData[projectName];
      if (!project) return;
      document.getElementById('modalTitle').textContent = project.title;
      document.getElementById('modalLastModified').textContent = project.lastModified;
      document.getElementById('modalIcon').style.background = project.color;
      document.getElementById('modalSessionCount').textContent = project.sessions.length;

      if (project.sessions.length > 0) {
        const dates = project.sessions.map(s => new Date(s.date)).filter(d => !isNaN(d));
        if (dates.length > 0) {
          const oldest = new Date(Math.min(...dates));
          const newest = new Date(Math.max(...dates));
          const diffDays = Math.ceil((newest - oldest) / (1000 * 60 * 60 * 24));
          document.getElementById('modalTimeRange').textContent = diffDays <= 1 ? '1天' : diffDays < 30 ? diffDays + '天' : Math.ceil(diffDays / 30) + '个月';
        } else {
          document.getElementById('modalTimeRange').textContent = '--';
        }
      } else {
        document.getElementById('modalTimeRange').textContent = '--';
      }

      const sorted = [...project.sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
      let html = '<div style="position:relative;padding-left:28px;">';
      html += '<div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:linear-gradient(to bottom, var(--apple-blue), var(--apple-gray-3));border-radius:1px;"></div>';
      sorted.forEach((s, i) => {
        html += '<div style="position:relative;padding-bottom:28px;padding-left:24px;">';
        html += '<div style="position:absolute;left:-24px;top:4px;width:12px;height:12px;border-radius:50%;background:white;border:2px solid var(--apple-blue);box-shadow:0 0 0 3px var(--apple-gray-1);z-index:1;"></div>';
        html += '<div style="background:white;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.04);border:1px solid var(--apple-gray-2);">';
        html += '<div style="font-size:13px;color:var(--apple-gray-4);margin-bottom:8px;display:flex;align-items:center;gap:8px;">' + escapeHtml(s.date) + '<span style="' + s.categoryStyle + '">' + escapeHtml(s.category) + '</span></div>';
        html += '<div style="font-family:var(--font-display);font-size:17px;font-weight:600;line-height:1.4;letter-spacing:-0.016em;margin-bottom:12px;">' + escapeHtml(s.title) + '</div>';
        html += '<div style="font-size:14px;color:var(--apple-gray-5);line-height:1.5;padding-top:12px;border-top:1px solid var(--apple-gray-2);">' + escapeHtml(s.request) + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
      document.getElementById('modalTimeline').innerHTML = html;

      const overlay = document.getElementById('modalOverlay');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function closeModal(event) {
      if (event && event.target !== event.currentTarget) return;
      document.getElementById('modalOverlay').classList.remove('active');
      document.body.style.overflow = '';
    }

    function filterProjects() {
      const filter = document.getElementById('searchInput').value.toLowerCase();
      const isTimeline = document.getElementById('btnTimeline').classList.contains('active');

      if (!isTimeline) {
        document.querySelectorAll('.project-card').forEach(card => {
          const projectName = card.getAttribute('data-project') || '';
          const sessions = card.querySelectorAll('.session-item');
          let hasVisible = projectName.includes(filter);
          if (!hasVisible) {
            sessions.forEach(s => {
              const title = s.querySelector('.session-title')?.textContent || '';
              const request = s.querySelector('.session-request')?.textContent || '';
              const match = title.toLowerCase().includes(filter) || request.toLowerCase().includes(filter);
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
          const project = item.getAttribute('data-project') || '';
          const title = item.getAttribute('data-title') || '';
          const request = item.getAttribute('data-request') || '';
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

    document.addEventListener('keydown', e => { 
      if (e.key === 'Escape') {
        closeModal();
        closeSessionModal();
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      initProjectsData();
      if (typeof lucide !== 'undefined') {
        lucide.createIcons();
      } else {
        // CDN fallback: replace with colored circle + initial
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

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function regenerateViews(baseDir: string): Promise<void> {
  const logPath = join(baseDir, '.autorecord-views.log');

  try {
    // Try to load existing index
    let index = await loadIndex(baseDir);
    let projects: ProjectData[];
    let isIncremental = false;

    if (index) {
      // Use incremental scanning with index
      projects = await scanProjectsIncremental(baseDir, index);
      isIncremental = true;
    } else {
      // Fallback to full scan and create new index
      index = createEmptyIndex();
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
    }

    if (projects.length === 0) {
      await writeViewLog(logPath, 'INFO: No projects with markdown files found');
      return;
    }

    const totalSessions = projects.reduce((sum, p) => sum + p.count, 0);

    // Read all original markdown content for all projects first (needed for HTML and QA)
    const allContentMap = new Map<string, string>();
    for (const project of projects) {
      const projectDir = join(baseDir, project.name);
      const mdFiles = await listMdFiles(projectDir);
      for (const filePath of mdFiles) {
        try {
          const content = await readFile(filePath, 'utf-8');
          allContentMap.set(basename(filePath), content);
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Generate HTML overview (with full conversation data)
    const htmlContent = buildHtml(projects, totalSessions, allContentMap);
    const htmlPath = join(baseDir, 'opencode-overview.html');
    await writeFile(htmlPath, htmlContent, 'utf-8');

    // Generate QA documents for each project
    let qaTotal = 0;
    for (const project of projects) {
      const projectDir = join(baseDir, project.name);
      const count = await generateQADocument(projectDir, project.sessions, allContentMap);
      qaTotal += count;
    }

    // Save updated index
    await saveIndex(baseDir, index);

    const scanMode = isIncremental ? 'incremental' : 'full';
    await writeViewLog(
      logPath,
      `INFO: Views regenerated (${scanMode}) - ${projects.length} projects, ${totalSessions} sessions, ${qaTotal} QA docs, HTML: ${htmlPath}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeViewLog(logPath, `ERROR: Failed to regenerate views - ${message}`);
    throw error;
  }
}
