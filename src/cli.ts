#!/usr/bin/env node
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

import { existsSync, statSync } from 'node:fs';
import { regenerateViews } from './view-generator.js';

function printUsage(): void {
  console.log(`
用法: opencode-autorecord regenerate [保存目录]

参数:
  [保存目录]  全局保存目录的路径；缺省时依次读取 AUTORECORD_HOME 环境变量、~/opencode-autorecord

示例:
  opencode-autorecord regenerate ~/opencode-autorecord
  npx opencode-autorecord regenerate ~/opencode-autorecord

说明:
  手动重新生成 HTML 概览页。
  如果存在索引文件 (.autorecord-index.json)，将使用增量扫描；
  否则将执行全量扫描并创建新的索引。
`);
}

function resolveSaveDir(arg?: string): string | null {
  if (arg) {
    return resolve(arg);
  }
  const envHome = process.env.AUTORECORD_HOME?.trim();
  if (envHome) {
    return resolve(envHome);
  }
  const home = homedir();
  return home ? join(home, 'opencode-autorecord') : null;
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

  const resolvedPath = resolveSaveDir(args[1]);

  if (!resolvedPath) {
    console.error('错误: 无法确定保存目录（未提供参数且无法读取用户主目录）');
    printUsage();
    process.exit(1);
  }

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
  console.log('扫描 Markdown 文件并生成 HTML 概览页...\n');

  try {
    const outputDir = resolvedPath;
    const result = await regenerateViews(outputDir);
    if (result === 'skipped-newer-index') {
      console.error('\n⚠ 已跳过重新生成：磁盘上的索引由更高版本的 opencode-autorecord 写入。');
      console.error('  请升级 CLI/插件后再试，详见 .autorecord-views.log');
      process.exit(1);
    }
    console.log('\n✓ 视图重新生成完成！');
    console.log(`  HTML 概览页: ${join(outputDir, 'opencode-overview.html')}`);
  } catch (error) {
    console.error('\n✗ 视图生成失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
