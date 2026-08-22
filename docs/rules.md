# Markdown 保存与解析规则

本文档说明 opencode-autorecord 的 Markdown 文件保存格式与解析规则。

## 1. 存储目录结构

### 根目录

- **位置**：`~/opencode-autorecord/<projectName>/`
- **projectName**：取自项目目录的 basename，经过清理（移除非法字符，最大长度 50）

### 子目录

```
~/opencode-autorecord/
├── .autorecord-index.json           # 全局主索引（记录所有项目元数据）
└── <projectName>/
    ├── YYYYMMDD-HH-MM-SS-{topic}.md    # 会话文件
    ├── images/                          # 全局图片目录（次要保存位置）
    └── .project-index.json              # 项目二级索引（记录项目内文件信息，增量扫描用）
```

### 图片目录

- **主保存位置**：`<md-file-dir>/images/`
- **次要保存位置**：`~/opencode-autorecord/<project>/images/`
- **文件名格式**：`YYYYMMDD-HH-MM-SS-{sanitizedTitle}-{index}.{ext}`
  - `jpeg` 扩展名会被规范化为 `jpg`

---

## 2. 文件名规则

### 会话文件

- **格式**：`{dateStr}-{sanitizedTopic}.md`
- **日期格式**：`YYYYMMDD-HH-MM-SS`（24 小时制）
- **Topic 清理规则**：
  - 移除非法字符：`/\\:*?"<>|`
  - 空格替换为 `-`
  - 多个连字符合并为一个
  - 去除首尾连字符
  - 最大长度 30（默认配置）
  - 空字符串 fallback 为 `untitled`

---

## 3. 文件内容格式

### 3.1 单会话文件结构

```markdown
Session: {title}

**Created:** YYYY-MM-DD HH:MM:SS

---

## 👤 User
*{YYYY-MM-DD HH:MM:SS}*

{user message content}

### 🤖 Assistant [标签]
*{YYYY-MM-DD HH:MM:SS}*

{assistant content}

---

## Child Sessions

### 📦 Subagent: {childTitle}

#### 👤 User
*{timestamp}*

{child user message}

#### 🤖 Assistant
*{timestamp}*

{child assistant message}
```

### 3.2 多会话合并文件结构

当同一 Topic 的多个会话保存到同一文件时，使用 Session Block 标记：

```markdown
# Topic: {topic}

---

<!-- AUTORECORD-SESSION-BLOCK: {sessionId} -->
Session: {title}

**Created:** YYYY-MM-DD HH:MM:SS

---

{session content}

<!-- AUTORECORD-SESSION-BLOCK: {anotherSessionId} -->
{another session content}
```

### 3.3 消息格式规则

#### 标题层级

| 层级 | 内容 |
|------|------|
| `##` | 主会话的 User 消息 |
| `###` | 主会话的 Assistant 消息 / 子会话标题 |
| `####` | 子会话的 User/Assistant 消息 / Tool 调用 |

#### Assistant 标签规则

由消息内容中的 part 类型决定：

| Part 类型组合 | 标签 |
|--------------|------|
| 包含 reasoning | `[分析过程]` |
| 包含 tool | `[执行过程]` |
| 包含 text | `[回复内容]` |

> 注意：标签是消息级的，一条消息可同时含 reasoning 与多个 tool 调用（按上表优先级只显示首个标签）。

#### Assistant 标签规则在 HTML 视图中的体现

解析端为每条 `### 🤖 Assistant` 消息分配 `stepId`（消息内全部 block 共享）与 `stepTag`（标题后缀优先，缺省按内容推导），文本块另带 `kind`（reasoning/reply）。渲染端据此聚合为步骤组容器：

- 组头：类型徽章（🧠 分析过程 / 🔧 执行过程 / 💬 回复内容，颜色区分）+ 工具数 + usage 徽章 + 时间戳
- 组体：左侧竖线连接，按序渲染「🧠 分析本体」（reasoning 折叠块）、「🔧 工具调用」（工具卡缩进嵌套）、「💬 回复内容」小节
- 旧缓存数据（无 `stepId` 字段）自动降级为平铺卡片渲染

#### Part 类型格式化

| Part 类型 | 输出格式 |
|----------|----------|
| `text` | 原文输出 |
| `tool` | `#### 🔧 Tool: {name}` + Status + Input/Output JSON 代码块 |
| `file`（图片） | `![{filename}]({localPath})`（本地路径） |
| `file`（非图片） | 文件名、MIME 类型、URL |
| `reasoning` | `💭 **Reasoning:**` + `<details>` 折叠块 |

