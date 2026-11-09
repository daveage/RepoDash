import { useEffect } from 'react'
import type { Snapshot } from '../../shared/types'
import { pad2 } from './format'

interface Props {
  snapshot: Snapshot
  onAddFolder(): void
  onAddRepo(): void
  onClose(): void
  apply(update: Promise<Snapshot>): void
}

const DEPTHS = [0, 1, 2, 3, 4, 5, 6]

export function SourcesPanel({ snapshot, onAddFolder, onAddRepo, onClose, apply }: Props) {
  const api = window.repodash
  const folders = snapshot.sources.filter((s) => s.kind === 'folder')
  const repos = snapshot.sources.filter((s) => s.kind === 'repo')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <span className="drawer-title">Sources</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </header>

        <section className="drawer-section">
          <div className="section-head">
            <span className="section-title">Scan folders</span>
            <button className="hud-btn small" onClick={() => apply(api.rescan())} disabled={folders.length === 0}>
              {snapshot.scanning ? 'Scanning…' : 'Rescan'}
            </button>
            <button className="hud-btn small" onClick={onAddFolder}>
              + Add
            </button>
          </div>
          {folders.length === 0 && <p className="drawer-empty">Folders searched for repositories.</p>}
          {folders.map((source) => (
            <div className="source-row" key={source.id}>
              <div className="source-path" title={source.path}>
                {source.path}
              </div>
              <span className="source-count" title="Repositories found">
                {pad2(snapshot.repos.filter((repo) => repo.sourceId === source.id).length)}
              </span>
              <label className="source-depth" title="Levels searched below the folder">
                Depth
                <select
                  className="hud-select"
                  value={source.depth ?? 3}
                  onChange={(event) => apply(api.setFolderDepth(source.id, Number(event.target.value)))}
                >
                  {DEPTHS.map((depth) => (
                    <option key={depth} value={depth}>
                      {depth}
                    </option>
                  ))}
                </select>
              </label>
              <button className="icon-btn" onClick={() => apply(api.removeSource(source.id))} title="Remove folder">
                ×
              </button>
            </div>
          ))}
        </section>

        <section className="drawer-section">
          <div className="section-head">
            <span className="section-title">Repositories</span>
            <button className="hud-btn small" onClick={onAddRepo}>
              + Add
            </button>
          </div>
          {repos.length === 0 && <p className="drawer-empty">Repositories added one by one.</p>}
          {repos.map((source) => (
            <div className="source-row" key={source.id}>
              <div className="source-path" title={source.path}>
                {source.path}
              </div>
              <button className="icon-btn" onClick={() => apply(api.removeSource(source.id))} title="Remove">
                ×
              </button>
            </div>
          ))}
        </section>

        {snapshot.hidden.length > 0 && (
          <section className="drawer-section">
            <div className="section-head">
              <span className="section-title">Hidden</span>
            </div>
            {snapshot.hidden.map((path) => (
              <div className="source-row" key={path}>
                <div className="source-path" title={path}>
                  {path}
                </div>
                <button className="hud-btn small" onClick={() => apply(api.restoreRepo(path))}>
                  Restore
                </button>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  )
}
