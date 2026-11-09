import { useState } from 'react'
import type { BranchInfo } from '../../shared/types'
import { relativeTime } from './format'

interface Props {
  branches: BranchInfo[] | null
  busy: boolean
  onSwitch(branch: BranchInfo): void
  onCreate(name: string): void
}

export function BranchesView({ branches, busy, onSwitch, onCreate }: Props) {
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  if (!branches) return <div className="pane-empty">Reading branches…</div>

  const needle = filter.trim().toLowerCase()
  const matching = branches.filter((b) => b.name.toLowerCase().includes(needle))
  const byTime = (a: BranchInfo, b: BranchInfo) => Number(b.current) - Number(a.current) || b.time - a.time
  const locals = matching.filter((b) => b.kind === 'local').sort(byTime)
  const remotes = matching.filter((b) => b.kind === 'remote').sort(byTime)

  const create = () => {
    if (!newName.trim() || busy) return
    onCreate(newName.trim())
    setNewName('')
  }

  return (
    <div className="branches-pane">
      <div className="pane-toolbar">
        <input
          className="hud-input"
          placeholder="Filter branches"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <span className="spacer" />
        <input
          className="hud-input"
          placeholder="New branch from HEAD"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && create()}
        />
        <button className="hud-btn" disabled={!newName.trim() || busy} onClick={create}>
          + Create
        </button>
      </div>

      <BranchGroup title="Local" branches={locals} busy={busy} onSwitch={onSwitch} />
      <BranchGroup title="Remote" branches={remotes} busy={busy} onSwitch={onSwitch} />
      {matching.length === 0 && <div className="pane-empty">No branch matches</div>}
    </div>
  )
}

function BranchGroup(props: { title: string; branches: BranchInfo[]; busy: boolean; onSwitch(b: BranchInfo): void }) {
  const { title, branches, busy, onSwitch } = props
  if (branches.length === 0) return null
  return (
    <section className="branch-group">
      <div className="section-title">
        {title} <span className="group-count">{branches.length}</span>
      </div>
      <ul className="branch-list">
        {branches.map((branch) => (
          <li key={branch.name} className={`branch-row${branch.current ? ' current' : ''}`}>
            <span className="branch-marker">{branch.current ? '◆' : ''}</span>
            <span className="branch-name" title={branch.name}>
              {branch.name}
            </span>
            <span className="branch-track">
              {branch.gone && <span className="track-gone">upstream gone</span>}
              {!!branch.ahead && <span className="track-ahead">▲{branch.ahead}</span>}
              {!!branch.behind && <span className="track-behind">▼{branch.behind}</span>}
              {branch.upstream && !branch.gone && <span className="track-upstream">⟶ {branch.upstream}</span>}
              {branch.kind === 'remote' && branch.hasLocal && <span className="track-upstream">tracked</span>}
            </span>
            <span className="branch-subject" title={branch.subject}>
              {branch.subject}
            </span>
            <span className="branch-age">{relativeTime(branch.time)}</span>
            {branch.current ? (
              <span className="branch-current">current</span>
            ) : (
              <button className="hud-btn small" disabled={busy} onClick={() => onSwitch(branch)}>
                {branch.kind === 'remote' && !branch.hasLocal ? 'Check out' : 'Switch'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
