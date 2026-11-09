import { useMemo, useState, type CSSProperties } from 'react'
import type { History, HistoryScope } from '../../shared/types'
import { laneColor, relativeTime } from './format'
import { layoutGraph } from './graph'

interface Props {
  history: History | null
  scope: HistoryScope
  onScope(scope: HistoryScope): void
  onMore(): void
}

/** Must match `.commit` height in detail.css: the graph is one SVG behind rows of this height. */
const ROW_H = 28
const COL_W = 14
const PAD = 10
/** Wider graphs (dozens of parallel branches) are cut off rather than squeezing the subjects out. */
const MAX_GRAPH_COLUMNS = 16

const lane = (index: number) => ({ '--lane': laneColor(index) }) as CSSProperties
const x = (column: number) => PAD + column * COL_W
const y = (row: number) => row * ROW_H + ROW_H / 2

export function HistoryView({ history, scope, onScope, onMore }: Props) {
  // Clicking a legend entry picks out that branch's commits.
  const [focus, setFocus] = useState<number | null>(null)
  const graph = useMemo(() => (history ? layoutGraph(history.commits) : null), [history])
  if (!history || !graph) return <div className="pane-empty">Reading history…</div>
  if (history.commits.length === 0) return <div className="pane-empty">No commits yet</div>

  const unclaimed = history.commits.filter((c) => c.lane < 0).length
  const toggle = (index: number) => setFocus((current) => (current === index ? null : index))
  const dimmed = (laneIndex: number) => focus !== null && laneIndex !== focus
  const graphWidth = x(Math.min(graph.columns, MAX_GRAPH_COLUMNS) - 1) + PAD
  const headHash = history.commits.find((c) => c.refs.some((r) => r.kind === 'head'))?.hash

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
            className={`legend-chip kind-${l.kind}${focus === index ? ' active' : ''}${dimmed(index) ? ' dim' : ''}`}
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

      <div className="history" style={{ '--graph-w': `${graphWidth}px` } as CSSProperties}>
        <svg className="graph" width={graphWidth} height={history.commits.length * ROW_H} aria-hidden="true">
          {graph.segments.map((s, index) => {
            const x1 = x(s.from)
            const x2 = x(s.to)
            const y1 = y(s.row)
            const y2 = y(s.row + 1)
            const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${y1 + ROW_H / 2} ${x2} ${y1 + ROW_H / 2} ${x2} ${y2}`
            return (
              <path
                key={index}
                d={d}
                stroke={laneColor(s.lane)}
                className={dimmed(s.lane) ? 'edge dim' : 'edge'}
              />
            )
          })}
          {history.commits.map((commit, row) => {
            const cx = x(graph.nodeColumn[row])
            const color = laneColor(commit.lane)
            const merge = commit.parents.length > 1
            return (
              <g key={commit.hash} className={dimmed(commit.lane) ? 'node dim' : 'node'}>
                {commit.hash === headHash && <circle cx={cx} cy={y(row)} r={8} fill="none" stroke={color} className="head-ring" />}
                <circle
                  cx={cx}
                  cy={y(row)}
                  r={merge ? 4.5 : 4}
                  fill={merge ? 'var(--bg)' : color}
                  stroke={color}
                  strokeWidth={merge ? 2 : 0}
                />
              </g>
            )
          })}
        </svg>

        <ol className="history-rows">
          {history.commits.map((commit) => (
            <li key={commit.hash} className={dimmed(commit.lane) ? 'commit dim' : 'commit'} style={lane(commit.lane)}>
              <span className="graph-space" />
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
          ))}
        </ol>
      </div>

      {history.truncated && (
        <button className="hud-btn small more" onClick={onMore}>
          Load more
        </button>
      )}
    </div>
  )
}
