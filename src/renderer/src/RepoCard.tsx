import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, ReactNode } from 'react'
import type { Operation, RepoMeta, RepoResult, RepoStatus } from '../../shared/types'
import { baseName, defaultAccent, pad2, relativeTime, summarize } from './format'
import type { ConsoleEntry } from './operations'
import type { DetailTab } from './RepoDetail'
import { RepoActions } from './RepoActions'

interface Props {
  path: string
  /** Position in the grid; staggers the cards' entrance. */
  index: number
  result: RepoResult | undefined
  meta: RepoMeta | undefined
  busy: boolean
  /** An operation is running in this repository. */
  opBusy: boolean
  /** The latest operation in this repository, shown in the footer. */
  lastOp: ConsoleEntry | undefined
  run(op: Operation, label: string): unknown
  onOpen(tab: DetailTab): void
  onRefresh(): void
  onConfigure(): void
  /** Rendered over the card while it is being configured. */
  overlay?: ReactNode
}

export function RepoCard(props: Props) {
  const { path, index, result, meta, busy, opBusy, lastOp, run, onOpen, onRefresh, onConfigure, overlay } = props
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: path
  })
  const dirName = result?.ok ? result.status.name : baseName(path)
  const name = meta?.alias ?? dirName
  const summary = result?.ok ? summarize(result.status) : result ? { label: 'error', tone: 'alert' as const } : null
  const style = {
    '--accent': meta?.color ?? defaultAccent(dirName),
    '--i': index,
    transform: CSS.Translate.toString(transform),
    transition
  } as CSSProperties
  const classes = ['card', `tone-${summary?.tone ?? 'idle'}`, (busy || opBusy) && 'is-busy', isDragging && 'is-dragging']

  return (
    <article
      ref={setNodeRef}
      className={classes.filter(Boolean).join(' ')}
      style={style}
      tabIndex={0}
      aria-label={name}
    >
      {/* Remounted when the status word changes, which replays its one-off glow. */}
      {summary && <span key={summary.label} className="card-pulse" />}
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />

      {/* The header is the drag handle, so buttons and inputs elsewhere on the card keep working. */}
      <header className="card-head" ref={setActivatorNodeRef} {...attributes} {...listeners} title="Drag to reorder">
        <div className="card-title">
          <h2 className="card-name">{name}</h2>
          <div className="card-path" title={path}>
            {path}
          </div>
        </div>
        <div className="card-state">{summary?.label ?? 'acquiring'}</div>
      </header>

      <div className="ruler" />

      {result?.ok && <StatusBody status={result.status} onOpen={onOpen} />}
      {result && !result.ok && <div className="card-error">{result.error}</div>}
      {!result && <div className="card-pending">Acquiring signal…</div>}

      <div className="card-actions">
        <RepoActions status={result?.ok ? result.status : undefined} busy={opBusy} run={run} />
        <OpStatus entry={lastOp} onOpen={() => onOpen('console')} />
        <button className="icon-btn" onClick={onRefresh} disabled={busy} title="Refresh">
          ↻
        </button>
        <button className="icon-btn" onClick={onConfigure} title="Configure">
          ⋯
        </button>
      </div>

      {overlay}
    </article>
  )
}

function OpStatus({ entry, onOpen }: { entry: ConsoleEntry | undefined; onOpen(): void }) {
  if (!entry) return <span className="card-op" />
  const text =
    entry.state === 'running'
      ? `${entry.label}`
      : entry.state === 'ok'
        ? `${entry.label} · done`
        : `${entry.label} failed · ${entry.error?.split('\n')[0] ?? ''}`
  return (
    // Keyed by state so a finished operation's fade-out starts over each time.
    <button
      key={`${entry.id}:${entry.state}`}
      className={`card-op state-${entry.state}`}
      onClick={onOpen}
      title={entry.error ?? text}
    >
      {entry.state === 'running' && <span className="radar" />}
      {text}
    </button>
  )
}

function StatusBody({ status: s, onOpen }: { status: RepoStatus; onOpen(tab: DetailTab): void }) {
  return (
    <>
      <div className="card-branch clickable" onClick={() => onOpen('branches')} title="Branches">
        <BranchIcon />
        <span className="branch">{s.branch ?? `detached @ ${s.head ?? '—'}`}</span>
        {s.upstream ? <span className="upstream">⟶ {s.upstream}</span> : <span className="upstream">no upstream</span>}
      </div>

      <dl className="metrics clickable" onClick={() => onOpen('changes')} title="Changes">
        <Metric label="Ahead" value={s.ahead} prefix="▲" />
        <Metric label="Behind" value={s.behind} prefix="▼" warn />
        <Metric label="Stash" value={s.stash} />
        <Metric label="Staged" value={s.staged} />
        <Metric label="Modified" value={s.modified} warn />
        {s.conflicted > 0 ? (
          <Metric label="Conflict" value={s.conflicted} alert />
        ) : (
          <Metric label="Untracked" value={s.untracked} />
        )}
      </dl>

      <footer className="card-commit clickable" onClick={() => onOpen('history')} title="History">
        {s.lastCommit ? (
          <>
            <span className="hash">{s.lastCommit.hash}</span>
            <span className="subject" title={`${s.lastCommit.subject} — ${s.lastCommit.author}`}>
              {s.lastCommit.subject}
            </span>
            <span className="age">{relativeTime(s.lastCommit.time)}</span>
          </>
        ) : (
          <span className="subject">no commits yet</span>
        )}
      </footer>
    </>
  )
}

function Metric(props: { label: string; value: number; prefix?: string; warn?: boolean; alert?: boolean }) {
  const { label, value, prefix, warn, alert } = props
  const tone = value === 0 ? 'zero' : alert ? 'alert' : warn ? 'warn' : ''
  return (
    <div className={`metric ${tone}`}>
      <dt>{label}</dt>
      <dd>
        {prefix && <span className="metric-prefix">{prefix}</span>}
        {pad2(value)}
      </dd>
    </div>
  )
}

function BranchIcon() {
  return (
    <svg className="branch-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="4" cy="3" r="1.6" />
      <circle cx="4" cy="13" r="1.6" />
      <circle cx="12" cy="5" r="1.6" />
      <path d="M4 4.6v6.8M12 6.6c0 3-8 2-8 5" />
    </svg>
  )
}
