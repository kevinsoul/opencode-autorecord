import { readFile, writeFile, stat, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BlockUsage {
  providerID?: string;
  modelID?: string;
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  durationMs?: number;
  finish?: string;
  error?: string;
  compaction?: boolean;
}

export interface ConversationBlock {
  type: 'message' | 'tool';
  timestamp: string;
  content?: string;
  /** 消息角色（message 块）；旧索引缓存无此字段，渲染端按序推断 */
  role?: 'user' | 'assistant';
  /** 所属轮次（session block 内 1 起编号）；undefined 表示任何轮次开始之前的内容（如压缩摘要前置上下文） */
  turn?: number;
  toolName?: string;
  toolStatus?: string;
  toolInput?: string;
  toolOutput?: string;
  /** Assistant message usage metadata (message blocks only) */
  usage?: BlockUsage;
}

export interface SessionUsageRow {
  calls: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionStats {
  byModel: Record<string, SessionUsageRow>;
  totalCost: number;
  totalTokens: number;
}

export interface SessionInfo {
  title: string;
  date: string;
  userRequest: string;
  category: string;
  filename: string;
  conversationBlocks?: ConversationBlock[];
  /** Aggregated token/cost statistics parsed from the markdown header */
  stats?: SessionStats;
}

export interface ProjectData {
  name: string;
  sessions: SessionInfo[];
  count: number;
  lastModified: number;
}

interface FileIndexEntry {
  mtime: number;
  size: number;
  sessionInfo: SessionInfo;
}

interface ProjectMetaEntry {
  indexPath: string;
  lastModified: number;
  sessionCount: number;
}

export interface PrimaryIndex {
  version: number;
  lastFullScan: number;
  /**
   * 视图渲染结构版本（view-generator.ts 中 VIEW_VERSION）。
   * 与代码不一致时强制重建全部项目页（用于 HTML 渲染结构升级后的存量刷新）。
   */
  viewVersion?: number;
  projects: Record<string, ProjectMetaEntry>;
}

export interface SecondaryIndex {
  version: number;
  lastModified: number;
  files: Record<string, FileIndexEntry>;
}

export interface UnifiedIndex {
  primary: PrimaryIndex;
  secondary: Map<string, SecondaryIndex>;
}

// Backward compatible alias
export type AutorecordIndex = UnifiedIndex;

// ─── Constants ───────────────────────────────────────────────────────────────

// v4: 新增 usage 统计（📊 元数据行 + 文件头用量表），旧缓存作废强制全量重扫
// v5: ConversationBlock 新增 role/turn（按用户提问分轮次），旧缓存作废强制全量重扫
const INDEX_VERSION = 5;
const PRIMARY_INDEX_FILENAME = '.autorecord-index.json';
const SECONDARY_INDEX_FILENAME = '.project-index.json';

// 生成的 HTML 页面统一存放的目录名（需要从项目扫描中排除）
export const PROJECTS_DIR = 'projects';

// ─── File Lock ───────────────────────────────────────────────────────────────

const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prevLock = fileLocks.get(filePath);
  let release: (() => void) | undefined;
  const lockPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  fileLocks.set(filePath, lockPromise);

  if (prevLock) {
    await prevLock;
  }

  try {
    return await fn();
  } finally {
    release?.();
    if (fileLocks.get(filePath) === lockPromise) {
      fileLocks.delete(filePath);
    }
  }
}

// ─── Primary Index Operations ────────────────────────────────────────────────

async function loadPrimaryIndex(baseDir: string): Promise<PrimaryIndex | null> {
  const indexPath = join(baseDir, PRIMARY_INDEX_FILENAME);
  try {
    const content = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as PrimaryIndex;
    if (index.version !== INDEX_VERSION) {
      return null;
    }
    return index;
  } catch {
    return null;
  }
}

async function savePrimaryIndex(baseDir: string, index: PrimaryIndex): Promise<void> {
  const indexPath = join(baseDir, PRIMARY_INDEX_FILENAME);
  const newContent = JSON.stringify(index, null, 2);

  // Check if content changed to avoid unnecessary writes
  let existingContent: string | null = null;
  try {
    existingContent = await readFile(indexPath, 'utf-8');
  } catch {
    // File doesn't exist, need to save
  }

  if (existingContent === newContent) {
    return;
  }

  await withFileLock(indexPath, async () => {
    const tempPath = `${indexPath}.tmp`;
    await writeFile(tempPath, newContent, 'utf-8');
    await rename(tempPath, indexPath);
  });
}

// ─── Secondary Index Operations ──────────────────────────────────────────────

async function loadSecondaryIndex(projectDir: string): Promise<SecondaryIndex | null> {
  const indexPath = join(projectDir, SECONDARY_INDEX_FILENAME);
  try {
    const content = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as SecondaryIndex;
    if (index.version !== INDEX_VERSION) {
      return null;
    }
    return index;
  } catch {
    return null;
  }
}

async function saveSecondaryIndex(projectDir: string, index: SecondaryIndex): Promise<void> {
  const indexPath = join(projectDir, SECONDARY_INDEX_FILENAME);
  const newContent = JSON.stringify(index, null, 2);

  // Check if content changed to avoid unnecessary writes
  let existingContent: string | null = null;
  try {
    existingContent = await readFile(indexPath, 'utf-8');
  } catch {
    // File doesn't exist, need to save
  }

  if (existingContent === newContent) {
    return;
  }

  await withFileLock(indexPath, async () => {
    const tempPath = `${indexPath}.tmp`;
    await writeFile(tempPath, newContent, 'utf-8');
    await rename(tempPath, indexPath);
  });
}

function createEmptySecondaryIndex(): SecondaryIndex {
  return {
    version: INDEX_VERSION,
    lastModified: Date.now(),
    files: {},
  };
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrateV1ToV2(baseDir: string, v1Index: Record<string, unknown>): Promise<UnifiedIndex> {
  const primary: PrimaryIndex = {
    version: INDEX_VERSION,
    lastFullScan: (v1Index.lastFullScan as number) || Date.now(),
    projects: {},
  };

  const secondary = new Map<string, SecondaryIndex>();
  const v1Projects = v1Index.projects as Record<string, { lastModified?: number; files?: Record<string, FileIndexEntry> }> | undefined;

  if (v1Projects) {
    for (const [projectName, projectEntry] of Object.entries(v1Projects)) {
      const projectDir = join(baseDir, projectName);

      const secIndex: SecondaryIndex = {
        version: INDEX_VERSION,
        lastModified: projectEntry.lastModified || Date.now(),
        files: projectEntry.files || {},
      };

      // Save secondary index
      await saveSecondaryIndex(projectDir, secIndex);
      secondary.set(projectName, secIndex);

      // Update primary index metadata
      primary.projects[projectName] = {
        indexPath: join(projectName, SECONDARY_INDEX_FILENAME),
        lastModified: secIndex.lastModified,
        sessionCount: Object.keys(secIndex.files).length,
      };
    }
  }

  // Save new primary index (atomically replaces v1)
  await savePrimaryIndex(baseDir, primary);

  return { primary, secondary };
}

// ─── Validation & Repair ─────────────────────────────────────────────────────

export async function validateAndRepairIndexes(baseDir: string): Promise<UnifiedIndex> {
  let primary = await loadPrimaryIndex(baseDir);
  const secondary = new Map<string, SecondaryIndex>();

  if (primary) {
    // v2 primary exists, load all secondary indexes in parallel
    const loadPromises = Object.entries(primary.projects).map(async ([projectName]) => {
      const projectDir = join(baseDir, projectName);
      const secIndex = await loadSecondaryIndex(projectDir);
      if (secIndex) {
        secondary.set(projectName, secIndex);
      }
    });
    await Promise.all(loadPromises);
  }

  // If no primary or it's v1, try to load v1 for migration
  if (!primary) {
    const v1Path = join(baseDir, PRIMARY_INDEX_FILENAME);
    try {
      const v1Content = await readFile(v1Path, 'utf-8');
      const v1Index = JSON.parse(v1Content) as Record<string, unknown>;
      if (v1Index.version === 1) {
        return await migrateV1ToV2(baseDir, v1Index);
      }
    } catch {
      // No v1 index either, start fresh
    }
  }

  // Ensure we have a valid primary index
  if (!primary) {
    primary = {
      version: INDEX_VERSION,
      lastFullScan: 0,
      projects: {},
    };
  }

  const index: UnifiedIndex = { primary, secondary };

  // List actual project directories
  const entries = await readdir(baseDir, { withFileTypes: true });
  const actualProjects = new Set<string>();
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__' && entry.name !== PROJECTS_DIR) {
      actualProjects.add(entry.name);
    }
  }

  // Remove orphan projects from primary index
  let hasOrphans = false;
  for (const projectName of Object.keys(primary.projects)) {
    if (!actualProjects.has(projectName)) {
      delete primary.projects[projectName];
      secondary.delete(projectName);
      hasOrphans = true;
    }
  }

  // Immediately save primary index if orphans were cleaned
  if (hasOrphans) {
    await savePrimaryIndex(baseDir, primary);
  }

  // Validate and repair each actual project
  for (const projectName of actualProjects) {
    const projectDir = join(baseDir, projectName);
    let secIndex = secondary.get(projectName);

    if (!secIndex) {
      // Project exists in filesystem but not in index, try to load secondary index
      secIndex = (await loadSecondaryIndex(projectDir)) ?? undefined;

      if (!secIndex) {
        // No valid secondary index, create empty one
        secIndex = createEmptySecondaryIndex();
      }

      secondary.set(projectName, secIndex);
      primary.projects[projectName] = {
        indexPath: join(projectName, SECONDARY_INDEX_FILENAME),
        lastModified: secIndex.lastModified,
        sessionCount: Object.keys(secIndex.files).length,
      };
    } else {
      // Validate existing secondary index file
      const loaded = await loadSecondaryIndex(projectDir);
      if (!loaded) {
        // Corrupted or missing, rebuild empty
        secIndex = createEmptySecondaryIndex();
        secondary.set(projectName, secIndex);
        primary.projects[projectName].sessionCount = 0;
        primary.projects[projectName].lastModified = Date.now();
      }
    }
  }

  return index;
}

