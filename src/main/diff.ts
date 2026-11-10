import { lstat, readFile, readlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Diff, DiffTarget } from '../shared/types'
import { runGit, runGitCapped } from './git'

/** The panel is for reading changes; a diff of a vendored library or a dump is cut here. */
const MAX_DIFF_BYTES = 1024 * 1024
/** Untracked folders: files shown before the rest is left out. */
const MAX_UNTRACKED_FILES = 200

// --literal-pathspecs: the paths are file names, never pathspec magic.
const DIFF_ARGS = ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '-M']

/** A path from the renderer, checked to stay inside the repository. */
function repoFile(repo: string, file: unknown): string {
  if (typeof file !== 'string' || file === '' || isAbsolute(file)) throw new Error('Not a file in the repository')
  const rel = relative(repo, resolve(repo, file))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Not a file in the repository')
  }
  return file
}

export async function readDiff(repo: string, target: DiffTarget): Promise<Diff> {
  switch (target.kind) {
    case 'worktree':
      return runGitCapped(repo, [...DIFF_ARGS, '--', repoFile(repo, target.file)], MAX_DIFF_BYTES)
    case 'staged': {
      const files = [repoFile(repo, target.file), ...(target.origFile ? [repoFile(repo, target.origFile)] : [])]
      return runGitCapped(repo, [...DIFF_ARGS, '--cached', '--', ...files], MAX_DIFF_BYTES)
    }
    case 'untracked':
      return untrackedDiff(repo, repoFile(repo, target.file))
    case 'commit': {
      if (typeof target.hash !== 'string' || !/^[0-9a-f]{7,64}$/i.test(target.hash)) throw new Error('Not a commit hash')
      // The message, a NUL, then the diff; a merge is shown against its first parent, as the history draws it.
      const { text, truncated } = await runGitCapped(
        repo,
        ['show', '--no-color', '--no-ext-diff', '-M', '--diff-merges=first-parent', '--format=%B%x00', target.hash, '--'],
        MAX_DIFF_BYTES
      )
      const end = text.indexOf('\0')
      if (end < 0) return { text, truncated }
      return { message: text.slice(0, end).trim(), text: text.slice(end + 1).replace(/^\n+/, ''), truncated }
    }
    default:
      throw new Error('Unknown diff')
  }
}

/** git has no diff for untracked files; this one shows every line as added, like `git add -N` would. */
async function untrackedDiff(repo: string, file: string): Promise<Diff> {
  const info = await lstat(join(repo, file))
  if (!info.isDirectory()) {
    const text = await newFileDiff(repo, file)
    return { text: text.slice(0, MAX_DIFF_BYTES), truncated: text.length > MAX_DIFF_BYTES }
  }
  // Status lists an untracked folder as one entry; show the files inside it.
  const out = await runGit(repo, ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', file])
  const files = out.split('\0').filter(Boolean)
  let text = ''
  for (const each of files.slice(0, MAX_UNTRACKED_FILES)) {
    text += await newFileDiff(repo, each)
    if (text.length > MAX_DIFF_BYTES) return { text: text.slice(0, MAX_DIFF_BYTES), truncated: true }
  }
  return { text, truncated: files.length > MAX_UNTRACKED_FILES }
}

async function newFileDiff(repo: string, file: string): Promise<string> {
  const full = join(repo, file)
  const path = file.replace(/\\/g, '/')
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n`
  const info = await lstat(full)
  if (info.isSymbolicLink()) return `${header}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${await readlink(full)}\n`
  if (info.size > MAX_DIFF_BYTES) return `${header}File too large to show (${Math.round(info.size / 1024)} KB)\n`
  const data = await readFile(full)
  if (data.length === 0) return header
  if (data.subarray(0, 8000).includes(0)) return `${header}Binary files /dev/null and b/${path} differ\n`
  const content = data.toString('utf8')
  const lines = content.split('\n')
  const endsWithNewline = content.endsWith('\n')
  if (endsWithNewline) lines.pop()
  return (
    `${header}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n` +
    lines.map((line) => `+${line}\n`).join('') +
    (endsWithNewline ? '' : '\\ No newline at end of file\n')
  )
}
