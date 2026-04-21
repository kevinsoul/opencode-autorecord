import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionInfo {
  title: string;
  date: string;
  userRequest: string;
  category: string;
  filename: string;
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

interface ProjectIndexEntry {
  lastModified: number;
  files: Record<string, FileIndexEntry>;
}

export interface AutorecordIndex {
  version: number;
  lastFullScan: number;
  projects: Record<string, ProjectIndexEntry>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INDEX_VERSION = 1;
const INDEX_FILENAME = '.autorecord-index.json';

// ─── Index Operations ────────────────────────────────────────────────────────

export async function loadIndex(baseDir: string): Promise<AutorecordIndex | null> {
  const indexPath = join(baseDir, INDEX_FILENAME);
  try {
    const content = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as AutorecordIndex;
    if (index.version !== INDEX_VERSION) {
      return null;
    }
    return index;
  } catch {
    return null;
  }
}

export async function saveIndex(baseDir: string, index: AutorecordIndex): Promise<void> {
  const indexPath = join(baseDir, INDEX_FILENAME);
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function createEmptyIndex(): AutorecordIndex {
  return {
    version: INDEX_VERSION,
    lastFullScan: 0,
    projects: {},
  };
}

// ─── File Change Detection ───────────────────────────────────────────────────

export interface FileChangeResult {
  isNew: boolean;
  isModified: boolean;
  cachedInfo?: SessionInfo;
}

export async function detectFileChange(
  index: AutorecordIndex,
  projectName: string,
  filePath: string,
  currentStat: { mtime: Date; size: number }
): Promise<FileChangeResult> {
  const project = index.projects[projectName];
  if (!project) {
    return { isNew: true, isModified: false };
  }

  const entry = project.files[filePath];
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
  index: AutorecordIndex,
  projectName: string,
  filePath: string,
  fileStat: { mtime: Date; size: number },
  sessionInfo: SessionInfo
): void {
  if (!index.projects[projectName]) {
    index.projects[projectName] = {
      lastModified: Date.now(),
      files: {},
    };
  }

  index.projects[projectName].files[filePath] = {
    mtime: fileStat.mtime.getTime(),
    size: fileStat.size,
    sessionInfo,
  };

  index.projects[projectName].lastModified = Date.now();
}

export function removeFileFromIndex(
  index: AutorecordIndex,
  projectName: string,
  filePath: string
): void {
  const project = index.projects[projectName];
  if (project && project.files[filePath]) {
    delete project.files[filePath];
    project.lastModified = Date.now();

    // Clean up empty projects
    if (Object.keys(project.files).length === 0) {
      delete index.projects[projectName];
    }
  }
}

export function removeProjectFromIndex(index: AutorecordIndex, projectName: string): void {
  delete index.projects[projectName];
}

// ─── Index to ProjectData Conversion ─────────────────────────────────────────

export function convertIndexToProjects(index: AutorecordIndex): ProjectData[] {
  const projects: ProjectData[] = [];

  for (const [projectName, projectEntry] of Object.entries(index.projects)) {
    const sessions = Object.values(projectEntry.files)
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
        lastModified: projectEntry.lastModified,
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
  index: AutorecordIndex,
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

  // Get current state from filesystem
  const projects = await listProjectsFn(baseDir);

  for (const project of projects) {
    processedProjects.add(project.name);
    const mdFiles = await listMdFilesFn(project.dir);

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
        newFiles.push(scannedFile);
      } else if (changeResult.isModified) {
        modifiedFiles.push(scannedFile);
      }
    }
  }

  // Find deleted files
  const deletedFiles: Array<{ filePath: string; projectName: string }> = [];
  for (const [projectName, projectEntry] of Object.entries(index.projects)) {
    for (const filePath of Object.keys(projectEntry.files)) {
      if (!currentFiles.has(filePath)) {
        deletedFiles.push({ filePath, projectName });
      }
    }
  }

  // Find unchanged projects (no new, modified, or deleted files)
  const unchangedProjects: string[] = [];
  for (const projectName of Object.keys(index.projects)) {
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