// ─── Unified Index Operations ────────────────────────────────────────────────

export async function loadIndex(baseDir: string): Promise<UnifiedIndex | null> {
  const primary = await loadPrimaryIndex(baseDir);
  if (!primary) {
    // Check for v1 index
    try {
      const v1Content = await readFile(join(baseDir, PRIMARY_INDEX_FILENAME), 'utf-8');
      const v1Index = JSON.parse(v1Content) as Record<string, unknown>;
      if (v1Index.version === 1) {
        return await migrateV1ToV2(baseDir, v1Index);
      }
    } catch {
      // No index file
    }
    return null;
  }

  const secondary = new Map<string, SecondaryIndex>();
  const loadPromises = Object.entries(primary.projects).map(async ([projectName]) => {
    const projectDir = join(baseDir, projectName);
    const secIndex = await loadSecondaryIndex(projectDir);
    if (secIndex) {
      secondary.set(projectName, secIndex);
    }
  });
  await Promise.all(loadPromises);

  return { primary, secondary };
}

export async function saveIndex(baseDir: string, index: UnifiedIndex): Promise<void> {
  // Save all secondary indexes in parallel
  const savePromises: Promise<void>[] = [];
  for (const [projectName, secIndex] of index.secondary) {
    const projectDir = join(baseDir, projectName);
    savePromises.push(saveSecondaryIndex(projectDir, secIndex));
  }
  await Promise.all(savePromises);

  // Update primary index metadata from secondary indexes
  for (const [projectName, secIndex] of index.secondary) {
    const meta = index.primary.projects[projectName];
    if (meta) {
      meta.lastModified = secIndex.lastModified;
      meta.sessionCount = Object.keys(secIndex.files).length;
    }
  }

  // Clean up primary entries for removed projects
  for (const projectName of Object.keys(index.primary.projects)) {
    if (!index.secondary.has(projectName)) {
      delete index.primary.projects[projectName];
    }
  }

  // Save primary index
  await savePrimaryIndex(baseDir, index.primary);
}

