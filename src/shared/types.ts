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
}
