import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * 插件 warn/error 独立日志。
 *
 * `opencode serve --service`（守护模式）下 stdout 是 /dev/null，插件的
 * console 输出（迁移指南允许的方式）不会到达 opencode.log 或任何地方，
 * 保存失败、stale 短路、事件订阅中断等关键错误会完全不可见。因此
 * warn/error 级别在 console 之外同时追加到本文件；debug/info 仅走 console。
 */

const MAX_BYTES = 5 * 1024 * 1024; // 超过 5MB 轮转为 .old（仅保留一份）

function logFilePath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
  return join(dataHome, 'opencode', 'log', 'opencode-autorecord.log');
}

async function appendLine(level: 'warn' | 'error', line: string): Promise<void> {
  try {
    const path = logFilePath();
    await mkdir(dirname(path), { recursive: true });
    const st = await stat(path).catch(() => null);
    if (st && st.size >= MAX_BYTES) {
      await rename(path, `${path}.old`).catch(() => undefined);
    }
    await appendFile(path, `${new Date().toISOString()} [${level.toUpperCase()}] ${line}\n`, 'utf-8');
  } catch {
    // 日志写入失败静默，避免影响插件主流程
  }
}

/** 把任意抛出值转成单行文本（日志不保留堆栈，保证逐行可 grep）。 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function logWarn(message: string): void {
  console.warn(message);
  void appendLine('warn', message);
}

export function logError(message: string): void {
  console.error(message);
  void appendLine('error', message);
}
