import { useState, type CSSProperties } from 'react'
import type { History, HistoryScope } from '../../shared/types'
import { laneColor, relativeTime } from './format'

interface Props {
  history: History | null
  scope: HistoryScope
  onScope(scope: HistoryScope): void
  onMore(): void
}

const lane = (index: number) => ({ '--lane': laneColor(index) }) as CSSProperties

export function HistoryView({ history, scope, onScope, onMore }: Props) {
  // Clicking a legend entry picks out that branch's commits.
  const [focus, setFocus] = useState<number | null>(null)
  if (!history) return <div className="pane-empty">Reading history…</div>
  if (history.commits.length === 0) return <div className="pane-empty">No commits yet</div>

  const unclaimed = history.commits.filter((c) => c.lane < 0).length
  const toggle = (index: number) => setFocus((current) => (current === index ? null : index))

  return (
    <div className="history-pane">
      <div className="pane-toolbar">
        <div className="segmented">
          <button className={scope === 'all' ? 'active' : ''} onClick={() => onScope('all')}>
            All branches
          </button>
          <button className={scope === 'current' ? 'active' : ''} onClick={() => onScope('current')}>
            Current
          </button>
        </div>
        <span className="pane-count">{history.commits.length} commits</span>
      </div>

      <div className="legend">
        {history.lanes.map((l, index) => (
          <button
            key={l.name}
            className={`legend-chip kind-${l.kind}${focus === index ? ' active' : ''}${focus !== null && focus !== index ? ' dim' : ''}`}
            style={lane(index)}
            onClick={() => toggle(index)}
            title={`${l.count} commits${l.kind === 'merged' ? ' · branch merged and deleted' : l.kind === 'remote' ? ' · remote only' : ''}`}
          >
            <span className="legend-dot" />
            {l.current && <span className="legend-current">◆</span>}
            {l.name}
            <span className="legend-count">{l.count}</span>
          </button>
        ))}
        {unclaimed > 0 && (
          <span className="legend-chip kind-other" style={lane(-1)} title="Reached only through tags or beyond the loaded range">
            <span className="legend-dot" />
            other
            <span className="legend-count">{unclaimed}</span>
          </span>
        )}
      </div>

      <ol className="history">
        {history.commits.map((commit, index) => {
          const next = history.commits[index + 1]
          const continues = next !== undefined && next.lane === commit.lane && commit.parents[0] === next.hash
          const classes = ['commit', focus !== null && commit.lane !== focus && 'dim', continues && 'continues']
          return (
            <li key={commit.hash} className={classes.filter(Boolean).join(' ')} style={lane(commit.lane)}>
              <span className="lane-mark">
                <span className={commit.parents.length > 1 ? 'lane-dot merge' : 'lane-dot'} />
              </span>
              <span className="commit-hash">{commit.hash.slice(0, 7)}</span>
              <span className="commit-main">
                {commit.refs.map((ref) => (
                  <span key={`${ref.kind}:${ref.name}`} className={`ref ref-${ref.kind}`} style={lane(ref.lane)}>
                    {ref.kind === 'tag' ? `⌂ ${ref.name}` : ref.name}
                  </span>
                ))}
                <span className="commit-subject" title={commit.subject}>
                  {commit.subject}
                </span>
              </span>
              <span className="commit-author">{commit.author}</span>
              <span className="commit-age" title={new Date(commit.time).toLocaleString()}>
                {relativeTime(commit.time)}
              </span>
            </li>
          )
        })}
      </ol>

      {history.truncated && (
        <button className="hud-btn small more" onClick={onMore}>
          Load more
        </button>
      )}
    </div>
  )
}
