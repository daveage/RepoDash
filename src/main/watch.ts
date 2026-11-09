import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { readGitDirs } from './git'

/** At most one change notification per repository in this interval. */
const THROTTLE_MS = 800

// Recursive fs.watch is cheap on Windows and macOS. On Linux it costs an inotify watch per directory,
// so there only the git directory is watched and edits in the working tree show up on window focus.
const WATCH_WORKTREE = process.platform === 'win32' || process.platform === 'darwin'

interface Watched {
  closed: boolean
  watchers: FSWatcher[]
}

/** Watches repositories and reports which one changed: HEAD, index, refs and the working tree. */
export class RepoWatcher {
  private repos = new Map<string, Watched>()
  private pending = new Set<string>()

  constructor(private onChange: (path: string) => void) {}

  sync(paths: string[]): void {
    const wanted = new Set(paths)
    for (const [path, watched] of this.repos) {
      if (wanted.has(path)) continue
      watched.closed = true
      watched.watchers.forEach((watcher) => watcher.close())
      this.repos.delete(path)
    }
    for (const path of wanted) {
      if (this.repos.has(path)) continue
      const watched: Watched = { closed: false, watchers: [] }
      this.repos.set(path, watched)
      void this.start(path, watched)
    }
  }

  close(): void {
    this.sync([])
  }

  private async start(path: string, watched: Watched): Promise<void> {
    let dirs
    try {
      dirs = await readGitDirs(path)
    } catch {
      return
    }
    if (watched.closed) return

    const add = (target: string, recursive: boolean, accept: (file: string) => boolean) => {
      try {
        const watcher = watch(target, { recursive, persistent: false }, (_event, file) => {
          if (file && accept(file)) this.bump(path)
        })
        watcher.on('error', () => watcher.close())
        watched.watchers.push(watcher)
      } catch {
        // The directory vanished or cannot be watched; status still refreshes on focus.
      }
    }

    // HEAD, index, MERGE_HEAD, rebase-merge/ ... — the lock files come and go during every git command.
    add(dirs.gitDir, false, (file) => !file.endsWith('.lock'))
    add(join(dirs.commonDir, 'refs'), true, () => true)
    // A worktree keeps packed-refs and the stash in the main repository's git directory.
    if (dirs.commonDir !== dirs.gitDir) add(dirs.commonDir, false, (file) => !file.endsWith('.lock'))
    if (WATCH_WORKTREE) add(path, true, isWorktreeFile)
  }

  private bump(path: string): void {
    if (this.pending.has(path)) return
    this.pending.add(path)
    setTimeout(() => {
      this.pending.delete(path)
      if (this.repos.has(path)) this.onChange(path)
    }, THROTTLE_MS)
  }
}

function isWorktreeFile(file: string): boolean {
  const segments = file.split(/[\\/]/)
  return segments[0] !== '.git' && !segments.includes('node_modules')
}
