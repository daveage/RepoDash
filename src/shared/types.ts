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
  /** The section the user moved the repository to; without one it stays in its default section. */
  section?: string
}

export interface RepoEntry {
  path: string
  sourceId: string
  /** The section it is shown in. */
  section: string
  /** Its default section: the scan folder's, or for a single repository the folder that holds it. */
  home: string
}

/**
 * A group of cards. Every scan folder has a default section (`source:<id>`), single repositories one per
 * folder that holds them (`dir:<folder>`); the user adds their own (`custom:<id>`).
 */
export interface Section {
  id: string
  name: string
  /** Default sections: the folder their repositories come from. */
  path?: string
  /** Made by the user: it can be deleted and stays on the board when empty. */
  custom: boolean
  collapsed: boolean
  /** Its repositories, in the order the user arranged them. */
  repos: string[]
  /** Default sections of scan folders: subfolders holding two or more of the section's repositories. */
  suggestions: SectionSuggestion[]
}

export interface SectionSuggestion {
  /** The subfolder; dismissing the suggestion remembers it. */
  path: string
  name: string
  repos: string[]
}

export type SectionEdit =
  /** A new section after `after` (or last), with `repos` moved into it. */
  | { kind: 'create'; name: string; after?: string; repos?: string[] }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'move'; id: string; by: -1 | 1 }
  /** Sections made by the user only; their repositories go back to their default sections. */
  | { kind: 'delete'; id: string }
  | { kind: 'collapse'; id: string; collapsed: boolean }
  | { kind: 'dismiss'; id: string; paths: string[] }

export interface Settings {
  /** Minutes between background fetches of every repository; 0 turns them off. */
  autoFetchMinutes: number
  notifications: boolean
}

export const AUTO_FETCH_CHOICES = [0, 5, 15, 30, 60]

/** Everything the renderer shows apart from git status, pushed by the main process on every change. */
export interface Snapshot {
  sources: Source[]
  /** In the user's order, every section's repositories in turn; newly found repositories go last. */
  repos: RepoEntry[]
  /** In the user's order, including default sections that are empty. */
  sections: Section[]
  /** Repositories found by a folder scan that the user removed from the dashboard. */
  hidden: string[]
  meta: Record<string, RepoMeta>
  settings: Settings
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
  /** ff-only by default; a diverged branch needs rebase or merge. */
  | { kind: 'pull'; mode?: PullMode }
  | { kind: 'push' }
  /** `branch` is a local name or a remote one (`origin/x`), which gets a tracking branch. */
  | { kind: 'switch'; branch: string; stash: boolean }
  | { kind: 'create-branch'; name: string; stash: boolean }
  | { kind: 'stage'; paths: string[] }
  | { kind: 'unstage'; paths: string[] }
  | { kind: 'commit'; message: string }
  /** Throws away changes: `staged` back to HEAD (index and working tree), otherwise the working tree to the index. */
  | { kind: 'discard'; paths: string[]; staged: boolean }
  /** Untracked files and folders go to the system trash, so they can still be recovered. */
  | { kind: 'trash'; paths: string[] }
  /** A new commit that undoes `hash`; a merge is undone against its first parent. */
  | { kind: 'revert'; hash: string }
  | { kind: 'stash-push' }
  | { kind: 'stash-pop' }
  | { kind: 'abort'; operation: RepoOperation }
  /** After conflicts are resolved and staged. */
  | { kind: 'continue'; operation: RepoOperation }

export type PullMode = 'ff-only' | 'rebase' | 'merge'

export interface OpResult {
  ok: boolean
  error?: string
}

export interface OpOutput {
  opId: string
  text: string
}

/** What a diff shows: a file's unstaged or staged changes, an untracked file or folder, or a commit. */
export type DiffTarget =
  | { kind: 'worktree'; file: string }
  /** `origFile`: the path before a staged rename, so the diff shows the rename. */
  | { kind: 'staged'; file: string; origFile?: string }
  | { kind: 'untracked'; file: string }
  | { kind: 'commit'; hash: string }

export interface Diff {
  /** Unified diff as git prints it. */
  text: string
  /** Commits: the full message. */
  message?: string
  /** The diff was cut at the size limit. */
  truncated: boolean
}

/** Counts the renderer reports for the tray icon and the taskbar or dock badge. */
export interface Summary {
  dirty: number
  outOfSync: number
  /** Repositories "Pull clean" would update. */
  pullable: number
}

export interface Notice {
  title: string
  body: string
  /** Clicking the notification opens this repository. */
  path?: string
}

/** Requests from the tray menu and notifications, carried out by the renderer like its own buttons. */
export type UiCommand = { kind: 'fetch-all' } | { kind: 'pull-clean' } | { kind: 'open'; path: string }

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
  /** Puts a repository into a section; `order` is the new order of all repositories. */
  placeRepo(path: string, section: string, order: string[]): Promise<Snapshot>
  editSections(edit: SectionEdit): Promise<Snapshot>
  setMeta(path: string, meta: RepoMeta): Promise<Snapshot>
  setSettings(settings: Partial<Settings>): Promise<Snapshot>

  getDetails(path: string): Promise<RepoDetails>
  getHistory(path: string, scope: HistoryScope, limit: number): Promise<History>
  getDiff(path: string, target: DiffTarget): Promise<Diff>
  /** Resolves when the operation ends; its output streams through `onOpOutput` under `opId`. */
  runOperation(path: string, op: Operation, opId: string): Promise<OpResult>
  cancelOperation(opId: string): Promise<void>
  onOpOutput(listener: (output: OpOutput) => void): () => void

  setSummary(summary: Summary): void
  notify(notice: Notice): void
  onCommand(listener: (command: UiCommand) => void): () => void
}
