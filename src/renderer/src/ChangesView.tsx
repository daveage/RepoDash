import { useEffect, useState } from 'react'
import type { DiffTarget, FileChange } from '../../shared/types'
import { DiffView, useDiff } from './DiffView'
import { dialogOpen, isTypingTarget } from './keys'

interface Props {
  path: string
  /** Changes on every status refresh; the open diff is read again then. */
  stamp: number | undefined
  files: FileChange[] | null
  busy: boolean
  canPush: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onCommit(message: string, push: boolean): Promise<boolean>
  /** Asks first, then throws the changes away (untracked files go to the trash). */
  onDiscard(kind: DiscardKind, paths: string[]): void
}

export type DiscardKind = 'staged' | 'unstaged' | 'untracked'

type Group = 'conflict' | 'staged' | 'unstaged' | 'untracked'

interface Selection {
  group: Group
  file: FileChange
}

function inGroup(file: FileChange, group: Group): boolean {
  if (group === 'conflict') return file.kind === 'conflict'
  if (group === 'untracked') return file.kind === 'untracked'
  if (file.kind === 'untracked' || file.kind === 'conflict') return false
  return group === 'staged' ? file.index !== '.' : file.worktree !== '.'
}

function diffTarget({ group, file }: Selection): DiffTarget {
  if (group === 'staged') return { kind: 'staged', file: file.path, origFile: file.origPath }
  if (group === 'untracked') return { kind: 'untracked', file: file.path }
  return { kind: 'worktree', file: file.path }
}

/** After staging or unstaging, the open file is followed to the group it moved to. */
function follow(selection: Selection | null, files: FileChange[] | null): Selection | null {
  if (!selection || !files) return selection
  const same = files.filter((f) => f.path === selection.file.path)
  const stay = same.find((f) => inGroup(f, selection.group))
  if (stay) return stay === selection.file ? selection : { group: selection.group, file: stay }
  for (const group of ['staged', 'unstaged', 'conflict', 'untracked'] as Group[]) {
    const moved = same.find((f) => inGroup(f, group))
    if (moved) return { group, file: moved }
  }
  return null
}

const LETTER_NAMES: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type changed',
  '?': 'untracked'
}

/** Rendering thousands of rows (e.g. a forgotten build folder) would only freeze the panel. */
const MAX_ROWS = 500

export function ChangesView({ path, stamp, files, busy, canPush, onStage, onUnstage, onCommit, onDiscard }: Props) {
  const [message, setMessage] = useState('')
  const [chosen, setChosen] = useState<Selection | null>(null)
  const selected = follow(chosen, files)
  const { diff, error } = useDiff(path, selected && diffTarget(selected), stamp)

  // Esc closes the diff before it closes the panel; in a field it only leaves the field.
  const hasSelection = selected !== null
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialogOpen() || isTypingTarget(event.target)) return
      event.stopPropagation()
      setChosen(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hasSelection])

  if (!files) return <div className="pane-empty">Reading changes…</div>

  const staged = files.filter((f) => inGroup(f, 'staged'))
  const unstaged = files.filter((f) => inGroup(f, 'unstaged'))
  const untracked = files.filter((f) => inGroup(f, 'untracked'))
  const conflicts = files.filter((f) => inGroup(f, 'conflict'))
  // Unstaging a rename has to reset both of its paths.
  const stagedPaths = (list: FileChange[]) => list.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]))
  const canCommit = staged.length > 0 && conflicts.length === 0 && message.trim() !== '' && !busy

  const commit = async (push: boolean) => {
    if (!canCommit) return
    if (await onCommit(message, push)) setMessage('')
  }

  if (files.length === 0) return <div className="pane-empty">Working tree clean</div>

  const open = (group: Group) => (file: FileChange) => setChosen({ group, file })
  const openIn = (group: Group) => (selected?.group === group ? selected.file : undefined)

  return (
    <div className={selected ? 'changes-pane split' : 'changes-pane'}>
      <div className="changes-side">
        <div className="changes-lists">
          {conflicts.length > 0 && (
            <FileGroup
              title="Conflicts"
              tone="alert"
              files={conflicts}
              letter={() => 'U'}
              action="Mark resolved"
              busy={busy}
              onAll={() => onStage(conflicts.map((f) => f.path))}
              onFile={(f) => onStage([f.path])}
              open={openIn('conflict')}
              onOpen={open('conflict')}
            />
          )}
          <FileGroup
            title="Staged"
            files={staged}
            letter={(f) => f.index}
            checked
            action="Unstage all"
            busy={busy}
            onAll={() => onUnstage(stagedPaths(staged))}
            onFile={(f) => onUnstage(stagedPaths([f]))}
            open={openIn('staged')}
            onOpen={open('staged')}
            discard="Discard"
            onDiscard={(list) => onDiscard('staged', stagedPaths(list))}
          />
          <FileGroup
            title="Changes"
            tone="warn"
            files={unstaged}
            letter={(f) => f.worktree}
            action="Stage all"
            busy={busy}
            onAll={() => onStage(unstaged.map((f) => f.path))}
            onFile={(f) => onStage([f.path])}
            open={openIn('unstaged')}
            onOpen={open('unstaged')}
            discard="Discard"
            onDiscard={(list) => onDiscard('unstaged', list.map((f) => f.path))}
          />
          <FileGroup
            title="Untracked"
            files={untracked}
            letter={() => '?'}
            action="Stage all"
            busy={busy}
            onAll={() => onStage(untracked.map((f) => f.path))}
            onFile={(f) => onStage([f.path])}
            open={openIn('untracked')}
            onOpen={open('untracked')}
            discard="Trash"
            onDiscard={(list) => onDiscard('untracked', list.map((f) => f.path))}
          />
        </div>

        <div className="commit-box">
          <textarea
            className="hud-input commit-message"
            placeholder="Commit message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void commit(false)
            }}
          />
          <div className="commit-actions">
            <span className="commit-hint">
              {conflicts.length > 0 ? 'Resolve conflicts first' : staged.length === 0 ? 'Stage files to commit' : 'Ctrl+Enter commits'}
            </span>
            <button className="hud-btn" disabled={!canCommit} onClick={() => commit(false)}>
              Commit
            </button>
            <button className="hud-btn primary" disabled={!canCommit || !canPush} onClick={() => commit(true)}>
              Commit & push
            </button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="changes-diff">
          <DiffView
            diff={diff}
            error={error}
            empty={selected.group === 'unstaged' ? NO_CONTENT_CHANGE : undefined}
            title={
              <>
                <span className="section-title">{GROUP_TITLES[selected.group]}</span>
                <button className="icon-btn" onClick={() => setChosen(null)} title="Close diff (Esc)">
                  ×
                </button>
              </>
            }
          />
        </div>
      )}
    </div>
  )
}

