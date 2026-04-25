# 索引规则（Index Rules）

本文档说明 opencode-autorecord 的索引生成与更新规则。

## 索引架构（v2）

自 v2 版本起，索引采用**两级架构**：

- **一级索引**（`.autorecord-index.json`）：管理项目列表及二级索引路径
- **二级索引**（`.project-index.json`）：每个项目目录下独立维护，只包含该项目的文件索引

### 为什么使用两级索引？

| 优势 | 说明 |
|------|------|
| **并发安全** | 多项目同时保存时，各自更新独立的二级索引文件，彻底消除全局文件锁竞争 |
| **增量扫描更细粒度** | 可以只重新扫描/更新单个项目的索引，无需加载整个全局索引 |
| **索引文件更小** | 避免单个大文件膨胀，每个索引只包含一个项目的数据，读写更快 |
| **项目可移植** | 项目目录可以整体移动/复制，索引跟着走，无需重建 |
| **降低全局 IO** | 平时会话保存只需读写对应项目的二级索引，一级索引只在项目增删时更新 |

---

## 一级索引

- **文件名**：`.autorecord-index.json`
- **位置**：全局保存目录（`globalSaveDir`）根目录
- **版本号**：`2`
- **内容**：只记录项目元数据（名称、二级索引路径、最后修改时间、会话数）

```typescript
interface PrimaryIndex {
  version: number;           // 索引版本号（当前为 2）
  lastFullScan: number;      // 上次完整扫描时间戳
  projects: Record<string, ProjectMetaEntry>;
}

interface ProjectMetaEntry {
  indexPath: string;         // 二级索引相对路径（如 "projectA/.project-index.json"）
  lastModified: number;      // 项目最后修改时间
  sessionCount: number;      // 项目下的会话数量
}
```

---

## 二级索引

- **文件名**：`.project-index.json`
- **位置**：每个项目目录下（`~/opencode-autorecord/<project>/.project-index.json`）
- **版本号**：`2`
- **内容**：只包含该项目的 `.md` 文件索引

```typescript
interface SecondaryIndex {
  version: number;           // 索引版本号（当前为 2）
  lastModified: number;      // 项目最后修改时间
  files: Record<string, FileIndexEntry>;
}

interface FileIndexEntry {
  mtime: number;             // 文件修改时间（毫秒时间戳）
  size: number;              // 文件大小（字节）
  sessionInfo: SessionInfo;  // 解析出的会话信息
}
```

---

## 触发条件

### 增量扫描

满足以下条件时执行增量扫描：
- 一级索引存在且 `version === 2`
- `lastFullScan > 0`（即至少执行过一次全量扫描）
- 一级索引中至少有一个项目记录

### 全量扫描

满足以下条件时执行全量扫描并重建索引：
- 一级索引文件不存在
- 一级索引版本不匹配
- `lastFullScan === 0`（首次运行或索引被清空）

### v1 → v2 自动迁移

当系统检测到 v1 格式的一级索引（`version === 1`）时，会自动执行迁移：

1. 遍历 v1 索引中每个项目的 `files` 数据
2. 将每个项目的文件索引拆分为独立的 `.project-index.json` 二级索引
3. 生成新的 v2 一级索引（只保留项目元数据）
4. **自动删除**旧的 v1 索引文件（原子替换）

---

## 扫描范围

### 项目目录

- 仅处理**子目录**
- 排除以 `.` 开头的隐藏目录（如 `.git`）
- 排除 `__pycache__`
- 排除 `projects/` 目录（HTML 项目页输出目录，由 `PROJECTS_DIR` 常量定义，避免被误识别为项目）

### 文件范围

- 仅处理 `.md` 文件

---

## 增量更新逻辑

系统通过比较文件的 `mtime`（修改时间）和 `size`（大小）来判断文件状态：

| 状态 | 判断条件 |
|------|----------|
| **新增** | 二级索引中没有该文件的记录 |
| **修改** | 二级索引中的 `mtime` 或 `size` 与当前文件不一致 |
| **删除** | 二级索引中有记录，但磁盘上已不存在 |
| **未变更** | `mtime` 和 `size` 均与索引一致 |

### 按项目并行扫描

增量扫描时，系统会**按项目并行**对比各自的二级索引：

1. 列出所有项目目录
2. 对每个项目并行列出其 `.md` 文件
3. 各自调用 `detectFileChange()` 对比二级索引
4. 汇总所有新增/修改/删除的文件

---

## 处理流程

### 正常流程（增量扫描）

