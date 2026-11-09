import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { BranchInfo, History, HistoryScope, Operation, RepoDetails, RepoStatus } from '../../shared/types'
import { BranchesView } from './BranchesView'
import { ChangesView } from './ChangesView'
import { ConfirmDialog, type Choice } from './ConfirmDialog'
import { ConsoleView } from './ConsoleView'
import { isDirty, summarize } from './format'
import { HistoryView } from './HistoryView'
import type { ConsoleEntry } from './operations'
import { RepoActions } from './RepoActions'

export type DetailTab = 'history' | 'changes' | 'branches' | 'console'

interface Props {
  path: string
  name: string
  accent: string
  status: RepoStatus | undefined
  tab: DetailTab
  entries: ConsoleEntry[]
  busy: boolean
  onTab(tab: DetailTab): void
  run(op: Operation, label: string): Promise<boolean>
  onCancel(id: string): void
  onClose(): void
}

const HISTORY_PAGE = 300

interface Prompt {
  title: string
  body: string
  choices: Choice[]
}

export function RepoDetail(props: Props) {
  const { path, name, accent, status, tab, entries, busy, onTab, run, onCancel, onClose } = props
  const [details, setDetails] = useState<RepoDetails | null>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [scope, setScope] = useState<HistoryScope>('all')
  const [limit, setLimit] = useState(HISTORY_PAGE)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Every status refresh means something changed: re-read files, branches and history.
  const stamp = status?.checkedAt
  useEffect(() => {
    let live = true
    window.repodash.getDetails(path).then(
      (next) => live && (setDetails(next), setLoadError(null)),
      (error) => live && setLoadError(String(error))
    )
    return () => {
      live = false
    }
  }, [path, stamp])

  useEffect(() => {
    let live = true
    window.repodash.getHistory(path, scope, limit).then(
      (next) => live && setHistory(next),
      (error) => live && setLoadError(String(error))
    )
    return () => {
      live = false
    }
  }, [path, scope, limit, stamp])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dirty = status ? isDirty(status) : false
  const closePrompt = useCallback(() => setPrompt(null), [])

  /** Switching with uncommitted work asks first: stash it, or carry it over (git refuses if it would be lost). */
  const confirmDirty = (target: string, go: (stash: boolean) => void) => {
    if (!dirty) return go(false)
    setPrompt({
      title: 'Uncommitted changes',
      body: `The working tree has changes. Switching to ${target}:`,
      choices: [
        { label: 'Carry changes', onChoose: () => (setPrompt(null), go(false)) },
        { label: 'Stash & switch', tone: 'primary', onChoose: () => (setPrompt(null), go(true)) }
      ]
    })
  }

  const switchTo = (branch: BranchInfo) =>
    confirmDirty(branch.name, (stash) => void run({ kind: 'switch', branch: branch.name, stash }, `Switch to ${branch.name}`))

  const create = (newName: string) =>
    confirmDirty(newName, (stash) => void run({ kind: 'create-branch', name: newName, stash }, `Create branch ${newName}`))

  const abort = () => {
    const operation = status?.operation
    if (!operation) return
    setPrompt({
      title: `Abort ${operation}`,
      body:
        operation === 'bisect'
          ? 'Ends the bisect session and returns to the original branch.'
          : `Throws away the ${operation} in progress, including conflicts you have already resolved.`,
      choices: [
        {
          label: `Abort ${operation}`,
          tone: 'danger',
          onChoose: () => (setPrompt(null), void run({ kind: 'abort', operation }, `Abort ${operation}`))
        }
      ]
    })
  }

  const files = details?.files ?? null
  const changeCount = files?.length ?? 0
  const summary = status ? summarize(status) : null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer detail"
        style={{ '--accent': accent } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail-head">
          <div className="detail-title">
            <span className="detail-name">{name}</span>
            <span className="detail-branch">
              {status ? (status.branch ?? `detached @ ${status.head ?? '—'}`) : '…'}
              {status?.upstream && <span className="detail-upstream"> ⟶ {status.upstream}</span>}
            </span>
            <span className="detail-path" title={path}>
              {path}
            </span>
          </div>
          {summary && <span className={`card-state tone-${summary.tone}`}>{summary.label}</span>}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </header>

        <div className="detail-actions">
          <RepoActions status={status} busy={busy} run={run} />
          <span className="spacer" />
          <button
            className="hud-btn small"
            disabled={busy || !dirty}
            onClick={() => run({ kind: 'stash-push' }, 'Stash changes')}
          >
            Stash
          </button>
          <button
            className="hud-btn small"
            disabled={busy || !status?.stash}
            onClick={() => run({ kind: 'stash-pop' }, 'Pop stash')}
          >
            Pop stash{status?.stash ? ` (${status.stash})` : ''}
          </button>
        </div>

        {status?.operation && (
          <div className="detail-banner">
            <span>{status.operation} in progress</span>
            <button className="hud-btn small danger" disabled={busy} onClick={abort}>
              Abort {status.operation}
            </button>
          </div>
        )}
        {loadError && <div className="notice">{loadError}</div>}

        <nav className="tabs">
          {(['history', 'changes', 'branches', 'console'] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => onTab(t)}>
              {t}
              {t === 'changes' && changeCount > 0 && <span className="tab-count">{changeCount}</span>}
              {t === 'console' && entries.some((e) => e.state === 'error') && <span className="tab-alert">!</span>}
            </button>
          ))}
        </nav>

        <div className="detail-body">
          {tab === 'history' && (
            <HistoryView
              history={history}
              scope={scope}
              onScope={(next) => (setScope(next), setLimit(HISTORY_PAGE))}
              onMore={() => setLimit((current) => current + HISTORY_PAGE)}
            />
          )}
          {tab === 'changes' && (
            <ChangesView
              files={files}
              busy={busy}
              canPush={!!status?.branch}
              onStage={(paths) => run({ kind: 'stage', paths }, `Stage ${describe(paths)}`)}
              onUnstage={(paths) => run({ kind: 'unstage', paths }, `Unstage ${describe(paths)}`)}
              onCommit={async (message, push) => {
                const ok = await run({ kind: 'commit', message }, `Commit: ${message.split('\n')[0]}`)
                if (ok && push) await run({ kind: 'push' }, status?.upstream ? 'Push' : 'Publish branch')
                return ok
              }}
            />
          )}
          {tab === 'branches' && (
            <BranchesView branches={details?.branches ?? null} busy={busy} onSwitch={switchTo} onCreate={create} />
          )}
          {tab === 'console' && <ConsoleView entries={entries} onCancel={onCancel} />}
        </div>

        {prompt && (
          <ConfirmDialog title={prompt.title} choices={prompt.choices} onCancel={closePrompt}>
            {prompt.body}
          </ConfirmDialog>
        )}
      </aside>
    </div>
  )
}

function describe(paths: string[]): string {
  return paths.length === 1 ? paths[0] : `${paths.length} files`
}
