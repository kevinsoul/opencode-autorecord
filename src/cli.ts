#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { regenerateViews } from './view-generator.js';

function printUsage(): void {
  console.log(`
用法: opencode-autorecord regenerate <保存目录>

参数:
  <保存目录>  全局保存目录的路径，通常是 ~/opencode-autorecord/<项目名>

示例:
  opencode-autorecord regenerate ~/opencode-autorecord/my-project
  npx opencode-autorecord regenerate ./conversations

说明:
  手动重新生成 HTML 概览页和问答文档。
  如果存在索引文件 (.autorecord-index.json)，将使用增量扫描；
  否则将执行全量扫描并创建新的索引。
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  if (command !== 'regenerate') {
    console.error(`错误: 未知命令 "${command}"`);
    console.error('可用命令: regenerate');
    process.exit(1);
  }

  const saveDir = args[1];

  if (!saveDir) {
    console.error('错误: 请提供保存目录路径');
    printUsage();
    process.exit(1);
  }

  const resolvedPath = resolve(saveDir);

  if (!existsSync(resolvedPath)) {
    console.error(`错误: 目录不存在: ${resolvedPath}`);
    process.exit(1);
  }

  const stats = statSync(resolvedPath);
  if (!stats.isDirectory()) {
    console.error(`错误: 路径不是目录: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`开始重新生成视图: ${resolvedPath}`);
  console.log('扫描 Markdown 文件并生成 HTML 概览页和问答文档...\n');

  try {
    await regenerateViews(resolvedPath);
    console.log('\n✓ 视图重新生成完成！');
    console.log(`  HTML 概览页: ${resolvedPath}/../opencode-overview.html`);
    console.log(`  问答文档: ${resolvedPath}/*/对话式问答文档.md`);
  } catch (error) {
    console.error('\n✗ 视图生成失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
