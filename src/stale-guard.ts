import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 过期自检（stale self-check）：
 *
 * opencode 启动时一次性加载插件，之后磁盘上的构建产物被重新生成时，
 * 运行中的进程仍持有旧逻辑，其 debounce 回调会用旧逻辑覆盖新逻辑写入的数据。
 * 本模块通过"加载时代码指纹 vs 磁盘当前指纹"的对比让旧进程自我识别：
 * 一旦检测到不一致即粘性标记为过期，所有写盘操作必须短路。
 */

const RECHECK_INTERVAL_MS = 5000;
const CODE_FILE_RE = /\.(js|mjs|cjs)$/;

let loadTimeSnapshot: string | null = null;
let lastCheckMs = 0;
let stale = false;
let warned = false;

/** 对当前模块所在目录下的所有 JS 产物计算聚合指纹；无法确定时返回 null */
async function computeCodeFingerprint(): Promise<string | null> {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && CODE_FILE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    if (files.length === 0) {
      return null;
    }
    const hash = createHash('sha256');
    for (const name of files) {
      hash.update(name);
      hash.update(await readFile(join(dir, name)));
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** 插件初始化时调用，记录加载时刻的代码指纹 */
export async function initStaleGuard(): Promise<void> {
  loadTimeSnapshot = await computeCodeFingerprint();
}

/**
 * 节流复检（默认 5s 内最多计算一次磁盘指纹）。
 * 返回 true 表示当前进程已被判定为过期；判定为粘性，一旦过期不再恢复。
 * 指纹无法计算（如运行于源码、目录读取失败、构建进行中）时不做判定。
 */
export async function checkStale(): Promise<boolean> {
  if (loadTimeSnapshot === null) {
    return false;
  }
  if (stale) {
    return true;
  }
  const now = Date.now();
  if (now - lastCheckMs < RECHECK_INTERVAL_MS) {
    return false;
  }
  lastCheckMs = now;
  const current = await computeCodeFingerprint();
  if (current === null) {
    return false;
  }
  if (current !== loadTimeSnapshot) {
    stale = true;
  }
  return stale;
}

/** 过期告警只发一次：首次确认过期时返回 true，此后返回 false */
export function consumeStaleWarning(): boolean {
  if (!stale || warned) {
    return false;
  }
  warned = true;
  return true;
}
