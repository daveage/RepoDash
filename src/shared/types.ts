export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

export interface LastCommit {
  hash: string
  subject: string
  author: string
  /** Committer time, epoch milliseconds. */
  time: number
}

export interface RepoStatus {
  path: string
  name: string
  /** Null when HEAD is detached. */
  branch: string | null
  /** Short HEAD hash; null in a repository without commits. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicted: number
  stash: number
  operation: RepoOperation | null
  lastCommit: LastCommit | null
  checkedAt: number
}

export type RepoResult = { ok: true; status: RepoStatus } | { ok: false; path: string; error: string }

/** A place repositories come from: a folder scanned for repositories, or one repository. */
export interface Source {
  id: string
  kind: 'folder' | 'repo'
  path: string
  /** Folder sources only: how many directory levels below `path` are searched. */
  depth?: number
}

export interface RepoMeta {
  alias?: string
  color?: string
}

export interface RepoEntry {
  path: string
  sourceId: string
}

/** Everything the renderer shows apart from git status, pushed by the main process on every change. */
export interface Snapshot {
  sources: Source[]
  /** Ordered as the user arranged them; newly found repositories go last. */
  repos: RepoEntry[]
  /** Repositories found by a folder scan that the user removed from the dashboard. */
  hidden: string[]
  meta: Record<string, RepoMeta>
  scanning: boolean
}

export type AddResult = { snapshot: Snapshot } | { error: string } | null

export interface BranchInfo {
  /** Short name: `main` for a local branch, `origin/main` for a remote one. */
  name: string
  kind: 'local' | 'remote'
  hash: string
  current: boolean
  subject: string
  /** Committer time, epoch milliseconds. */
  time: number
  upstream?: string
  ahead?: number
  behind?: number
  /** The upstream branch was deleted on the remote. */
  gone?: boolean
  /** Remote branches: a local branch of the same name exists. */
  hasLocal?: boolean
}

export interface FileChange {
  path: string
  /** Renamed or copied files: the path before. */
  origPath?: string
  /** Porcelain v2 status letters, `.` for unchanged. */
  index: string
  worktree: string
  kind: 'changed' | 'renamed' | 'conflict' | 'untracked'
}

export interface RepoDetails {
  branches: BranchInfo[]
  files: FileChange[]
}

export interface HistoryRef {
  name: string
  kind: 'head' | 'local' | 'remote' | 'tag'
  /** Lane the ref's branch is drawn in; -1 for tags and HEAD. */
  lane: number
}

export interface HistoryCommit {
  hash: string
  parents: string[]
  author: string
  time: number
  subject: string
  refs: HistoryRef[]
  /** Index into `History.lanes`; -1 when no branch claims the commit. */
  lane: number
}

/** A branch as the history colours it: its commits are the ones only it reaches along first parents. */
export interface HistoryLane {
  name: string
  kind: 'local' | 'remote' | 'merged' | 'detached'
  current: boolean
  count: number
}

export interface History {
  commits: HistoryCommit[]
  lanes: HistoryLane[]
  /** More commits exist beyond the requested limit. */
  truncated: boolean
}

export type HistoryScope = 'all' | 'current'

export type Operation =
  | { kind: 'fetch' }
  | { kind: 'pull' }
  | { kind: 'push' }
  /** `branch` is a local name or a remote one (`origin/x`), which gets a tracking branch. */
  | { kind: 'switch'; branch: string; stash: boolean }
  | { kind: 'create-branch'; name: string; stash: boolean }
  | { kind: 'stage'; paths: string[] }
  | { kind: 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string }
  | { kind: 'stash-push' }
  | { kind: 'stash-pop' }
  | { kind: 'abort'; operation: RepoOperation }

export interface OpResult {
  ok: boolean
  error?: string
}

export interface OpOutput {
  opId: string
  text: string
}

/** API the preload script exposes to the renderer as `window.repodash`. */
export interface RepoDashApi {
  getSnapshot(): Promise<Snapshot>
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void
  onRepoChanged(listener: (path: string) => void): () => void
  getStatus(path: string): Promise<RepoResult>

  addRepository(): Promise<AddResult>
  addScanFolder(): Promise<AddResult>
  removeSource(id: string): Promise<Snapshot>
  setFolderDepth(id: string, depth: number): Promise<Snapshot>
  rescan(): Promise<Snapshot>

  removeRepo(path: string): Promise<Snapshot>
  restoreRepo(path: string): Promise<Snapshot>
  setOrder(paths: string[]): Promise<Snapshot>
  setMeta(path: string, meta: RepoMeta): Promise<Snapshot>

  getDetails(path: string): Promise<RepoDetails>
  getHistory(path: string, scope: HistoryScope, limit: number): Promise<History>
  /** Resolves when the operation ends; its output streams through `onOpOutput` under `opId`. */
  runOperation(path: string, op: Operation, opId: string): Promise<OpResult>
  cancelOperation(opId: string): Promise<void>
  onOpOutput(listener: (output: OpOutput) => void): () => void
}
