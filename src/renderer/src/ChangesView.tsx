import { useState } from 'react'
import type { FileChange } from '../../shared/types'

interface Props {
  files: FileChange[] | null
  busy: boolean
  canPush: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onCommit(message: string, push: boolean): Promise<boolean>
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

export function ChangesView({ files, busy, canPush, onStage, onUnstage, onCommit }: Props) {
  const [message, setMessage] = useState('')
  if (!files) return <div className="pane-empty">Reading changes…</div>

  const staged = files.filter((f) => f.kind !== 'untracked' && f.kind !== 'conflict' && f.index !== '.')
  const unstaged = files.filter((f) => f.kind !== 'untracked' && f.kind !== 'conflict' && f.worktree !== '.')
  const untracked = files.filter((f) => f.kind === 'untracked')
  const conflicts = files.filter((f) => f.kind === 'conflict')
  // Unstaging a rename has to reset both of its paths.
  const stagedPaths = (list: FileChange[]) => list.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]))
  const canCommit = staged.length > 0 && conflicts.length === 0 && message.trim() !== '' && !busy

  const commit = async (push: boolean) => {
    if (!canCommit) return
    if (await onCommit(message, push)) setMessage('')
  }

  if (files.length === 0) return <div className="pane-empty">Working tree clean</div>

  return (
    <div className="changes-pane">
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
        />
        <FileGroup
          title="Untracked"
          files={untracked}
          letter={() => '?'}
          action="Stage all"
          busy={busy}
          onAll={() => onStage(untracked.map((f) => f.path))}
          onFile={(f) => onStage([f.path])}
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
  )
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
}

function FileGroup({ title, tone, files, letter, checked, action, busy, onAll, onFile }: GroupProps) {
  if (files.length === 0) return null
  return (
    <section className={`file-group${tone ? ` tone-${tone}` : ''}`}>
      <header className="file-group-head">
        <span className="section-title">
          {title} <span className="group-count">{files.length}</span>
        </span>
        <button className="hud-btn small" disabled={busy} onClick={onAll}>
          {action}
        </button>
      </header>
      <ul className="file-list">
        {files.slice(0, MAX_ROWS).map((file) => {
          const code = letter(file)
          return (
            <li key={`${file.path}:${code}`} className="file-row">
              <button
                className={`file-check${checked ? ' checked' : ''}`}
                disabled={busy}
                onClick={() => onFile(file)}
                title={checked ? 'Unstage' : title === 'Conflicts' ? 'Mark resolved' : 'Stage'}
              />
              <span className={`file-letter letter-${code === '?' ? 'u' : code}`} title={LETTER_NAMES[code] ?? code}>
                {code}
              </span>
              <span className="file-path" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
                {file.origPath && <span className="file-orig">{file.origPath} → </span>}
                {file.path}
              </span>
            </li>
          )
        })}
        {files.length > MAX_ROWS && <li className="file-more">+ {files.length - MAX_ROWS} more</li>}
      </ul>
    </section>
  )
}
