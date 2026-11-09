import { useState } from 'react'
import type { Operation, RepoStatus } from '../../shared/types'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  status: RepoStatus | undefined
  busy: boolean
  run(op: Operation, label: string): unknown
}

/** Fetch / pull / push; the counts on pull and push say what each would move. */
export function RepoActions({ status, busy, run }: Props) {
  const [askPull, setAskPull] = useState(false)
  // A branch without commits has nothing to push yet.
  const onBranch = !!status?.branch && !!status.head
  const hasUpstream = !!status?.upstream
  const publish = onBranch && !hasUpstream
  // Fast-forward cannot work when both sides have new commits; ask how to combine them.
  const diverged = !!status?.ahead && !!status.behind

  const pull = () => (diverged ? setAskPull(true) : run({ kind: 'pull' }, 'Pull'))
  const pullWith = (mode: 'rebase' | 'merge') => {
    setAskPull(false)
    run({ kind: 'pull', mode }, mode === 'rebase' ? 'Pull (rebase)' : 'Pull (merge)')
  }

  return (
    <div className="repo-actions">
      <button
        className="hud-btn small"
        data-action="fetch"
        disabled={busy || !status}
        onClick={() => run({ kind: 'fetch' }, 'Fetch')}
      >
        Fetch
      </button>
      <button
        className={`hud-btn small${status?.behind ? ' attention' : ''}`}
        data-action="pull"
        disabled={busy || !hasUpstream}
        onClick={pull}
        title={!hasUpstream ? 'No upstream branch' : diverged ? 'Diverged: rebase or merge' : 'Fast-forward'}
      >
        Pull{status?.behind ? ` ▼${status.behind}` : ''}
      </button>
      <button
        className={`hud-btn small${status?.ahead || publish ? ' attention' : ''}`}
        data-action="push"
        disabled={busy || !onBranch}
        onClick={() => run({ kind: 'push' }, publish ? 'Publish branch' : 'Push')}
        title={publish ? 'Push and set upstream on origin' : onBranch ? undefined : 'Nothing to push'}
      >
        {publish ? 'Publish' : `Push${status?.ahead ? ` ▲${status.ahead}` : ''}`}
      </button>

      {askPull && status && (
        <ConfirmDialog
          title="Branch has diverged"
          onCancel={() => setAskPull(false)}
          choices={[
            { label: 'Merge', onChoose: () => pullWith('merge') },
            { label: 'Rebase', tone: 'primary', onChoose: () => pullWith('rebase') }
          ]}
        >
          {status.branch} has {status.ahead} local and {status.behind} remote commit{status.behind === 1 ? '' : 's'} the
          other side lacks. <b>Rebase</b> replays your local commits on top of {status.upstream}; <b>Merge</b> joins
          both with a merge commit. Uncommitted changes are stashed and restored around it.
        </ConfirmDialog>
      )}
    </div>
  )
}