export function createEmptyIndex(): UnifiedIndex {
  return {
    primary: {
      version: INDEX_VERSION,
      lastFullScan: 0,
      projects: {},
    },
    secondary: new Map(),
  };
}

// ─── File Change Detection ───────────────────────────────────────────────────

export interface FileChangeResult {
  isNew: boolean;
  isModified: boolean;
  cachedInfo?: SessionInfo;
}

export async function detectFileChange(
  index: UnifiedIndex,
  projectName: string,
  filePath: string,
  currentStat: { mtime: Date; size: number }
): Promise<FileChangeResult> {
  const secondary = index.secondary.get(projectName);
  if (!secondary) {
    return { isNew: true, isModified: false };
  }

  const entry = secondary.files[filePath];
  if (!entry) {
    return { isNew: true, isModified: false };
  }

  const isModified = entry.mtime !== currentStat.mtime.getTime() || entry.size !== currentStat.size;

  return {
    isNew: false,
    isModified,
    cachedInfo: isModified ? undefined : entry.sessionInfo,
  };
}

// ─── Index Update Operations ─────────────────────────────────────────────────

export function updateFileIndex(
  index: UnifiedIndex,
  projectName: string,
  filePath: string,
  fileStat: { mtime: Date; size: number },
  sessionInfo: SessionInfo
): void {
  let secondary = index.secondary.get(projectName);
  if (!secondary) {
    secondary = createEmptySecondaryIndex();
    index.secondary.set(projectName, secondary);
    index.primary.projects[projectName] = {
      indexPath: join(projectName, SECONDARY_INDEX_FILENAME),
      lastModified: Date.now(),
      sessionCount: 0,
    };
  }

  secondary.files[filePath] = {
    mtime: fileStat.mtime.getTime(),
    size: fileStat.size,
    sessionInfo,
  };

  secondary.lastModified = Date.now();
  index.primary.projects[projectName].lastModified = Date.now();
  index.primary.projects[projectName].sessionCount = Object.keys(secondary.files).length;
}

