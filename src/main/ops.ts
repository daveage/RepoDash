import type { ChildProcess } from 'node:child_process'
import type { OpResult, Operation } from '../shared/types'
import { runGit, runGitStreaming } from './git'
import { readRefs } from './history'

interface Command {
  args: string[]
  input?: string
}

class OperationError extends Error {}

const ABORT_ARGS: Record<string, string[]> = {
  merge: ['merge', '--abort'],
  rebase: ['rebase', '--abort'],
  'cherry-pick': ['cherry-pick', '--abort'],
  revert: ['revert', '--abort'],
  bisect: ['bisect', 'reset']
}

function stashBefore(target: string): Command {
  return { args: ['stash', 'push', '--include-untracked', '-m', `RepoDash: before switching to ${target}`] }
}

function nulList(paths: unknown): string {
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string' && p !== '')) {
    throw new OperationError('No files given')
  }
  return paths.join('\0')
}

/** Turns an operation into git commands, checking every name against the repository first. */
async function plan(path: string, op: Operation): Promise<Command[]> {
  switch (op.kind) {
    case 'fetch':
      return [{ args: ['fetch', '--all', '--prune', '--progress'] }]
    case 'pull':
      return [{ args: ['pull', '--ff-only', '--progress'] }]
    case 'push': {
      const refs = await readRefs(path)
      const current = refs.find((r) => r.current)
      if (!current) throw new OperationError('HEAD is detached; switch to a branch to push')
      if (current.upstream) return [{ args: ['push', '--progress'] }]
      // First push of a branch: publish it to origin, or to the only remote there is.
      const remotes = (await runGit(path, ['remote'])).split('\n').filter(Boolean)
      const remote = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null
      if (!remote) throw new OperationError(remotes.length ? 'Several remotes and none is origin' : 'No remote configured')
      return [{ args: ['push', '--progress', '--set-upstream', remote, current.name] }]
    }
    case 'switch': {
      const refs = await readRefs(path)
      const target = refs.find((r) => r.kind !== 'tag' && r.name === op.branch)
      if (!target) throw new OperationError(`No branch ${op.branch}`)
      const commands = op.stash ? [stashBefore(op.branch)] : []
      if (target.kind === 'local') return [...commands, { args: ['switch', target.name] }]
      // A remote branch: use the local branch of that name, or create one tracking it.
      const localName = target.name.slice(target.name.indexOf('/') + 1)
      const local = refs.find((r) => r.kind === 'local' && r.name === localName)
      return [...commands, { args: local ? ['switch', local.name] : ['switch', '--track', target.name] }]
    }
    case 'create-branch': {
      const name = typeof op.name === 'string' ? op.name.trim() : ''
      const valid =
        name !== '' &&
        !name.startsWith('-') &&
        (await runGit(path, ['check-ref-format', '--branch', name]).then(
          () => true,
          () => false
        ))
      if (!valid) throw new OperationError(`Not a valid branch name: ${name}`)
      return [...(op.stash ? [stashBefore(name)] : []), { args: ['switch', '-c', name] }]
    }
    // --literal-pathspecs: the paths are file names, never pathspec magic like `:(glob)*`. Only here —
    // set for every command (e.g. via GIT_LITERAL_PATHSPECS) it breaks `stash -u`, which relies on `:/`.
    case 'stage':
      return [
        { args: ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], input: nulList(op.paths) }
      ]
    case 'unstage':
      // reset also works before the first commit, unlike restore --staged.
      return [
        {
          args: ['--literal-pathspecs', 'reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'],
          input: nulList(op.paths)
        }
      ]
    case 'commit': {
      if (typeof op.message !== 'string' || op.message.trim() === '') throw new OperationError('Empty commit message')
      return [{ args: ['commit', '-F', '-'], input: op.message }]
    }
    case 'stash-push':
      return [{ args: ['stash', 'push', '--include-untracked', '-m', 'RepoDash: stash'] }]
    case 'stash-pop':
      return [{ args: ['stash', 'pop'] }]
    case 'abort': {
      const args = ABORT_ARGS[op.operation]
      if (!args) throw new OperationError(`Nothing to abort: ${op.operation}`)
      return [{ args }]
    }
    default:
      throw new OperationError('Unknown operation')
  }
}

function quote(arg: string): string {
  return /^[\w./:=@+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`
}

/** What git said went wrong: its error lines first, rejected refs next, otherwise its last words. */
function failureMessage(output: string): string {
  const lines = output
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('$ '))
  const errors = lines.filter((line) => /^(error|fatal):/i.test(line))
  if (errors.length) return errors.slice(-3).join('\n')
  const rejected = lines.filter((line) => line.startsWith('!') || line.includes('[rejected]'))
  if (rejected.length) return rejected.slice(-3).join('\n')
  return lines.filter((line) => !line.startsWith('hint:')).slice(-3).join('\n') || 'git failed'
}

/** One operation at a time per repository; a second one would only fight the first over index.lock. */
const busyRepos = new Set<string>()
const running = new Map<string, { child: ChildProcess | null; cancelled: boolean }>()

export async function runOperation(
  path: string,
  op: Operation,
  opId: string,
  emit: (text: string) => void
): Promise<OpResult> {
  if (busyRepos.has(path)) return { ok: false, error: 'Another operation is running in this repository' }
  busyRepos.add(path)
  const state = { child: null as ChildProcess | null, cancelled: false }
  running.set(opId, state)
  try {
    const commands = await plan(path, op)
    for (const command of commands) {
      if (state.cancelled) return { ok: false, error: 'Cancelled' }
      let output = ''
      const collect = (text: string) => {
        output += text
        emit(text)
      }
      collect(`$ git ${command.args.map(quote).join(' ')}\n`)
      const git = runGitStreaming(path, command.args, collect, command.input)
      state.child = git.child
      const code = await git.done
      if (state.cancelled) return { ok: false, error: 'Cancelled' }
      if (code !== 0) return { ok: false, error: failureMessage(output) }
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit(`${message}\n`)
    return { ok: false, error: message }
  } finally {
    busyRepos.delete(path)
    running.delete(opId)
  }
}

export function cancelOperation(opId: string): void {
  const state = running.get(opId)
  if (!state) return
  state.cancelled = true
  state.child?.kill()
}