#### 时间戳格式

所有消息时间戳使用斜体格式：
```markdown
*{YYYY-MM-DD HH:MM:SS}*
```

### 3.4 图片处理规则

1. **检测**：匹配正则 `/^data:image\/([a-zA-Z]+);base64,(.+)$/`
2. **保存**：base64 图片自动提取并保存为独立文件
3. **替换**：Markdown 中的 base64 替换为本地相对路径
4. **双备份**：同时保存到文件同级 `images/` 目录和全局 `images/` 目录

### 3.5 特殊处理

- **`<details>` 标签**：内部换行符替换为 `<br>`，避免破坏 Markdown 结构
- **代码语言检测**：通过 Shebang 和关键字特征自动检测（支持 python, javascript, typescript, bash, json, html, css, sql, yaml, ruby, perl, php）
- **标题生成**：若会话标题为空或以 `New-session-` / `New session` 开头，从第一条用户消息提取（在单词边界截断，优先保留前半部分内容）

---

## 4. 保存触发与并发控制

### 触发条件

| 事件 | 行为 |
|------|------|
| `session.idle` | 触发 debounce 保存 |
| `message.part.updated` | 触发 debounce 保存 |
| `session.deleted` | 立即保存后删除会话记录 |
| `session.compacted` | 取消 debounce，立即保存 |

### Debounce 规则

| 类型 | 延迟 | 说明 |
|------|------|------|
| **保存 debounce** | 2000ms | 所有会话更新 |
| **视图再生 debounce** | 10000ms | 仅主会话触发 |

### 并发控制

- **文件锁**：使用 `withFileLock` 防止并发写入同一文件
- **原子写入**：先写入 `.tmp` 临时文件，再 `rename` 覆盖原文件
- **Session Block 去重**：同一 `sessionId` 保留文件中最后出现的一次

### 子会话冒泡

- 子会话保存时**向上冒泡**到父会话
- 子会话内容**内联合并**到父会话 Markdown 文件中
- 目标会话 ID：`targetID = session.parentID || sessionID`

---

## 5. 解析规则

### 5.1 会话信息提取

解析 `.md` 文件时按以下优先级提取标题：

1. `# Topic: {title}`（新格式）
2. `Session: {title}`（行首匹配）
3. `# Session: {title}`（旧格式）
4. fallback：`Unknown Session`

其他提取字段：
- **日期**：匹配 `**Created:** {date}`
- **用户请求**：从第一个 message 块提取，去除 `[]` 和 `<>` 标签，截断至 200 字符

### 5.2 对话内容解析

扫描 Assistant 消息块（`### 🤖 Assistant`），识别以下结构：

| 块类型 | 起始标记 | 结束标记 | 提取内容 |
|--------|----------|----------|----------|
| **Message** | `### 🤖 Assistant` | 下一个块开始 | 普通对话内容 |
| **Tool** | `#### 🔧 Tool: {name}` | `[step-finish` | Status、Input（JSON）、Output |
| **Step** | `[step-start` | `[step-end` | AI 思考过程 |

### 5.3 文件过滤

扫描时排除以下文件：
- 不以 `.md` 结尾的文件
- 以 `.` 开头的隐藏目录和文件
- `__pycache__`

### 5.4 HTML 概览页生成

- **输出**：`~/opencode-autorecord/opencode-overview.html`
- **索引系统**：双层索引结构
  - **主索引**：`~/opencode-autorecord/.autorecord-index.json`（记录项目元数据）
  - **二级索引**：`~/opencode-autorecord/<project>/.project-index.json`（记录项目内文件信息）
  - **增量扫描**：通过对比文件 mtime/size 避免重复解析未变更文件
  - **索引修复**：启动时自动校验并修复损坏或缺失的索引
- **分类规则**：基于标题关键词匹配 7 大分类（功能开发、界面设计、问题修复等），fallback 为 `开发讨论`
- **项目图标**：基于项目名称关键词匹配 28 种 Lucide 图标
- **项目颜色**：基于项目名称 hash 从 10 色板中选择
- **残留清理**：每次视图再生成时对比 `projects/` 下 `.html` 文件与当前项目列表，删除已不存在项目的页面（`cleanupStaleProjectPages`）

---

## 6. 错误处理

- **静默吞错**：所有事件处理（`session.idle`/`deleted`/`compacted` 等）的错误都被 try-catch 捕获并静默处理，避免影响其他插件正常运行
- **空文件处理**：空 topic 或空内容时回退为 `untitled`