1. **校验与修复**：调用 `validateAndRepairIndexes()` 加载一级索引 + 并行加载所有二级索引，清理孤儿记录，修复损坏的二级索引
2. **检测变更**：按项目并行扫描，对比各自的二级索引
3. **更新二级索引**：
   - 从二级索引中移除已删除的文件记录
   - 解析新增和修改的文件内容，提取 `sessionInfo` 后写入对应项目的二级索引
4. **更新一级索引**：同步各项目的 `lastModified` 和 `sessionCount`
5. **生成视图**：将合并后的索引转换为 `ProjectData[]` 格式，生成 HTML 视图（详见下文「视图生成」）
6. **保存索引**：并行保存所有变更的二级索引 + 保存一级索引

### 首次/重建流程（全量扫描）

1. **校验与修复**：同上
2. **全量扫描**：遍历所有项目目录，读取所有 `.md` 文件内容
3. **构建索引**：为每个项目创建二级索引，更新一级索引
4. **生成视图**：同上
5. **保存索引**：同上

---

## 视图生成（双级 HTML 架构）

每次 regenerate 时生成两种页面：

### 主索引页（opencode-overview.html）

- 位于全局保存目录根目录
- **仅包含元数据**（项目卡片、会话标题、时间线），剥离 `conversationBlocks` 对话内容，避免文件无限膨胀
- 项目卡片和会话卡片为 `<a>` 链接，点击跳转到对应项目页（锚点 `#session-<文件名>`）

### 项目页（projects/<项目名>.html）

- 位于 `projects/` 子目录（`PROJECTS_DIR`），原子写入（`.tmp` + `rename`）
- 包含该项目完整对话内容（会话详情弹窗 + 深色代码块，带语言标签和复制按钮）
- 内联完整对话的会话数上限 `DETAIL_SESSION_LIMIT`（30），超出部分仅保留元数据，完整内容见 md 文件

### 增量重建

项目页并非全部重建，只重建满足以下任一条件的项目：

- 该项目本次扫描有新增/修改/删除的文件（`unchangedProjects` 之外的）
- 二级索引缓存中缺少完整对话（`sessionInfo.conversationBlocks` 不是数组，说明是旧版索引），此时调用 `ensureProjectDetail()` 全量重读该项目 md 并回写索引

### 残留页面清理

每次 regenerate 结束时执行 `cleanupStaleProjectPages()`：对比 `projects/` 目录下的 `.html` 文件名（`decodeURIComponent` 解码）与当前项目列表，已不存在项目的页面被删除，并写入 `INFO: Removed N stale project page(s)` 日志。该步骤独立于项目是否存在，即使所有项目都被删除也能执行清理。

---

## 校验与修复策略

启动时自动执行以下校验：

### 孤儿项目清理

- 一级索引中有记录，但实际目录已不存在 → 删除一级索引中的该项目条目，同时从内存中移除对应的二级索引
- 索引清理不涉及 HTML 文件；对应的 `projects/<项目名>.html` 残留页面由视图生成阶段的「残留页面清理」删除（见上文）

### 二级索引损坏修复

- 二级索引文件不存在 → 创建空的二级索引，下次增量扫描时会重新填充
- 二级索引解析失败（JSON 损坏、版本不匹配）→ 重建空的二级索引
- 一级索引中缺少某项目 → 尝试加载该项目的二级索引，若不存在则创建空的

### 并行读取优化

加载所有二级索引时，使用 `Promise.all()` 并行读取，减少 IO 等待时间。

---

## 缓存命中

对于没有任何新增、修改或删除文件的项目，直接使用二级索引中缓存的 `sessionInfo`，无需重新读取和解析文件内容。

---

## 并发控制

- **一级索引写入**：使用内存文件锁（`withFileLock`）+ 原子写入（`.tmp` 临时文件再 `rename`）
- **二级索引写入**：每个项目独立使用内存文件锁，互不影响
- **并行读取**：所有二级索引同时加载，只读无锁冲突

---

## 索引数据结构汇总

```typescript
// 一级索引（.autorecord-index.json）
interface PrimaryIndex {
  version: number;           // 2
  lastFullScan: number;      // 上次完整扫描时间戳
  projects: Record<string, ProjectMetaEntry>;
}

interface ProjectMetaEntry {
  indexPath: string;         // 二级索引路径
  lastModified: number;      // 项目最后修改时间
  sessionCount: number;      // 会话数量
}

// 二级索引（.project-index.json）
interface SecondaryIndex {
  version: number;           // 2
  lastModified: number;      // 项目最后修改时间
  files: Record<string, FileIndexEntry>;
}

interface FileIndexEntry {
  mtime: number;             // 文件修改时间
  size: number;              // 文件大小
  sessionInfo: SessionInfo;  // 会话信息
}
```
