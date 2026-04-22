# opencode-autorecord



> Author: https://github.com/kevinsoul
>
> 主要作用： 保存所有opencode的会话记录

>参考：https://github.com/learningpro/opencode-autosave-conversation



## 优化&改动：

1. 子会话 idle 时缺少对父会话的 debounce（性能/重复写入问题）

2. 子会话读取没有错误隔离（健壮性问题）

3. `session.deleted` 时存在数据丢失风险（时序问题）

4. `convertMessages` 是伪异步函数（代码质量问题）

5. 图片处理未并行化（性能问题）

6. 没有消息缓存，每次 idle 都请求全量历史

7. 不保存到项目目录，集中保存在~/opencode-autorecord

   

## 安装

### 全局安装（推荐）

```bash
npm install -g opencode-autorecord
```

### 本地安装

```bash
npm install --save-dev opencode-autorecord
```



## 配置

在 `opencode.json` 中添加插件配置：

```json
{
  "plugin": ["opencode-autorecord"]
}
```

配置文件位置（按优先级排序）：

1. **项目级配置**：`./opencode.json`（当前工作目录）
2. **用户级配置**：`~/.config/opencode/opencode.json`

> **注意**：至少需要在一个位置的配置文件中添加插件，插件即可生效。建议添加到用户级配置，这样所有项目都会自动保存会话记录。



```shell
用户目录/    
    opencode-autorecord/
    ├── your-project/
    │   ├── images/
    │   │   ├── 20250129-10-30-45-主题-0.png
    │   │   └── 20250129-10-30-45-主题-1.jpg
    │   ├── 20250129-10-30-45-实现认证.md
    │   └── 20250129-14https://github.com/learningpro/opencode-autorecord-22-30-修复bug.md
    └── ...
```



## 功能特性

- 开始新对话时自动创建文件(用户目录/opencode-autorecord)

- 会话空闲时自动保存为markdown文件（静默执行，无控制台输出）

- 文件按时间戳和主题命名：`YYYYMMDD-HH-MM-SS-主题.md`

- 图片保存为独立文件，而非 base64（保持 Markdown 简洁）

- 完整保留工具调用详情（输入和输出）

- 子会话（subagent 任务）内联在父文件中

- 简洁易读的 Markdown 格式

- 支持中文及其他 Unicode 内容

- 智能提取问答对：自动识别 Assistant 时间后的用户问题，以及 `[step-start part]` 到 `[step-end part]` 之间的 AI 思考与回答

- 自动生成问答文档：将对话整理为结构化的 Q&A 格式，便于回顾和知识沉淀
- 点击会话卡片查看完整对话：在 HTML 概览页中点击任意会话卡片，即可弹出模态框查看完整的对话记录（包含用户请求和助手回复）



## CLI 命令行工具

除了作为 OpenCode 插件自动运行外，还提供了 CLI 命令用于手动重新生成视图。

### 安装 CLI

```bash
npm install -g opencode-autorecord
```

### 重新生成视图

当你想手动重新生成 HTML 概览页和问答文档时：

```bash
# 使用全局安装的命令
opencode-autorecord regenerate ~/opencode-autorecord/your-project

# 或使用 npx（无需全局安装）
npx opencode-autorecord regenerate ~/opencode-autorecord/your-project
```

**参数说明：**

- `regenerate`：重新生成命令
- `<保存目录>`：全局保存目录的路径，通常是 `~/opencode-autorecord/<项目名>`

**功能说明：**

- 扫描指定目录下的所有 Markdown 文件
- 生成 `opencode-overview.html`（HTML 概览页，包含项目卡片和时间线视图）
- 为每个项目生成 `对话式问答文档.md`（整理所有对话记录）
- 如果存在索引文件 `.autorecord-index.json`，将使用增量扫描；否则执行全量扫描并创建新的索引

**示例：**

```bash
# 重新生成根目录视图（自动检测根目录或项目目录）
opencode-autorecord regenerate ~/opencode-autorecord

# 也可以传入具体项目目录
opencode-autorecord regenerate ~/opencode-autorecord/my-project

# 重新生成当前项目的视图（如果在项目目录下）
opencode-autorecord regenerate ./conversations
```



## 问答文档格式

插件会自动生成 `对话式问答文档.md`，将对话整理为结构化的问答对：

### 提取规则

1. **用户问题**：Assistant 时间戳后的文本内容（`[step-start part]` 之前的部分）
2. **AI 回答**：`[step-start part]` 到 `[step-end part]` 之间的内容（包含 AI 的思考过程和最终回答）
3. **工具调用**：`#### 🔧 Tool:` 开头的工具执行块会完整保留

### 示例结构

```markdown
**[2024-01-15 10:30:45]** 💭 用户请求
> 如何优化 React 组件的渲染性能？

**[2024-01-15 10:30:46]** 🤖 助手
首先，我们需要分析组件的渲染瓶颈...

#### 🔧 Tool: search
- **状态**: success
- **输入**: `{"query": "React performance optimization"}`
- **输出**: ...
```

### 使用建议

- 问答文档适合用于**知识沉淀**和**团队分享**
- 可以通过搜索快速定位历史问题和解决方案
- 配合 HTML 概览页使用，获得更好的浏览体验



## 许可证

[Apache 2.0](https://github.com/kevinsoul/opencode-autorecord/commit/6c59a77af7dafec32ebfcc9c892ed4b0f9a6a06f)