export function removeFileFromIndex(
  index: UnifiedIndex,
  projectName: string,
  filePath: string
): void {
  const secondary = index.secondary.get(projectName);
  if (secondary && secondary.files[filePath]) {
    delete secondary.files[filePath];
    secondary.lastModified = Date.now();

    const meta = index.primary.projects[projectName];
    if (meta) {
      meta.lastModified = Date.now();
      meta.sessionCount = Object.keys(secondary.files).length;

      // Clean up empty projects
      if (meta.sessionCount === 0) {
        index.secondary.delete(projectName);
        delete index.primary.projects[projectName];
      }
    }
  }
}

export function removeProjectFromIndex(index: UnifiedIndex, projectName: string): void {
  delete index.primary.projects[projectName];
  index.secondary.delete(projectName);
}

// ─── Index to ProjectData Conversion ─────────────────────────────────────────

export function convertIndexToProjects(index: UnifiedIndex): ProjectData[] {
  const projects: ProjectData[] = [];

  for (const [projectName, secondary] of index.secondary) {
    const sessions = Object.values(secondary.files)
      .map((f) => f.sessionInfo)
      .sort((a, b) => {
        const da = parseDate(a.date);
        const db = parseDate(b.date);
        return db.getTime() - da.getTime();
      });

    if (sessions.length > 0) {
      projects.push({
        name: projectName,
        sessions,
        count: sessions.length,
        lastModified: secondary.lastModified,
      });
    }
  }

  // Sort by last modified (most recent first)
  projects.sort((a, b) => b.lastModified - a.lastModified);

  return projects;
}

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

// ─── Incremental Scan Helper ─────────────────────────────────────────────────

export interface ScannedFile {
  filePath: string;
  projectName: string;
  stat: { mtime: Date; size: number };
}

export async function getFilesToProcess(
  index: UnifiedIndex,
  baseDir: string,
  listProjectsFn: (baseDir: string) => Promise<Array<{ name: string; dir: string }>>,
  listMdFilesFn: (projectDir: string) => Promise<string[]>
): Promise<{
  newFiles: ScannedFile[];
  modifiedFiles: ScannedFile[];
  deletedFiles: Array<{ filePath: string; projectName: string }>;
  unchangedProjects: string[];
}> {
  const newFiles: ScannedFile[] = [];
  const modifiedFiles: ScannedFile[] = [];
  const currentFiles = new Set<string>();
  const processedProjects = new Set<string>();

  // Get current state from filesystem (parallel per project)
  const projects = await listProjectsFn(baseDir);

  const projectScanPromises = projects.map(async (project) => {
    processedProjects.add(project.name);
    const mdFiles = await listMdFilesFn(project.dir);
    const projectNewFiles: ScannedFile[] = [];
    const projectModifiedFiles: ScannedFile[] = [];

    for (const filePath of mdFiles) {
      currentFiles.add(filePath);
      const stats = await stat(filePath);
      const changeResult = await detectFileChange(index, project.name, filePath, {
        mtime: stats.mtime,
        size: stats.size,
      });

      const scannedFile: ScannedFile = {
        filePath,
        projectName: project.name,
        stat: { mtime: stats.mtime, size: stats.size },
      };

      if (changeResult.isNew) {
        projectNewFiles.push(scannedFile);
      } else if (changeResult.isModified) {
        projectModifiedFiles.push(scannedFile);
      }
    }

    return {
      projectName: project.name,
      newFiles: projectNewFiles,
      modifiedFiles: projectModifiedFiles,
    };
  });

  const projectResults = await Promise.all(projectScanPromises);
  for (const result of projectResults) {
    newFiles.push(...result.newFiles);
    modifiedFiles.push(...result.modifiedFiles);
  }

  // Find deleted files
  const deletedFiles: Array<{ filePath: string; projectName: string }> = [];
  for (const [projectName, secondary] of index.secondary) {
    for (const filePath of Object.keys(secondary.files)) {
      if (!currentFiles.has(filePath)) {
        deletedFiles.push({ filePath, projectName });
      }
    }
  }

  // Find unchanged projects (no new, modified, or deleted files)
  const unchangedProjects: string[] = [];
  for (const projectName of index.secondary.keys()) {
    const hasChanges =
      newFiles.some((f) => f.projectName === projectName) ||
      modifiedFiles.some((f) => f.projectName === projectName) ||
      deletedFiles.some((f) => f.projectName === projectName) ||
      !processedProjects.has(projectName);

    if (!hasChanges) {
      unchangedProjects.push(projectName);
    }
  }

  return { newFiles, modifiedFiles, deletedFiles, unchangedProjects };
}
