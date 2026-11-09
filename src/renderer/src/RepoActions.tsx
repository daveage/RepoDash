import type { Operation, RepoStatus } from '../../shared/types'

interface Props {
  status: RepoStatus | undefined
  busy: boolean
  run(op: Operation, label: string): unknown
}

/** Fetch / pull / push; the counts on pull and push say what each would move. */
export function RepoActions({ status, busy, run }: Props) {
  // A branch without commits has nothing to push yet.
  const onBranch = !!status?.branch && !!status.head
  const hasUpstream = !!status?.upstream
  const publish = onBranch && !hasUpstream
  return (
    <div className="repo-actions">
      <button className="hud-btn small" disabled={busy || !status} onClick={() => run({ kind: 'fetch' }, 'Fetch')}>
        Fetch
      </button>
      <button
        className={`hud-btn small${status?.behind ? ' attention' : ''}`}
        disabled={busy || !hasUpstream}
        onClick={() => run({ kind: 'pull' }, 'Pull')}
        title={hasUpstream ? 'Fast-forward only' : 'No upstream branch'}
      >
        Pull{status?.behind ? ` ▼${status.behind}` : ''}
      </button>
      <button
        className={`hud-btn small${status?.ahead || publish ? ' attention' : ''}`}
        disabled={busy || !onBranch}
        onClick={() => run({ kind: 'push' }, publish ? 'Publish branch' : 'Push')}
        title={publish ? 'Push and set upstream on origin' : onBranch ? undefined : 'HEAD is detached'}
      >
        {publish ? 'Publish' : `Push${status?.ahead ? ` ▲${status.ahead}` : ''}`}
      </button>
    </div>
  )
}
