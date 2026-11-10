import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { History, HistoryCommit, HistoryScope } from '../../shared/types'
import { DiffView, useDiff } from './DiffView'
import { laneColor, relativeTime } from './format'
import { layoutGraph } from './graph'
import { dialogOpen, hasModifier, isTypingTarget } from './keys'

interface Props {
  path: string
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

export function HistoryView({ path, history, scope, onScope, onMore }: Props) {
  // Clicking a legend entry picks out that branch's commits.
  const [focus, setFocus] = useState<number | null>(null)
  const [openHash, setOpenHash] = useState<string | null>(null)
  const graph = useMemo(() => (history ? layoutGraph(history.commits) : null), [history])
  const commits = history?.commits ?? []
  const openIndex = openHash ? commits.findIndex((c) => c.hash === openHash) : -1

  // The list scrolls inside the panel body; coming back from a commit returns to the same place.
  const paneRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const scroller = () => paneRef.current?.closest('.detail-body') ?? null
  const openCommit = (hash: string) => {
    if (!openHash) savedScroll.current = scroller()?.scrollTop ?? 0
    setOpenHash(hash)
  }
  useLayoutEffect(() => {
    const body = scroller()
    if (body) body.scrollTop = openHash ? 0 : savedScroll.current
  }, [openHash])

  // Esc goes back to the list; J / K step to the older / newer commit.
  useEffect(() => {
    if (!openHash) return
    const onKey = (event: KeyboardEvent) => {
      if (dialogOpen() || isTypingTarget(event.target) || hasModifier(event)) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpenHash(null)
      } else if (event.key === 'j' || event.key === 'k') {
        const next = commits[openIndex + (event.key === 'j' ? 1 : -1)]
        if (next) setOpenHash(next.hash)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openHash, openIndex, commits])

  if (!history || !graph) return <div className="pane-empty">Reading history…</div>
  if (openHash) {
    return (
      <div ref={paneRef} className="commit-view">
        <CommitView
          path={path}
          hash={openHash}
          commit={commits[openIndex]}
          older={commits[openIndex + 1]}
          newer={openIndex > 0 ? commits[openIndex - 1] : undefined}
          onOpen={setOpenHash}
          onBack={() => setOpenHash(null)}
        />
      </div>
    )
  }
  if (history.commits.length === 0) return <div className="pane-empty">No commits yet</div>

  const unclaimed = history.commits.filter((c) => c.lane < 0).length
  const toggle = (index: number) => setFocus((current) => (current === index ? null : index))
  const dimmed = (laneIndex: number) => focus !== null && laneIndex !== focus
  const graphWidth = x(Math.min(graph.columns, MAX_GRAPH_COLUMNS) - 1) + PAD
  const headHash = history.commits.find((c) => c.refs.some((r) => r.kind === 'head'))?.hash

  return (
    <div ref={paneRef} className="history-pane">
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
            <li
              key={commit.hash}
              className={dimmed(commit.lane) ? 'commit dim' : 'commit'}
              style={lane(commit.lane)}
              onClick={() => openCommit(commit.hash)}
              title="Show the commit's changes"
            >
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

interface CommitProps {
  path: string
  hash: string
  /** Missing when the commit left the loaded history (e.g. after a rebase). */
  commit: HistoryCommit | undefined
  older: HistoryCommit | undefined
  newer: HistoryCommit | undefined
  onOpen(hash: string): void
  onBack(): void
}

function CommitView({ path, hash, commit, older, newer, onOpen, onBack }: CommitProps) {
  const { diff, error } = useDiff(path, { kind: 'commit', hash })
  return (
    <>
      <div className="pane-toolbar">
        <button className="hud-btn small" onClick={onBack} title="Back to the history (Esc)">
          ‹ History
        </button>
        <span className="commit-view-hash" style={lane(commit?.lane ?? -1)}>
          {hash.slice(0, 10)}
        </span>
        {commit && (
          <span className="pane-count" title={new Date(commit.time).toLocaleString()}>
            {commit.author} · {relativeTime(commit.time)}
            {commit.parents.length > 1 && ' · merge, shown against its first parent'}
          </span>
        )}
        <span className="spacer" />
        <button className="hud-btn small" disabled={!newer} onClick={() => newer && onOpen(newer.hash)} title="Newer commit (K)">
          Newer
        </button>
        <button className="hud-btn small" disabled={!older} onClick={() => older && onOpen(older.hash)} title="Older commit (J)">
          Older
        </button>
      </div>
      <DiffView diff={diff} error={error} />
    </>
  )
}
