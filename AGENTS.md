# AGENTS.md

## 命令

```bash
npm run build    # tsup 构建（输出 dist/）
npm run lint     # ESLint
npm run typecheck # tsc --noEmit（严格模式）
```

## 项目结构

- **双入口**：`src/index.ts`（OpenCode 插件）+ `src/cli.ts`（CLI 工具）
- **ESM 模块**（`"type": "module"`），构建输出 `dist/`
- **外部依赖**：`@opencode-ai/plugin`、`@opencode-ai/sdk`（不打包进产物）

## TypeScript 约束

- `verbatimModuleSyntax: true` — 类型导入必须使用 `import type { ... }`
- `noUnusedLocals` / `noUnusedParameters` — 未使用变量必须以 `_` 开头（如 `_unused`）
- `noImplicitReturns` — 所有分支必须显式返回

## ESLint 关键规则

- `@typescript-eslint/no-floating-promises`: `error` — 所有 Promise 必须被 `await` 或处理
- `@typescript-eslint/explicit-function-return-type`: `warn` — 鼓励显式返回类型
- `no-console`: `warn`（仅允许 `warn`/`error`/`log`）

## 架构要点

- **集中存储**：会话保存到 `~/opencode-autorecord/<project>/`（非项目目录）
- **子会话内联**：子会话（subagent）内容合并到父会话的 Markdown 文件中
- **文件锁**：`file-manager.ts` 使用 `withFileLock` 防止并发写入同一文件
- **错误静默**：所有事件处理（`session.idle`/`deleted`/`compacted` 等）的错误都被 try-catch 静默吞掉，避免影响其他插件
- **双重 debounce**：
  - 会话保存 debounce: 2000ms（`DEFAULT_CONFIG.debounceMs`）
  - 视图再生 debounce: 10000ms（仅主会话触发，子会话不触发）
- **图片处理**：base64 图片自动提取保存为独立文件，替换为本地路径
- **双级 HTML 视图**：主索引页 `opencode-overview.html` 仅含元数据（避免文件无限膨胀），完整对话在 `projects/<项目名>.html` 中，会话详情弹窗 + 深色代码块（语言标签/复制按钮）
- **弹窗两列目录树**：会话详情弹窗为 grid 两列——左侧 sticky 目录树（会话段 → 轮次 → 步骤组 → 子会话，锚点 `sec-si` / `turn-tsi-gi` / `tsi-gig-ki` 由渲染序号生成），右侧对话内容；点击目录项自动展开父手风琴并滚动定位；≤768px 隐藏左栏退化单列；无对话数据的老会话加 `.no-toc` 退化为单列提示。步骤组内含正文时按块 kind 切分：首个 reply 块起独立为「💬 回复内容」结论卡（正文与 TOC 同步拆分，formatter 标题多标签化 `[分析过程] · [回复内容]`）
- **子会话恢复**：formatter 写入的 `### 📦 Subagent:` 段落由解析层还原为 `child-session` 容器块（`childTitle`/`children` 字段，归属当前轮次），渲染为青色可折叠卡片；assistant 体提取逻辑抽为 `collectAssistantSection` 供主/子会话复用（围栏内字面量边界不误判）
- **双主题**：视图默认暗色（`data-theme="dark"`，暖黑 + 柠檬黄 opencode 风格），导航栏按钮可切换浅色并持久化到 `localStorage['autorecord-theme']`；颜色集中在 CSS 变量（改主题只需改变量块）
- **原子写入**：HTML 通过 `.tmp` 临时文件 + `rename` 原子替换；`projects/` 目录从项目扫描中排除（`PROJECTS_DIR`）
- **残留清理**：每次视图再生成时对比 `projects/` 下的 `.html` 文件与当前项目列表，删除已不存在的项目对应页面（`cleanupStaleProjectPages`）
- **过期自检（stale-guard）**：插件初始化时对自身 dist 计算代码指纹，写盘前节流复检（5s）；指纹不一致（开发期间重新 build）即粘性判定过期，所有写盘短路并通过 app.log 提示一次"重启 opencode"，防止运行中的旧逻辑覆盖新逻辑产出
- **数据格式版本戳 + fail-closed**：md 会话块头部带 `<!-- AUTORECORD-SCHEMA: N -->`（`SCHEMA_VERSION`），解析到更高版本的块时拒绝覆盖；同一 id 重复块保留 schema 最高者。索引层同理：磁盘 index 的 `version`/`viewVersion` 高于本地认知时放弃再生与 saveIndex（`readStoredIndexVersions`）
- **开发期目录隔离**：环境变量 `AUTORECORD_HOME` 重定向数据根目录，开发调试与真实数据物理隔离

## CLI

```bash
# 手动重新生成 HTML 视图（主索引页 + 各项目页）
opencode-autorecord regenerate ~/opencode-autorecord
```

- 支持增量扫描（依赖 `.autorecord-index.json`）
- 生成 `opencode-overview.html`（主索引页，仅元数据）+ `projects/<项目名>.html`（项目页，含完整对话）
- 项目页增量重建：仅重建有变更或缓存缺少完整对话的项目

## 发布

- `npm run build` 后 `dist/` 即为发布内容
- `npm run prepublishOnly` 会自动执行构建
