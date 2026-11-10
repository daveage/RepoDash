import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join, resolve as resolvePath } from 'node:path'
import type { FileChange, LastCommit, RepoOperation, RepoResult, RepoStatus } from '../shared/types'

const GIT_ENV = {
  ...process.env,
  // Fail instead of waiting for a credential prompt nobody can answer.
  GIT_TERMINAL_PROMPT: '0',
  // Status must not take index.lock, or it collides with git running in the user's terminal.
  GIT_OPTIONAL_LOCKS: '0'
}

/** Refreshing dozens of repositories at once must not start dozens of git processes. */
const MAX_PARALLEL = 6
let running = 0
const waiting: (() => void)[] = []

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running < MAX_PARALLEL) running++
  else await new Promise<void>((resolve) => waiting.push(resolve))
  try {
    return await task()
  } finally {
    // Hand the slot straight to the next task so a new caller cannot slip in between.
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

export class GitError extends Error {}

export function runGit(cwd: string, args: string[]): Promise<string> {
  return withSlot(
    () =>
      new Promise((resolve, reject) => {
        execFile(
          'git',
          ['-c', 'core.quotepath=false', ...args],
          { cwd, env: GIT_ENV, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) reject(new GitError((stderr || error.message).trim()))
            else resolve(stdout)
          }
        )
      })
  )
}

/** Like `runGit`, but stops reading after `maxBytes` of output instead of failing on huge output. */
export function runGitCapped(cwd: string, args: string[], maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  return withSlot(
    () =>
      new Promise((resolve, reject) => {
        const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd, env: GIT_ENV, windowsHide: true })
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => {
          if (truncated) return
          chunks.push(chunk)
          size += chunk.length
          if (size > maxBytes) {
            truncated = true
            child.kill()
          }
        })
        child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
        child.stdin.end()
        child.on('error', (error) => reject(new GitError(error.message)))
        child.on('close', (code) => {
          if (code !== 0 && !truncated) return reject(new GitError(stderr.trim() || `git exited with ${code}`))
          resolve({ text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'), truncated })
        })
      })
  )
}

/** Environment for commands that change the repository; unlike status, these must take locks. */
const OPERATION_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_MERGE_AUTOEDIT: 'no'
}

export interface StreamingGit {
  child: ChildProcess
  /** Exit code; null when the process was killed. */
  done: Promise<number | null>
}

/** Runs git and passes its output, stdout and stderr interleaved, to `onText` as it arrives. */
export function runGitStreaming(
  cwd: string,
  args: string[],
  onText: (text: string) => void,
  input?: string
): StreamingGit {
  const child = spawn('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
    cwd,
    env: OPERATION_ENV,
    windowsHide: true
  })
  child.stdout.setEncoding('utf8').on('data', onText)
  child.stderr.setEncoding('utf8').on('data', onText)
  child.stdin.on('error', () => {})
  child.stdin.end(input ?? '')
  const done = new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      onText(`${error.message}\n`)
      resolve(-1)
    })
    child.on('close', (code) => resolve(code))
  })
  return { child, done }
}

/** Parses the file records of `git status --porcelain=v2 -z`. */
export function parseChanges(out: string): FileChange[] {
  const files: FileChange[] = []
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const fields = record.split(' ')
    if (record.startsWith('1 ')) {
      files.push({ path: fields.slice(8).join(' '), index: record[2], worktree: record[3], kind: 'changed' })
    } else if (record.startsWith('2 ')) {
      // The original path follows as its own record.
      files.push({
        path: fields.slice(9).join(' '),
        origPath: records[++i],
        index: record[2],
        worktree: record[3],
        kind: 'renamed'
      })
    } else if (record.startsWith('u ')) {
      files.push({ path: fields.slice(10).join(' '), index: record[2], worktree: record[3], kind: 'conflict' })
    } else if (record.startsWith('? ')) {
      files.push({ path: record.slice(2), index: '?', worktree: '?', kind: 'untracked' })
    }
  }
  return files
}

export async function readChanges(path: string): Promise<FileChange[]> {
  return parseChanges(await runGit(path, ['status', '--porcelain=v2', '-z']))
}

/**
 * One spelling per directory, so paths from git (`C:/x`), the folder dialog (`C:\x`) and the
 * command line (`c:\x`) compare equal.
 */
export function canonicalPath(path: string): string {
  const resolved = resolvePath(path)
  return process.platform === 'win32' ? resolved.charAt(0).toUpperCase() + resolved.slice(1) : resolved
}

/** Returns the top-level directory of the repository containing `dir`. */
export async function resolveRepoRoot(dir: string): Promise<string> {
  const out = await runGit(dir, ['rev-parse', '--show-toplevel'])
  return canonicalPath(out.trim())
}

/** The repository's own git directory and, for a worktree, the main repository's one it shares refs with. */
export async function readGitDirs(path: string): Promise<{ gitDir: string; commonDir: string }> {
  const out = await runGit(path, ['rev-parse', '--absolute-git-dir', '--git-common-dir'])
  const [gitDir, commonDir] = out.trim().split('\n')
  return { gitDir: canonicalPath(gitDir), commonDir: canonicalPath(resolvePath(path, commonDir)) }
}

export async function readRepoStatus(path: string): Promise<RepoResult> {
  try {
    const [statusOut, gitDir, lastCommit] = await Promise.all([
      runGit(path, ['status', '--porcelain=v2', '--branch', '--show-stash', '-z']),
      runGit(path, ['rev-parse', '--absolute-git-dir']).then((out) => out.trim()),
      readLastCommit(path)
    ])
    const status: RepoStatus = {
      ...parseStatus(statusOut),
      path,
      name: basename(path),
      operation: detectOperation(gitDir),
      lastCommit,
      checkedAt: Date.now()
    }
    return { ok: true, status }
  } catch (error) {
    return { ok: false, path, error: error instanceof Error ? error.message : String(error) }
  }
}

type ParsedStatus = Omit<RepoStatus, 'path' | 'name' | 'operation' | 'lastCommit' | 'checkedAt'>

/** Parses `git status --porcelain=v2 --branch --show-stash -z`. */
export function parseStatus(out: string): ParsedStatus {
  const result: ParsedStatus = {
    branch: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    stash: 0
  }
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') result.head = value === '(initial)' ? null : value.slice(0, 7)
      else if (key === 'branch.head') result.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') result.upstream = value
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value)
        if (match) {
          result.ahead = Number(match[1])
          result.behind = Number(match[2])
        }
      } else if (key === 'stash') result.stash = Number(value)
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const [indexState, worktreeState] = record.slice(2, 4)
      if (indexState !== '.') result.staged++
      if (worktreeState !== '.') result.modified++
      // A rename or copy record is followed by the original path as its own record.
      if (record.startsWith('2 ')) i++
    } else if (record.startsWith('u ')) {
      result.conflicted++
    } else if (record.startsWith('? ')) {
      result.untracked++
    }
  }
  return result
}

async function readLastCommit(path: string): Promise<LastCommit | null> {
  try {
    const out = await runGit(path, ['log', '-1', '--format=%h%x00%s%x00%an%x00%ct'])
    const [hash, subject, author, time] = out.trim().split('\0')
    return { hash, subject, author, time: Number(time) * 1000 }
  } catch {
    // A repository without commits has no log.
    return null
  }
}

function detectOperation(gitDir: string): RepoOperation | null {
  const has = (name: string) => existsSync(join(gitDir, name))
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (has('REVERT_HEAD')) return 'revert'
  if (has('BISECT_LOG')) return 'bisect'
  return null
}
