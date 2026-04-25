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
- **原子写入**：HTML 通过 `.tmp` 临时文件 + `rename` 原子替换；`projects/` 目录从项目扫描中排除（`PROJECTS_DIR`）
- **残留清理**：每次视图再生成时对比 `projects/` 下的 `.html` 文件与当前项目列表，删除已不存在的项目对应页面（`cleanupStaleProjectPages`）

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
