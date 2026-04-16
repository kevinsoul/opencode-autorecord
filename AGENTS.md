# AGENTS.md

## 命令

```bash
npm run build    # 使用 tsup 构建（输出到 dist/）
npm run lint     # ESLint
npm run typecheck # TypeScript 严格模式检查
```

## 项目结构

- 入口文件：`src/index.ts`（导出 OpenCode 插件）
- ESM 模块（`"type": "module"`）
- 构建输出：`dist/`（发布到 npm）

## 构建说明

- 使用 `tsup` 打包；将 `@opencode-ai/plugin` 和 `@opencode-ai/sdk` 设为外部依赖
- 严格 TypeScript：`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns`
- Lint 规则：未使用的变量必须以 `_` 开头（例如 `_unused`）