const NO_CONTENT_CHANGE = (
  <>
    <strong>No content change.</strong> git lists the file as modified, but once it converts the file the way it
    stores it, the content is the same as the staged or committed one. Usually only the line endings were
    rewritten (CRLF / LF, see <code>core.autocrlf</code>). Staging the file or discarding it with ↺ takes it off
    the list; nothing is lost either way.
  </>
)

const GROUP_TITLES: Record<Group, string> = {
  conflict: 'Conflict',
  staged: 'Staged changes',
  unstaged: 'Unstaged changes',
  untracked: 'New file'
}

interface GroupProps {
  title: string
  tone?: 'warn' | 'alert'
  files: FileChange[]
  letter(file: FileChange): string
  checked?: boolean
  action: string
  busy: boolean
  onAll(): void
  onFile(file: FileChange): void
  /** The file whose diff is open, if it is in this group. */
  open: FileChange | undefined
  onOpen(file: FileChange): void
  /** Label of the discard action ("Discard", "Trash"); groups without one cannot be discarded. */
  discard?: string
  onDiscard?(files: FileChange[]): void
}

function FileGroup(props: GroupProps) {
  const { title, tone, files, letter, checked, action, busy, onAll, onFile, open, onOpen, discard, onDiscard } = props
  if (files.length === 0) return null
  return (
    <section className={`file-group${tone ? ` tone-${tone}` : ''}`}>
      <header className="file-group-head">
        <span className="section-title">
          {title} <span className="group-count">{files.length}</span>
        </span>
        {discard && onDiscard && (
          <button className="hud-btn small danger" disabled={busy} onClick={() => onDiscard(files)}>
            {discard} all
          </button>
        )}
        <button className="hud-btn small" disabled={busy} onClick={onAll}>
          {action}
        </button>
      </header>
      <ul className="file-list">
        {files.slice(0, MAX_ROWS).map((file) => {
          const code = letter(file)
          return (
            <li key={`${file.path}:${code}`} className={file === open ? 'file-row selected' : 'file-row'}>
              <button
                className={`file-check${checked ? ' checked' : ''}`}
                disabled={busy}
                onClick={() => onFile(file)}
                title={checked ? 'Unstage' : title === 'Conflicts' ? 'Mark resolved' : 'Stage'}
              />
              <span className={`file-letter letter-${code === '?' ? 'u' : code}`} title={LETTER_NAMES[code] ?? code}>
                {code}
              </span>
              <button
                className="file-path file-open"
                onClick={() => onOpen(file)}
                title={`${file.origPath ? `${file.origPath} → ${file.path}` : file.path} · show diff`}
              >
                {file.origPath && <span className="file-orig">{file.origPath} → </span>}
                {file.path}
              </button>
              {discard && onDiscard && (
                <button
                  className="icon-btn file-discard"
                  disabled={busy}
                  onClick={() => onDiscard([file])}
                  title={discard === 'Trash' ? 'Move to trash' : 'Discard changes'}
                >
                  ↺
                </button>
              )}
            </li>
          )
        })}
        {files.length > MAX_ROWS && <li className="file-more">+ {files.length - MAX_ROWS} more</li>}
      </ul>
    </section>
  )
}
