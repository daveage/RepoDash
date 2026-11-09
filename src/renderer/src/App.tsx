import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AddResult, RepoResult, Snapshot } from '../../shared/types'
import { CardConfig } from './CardConfig'
import { isDirty, isOutOfSync, pad2 } from './format'
import { RepoCard } from './RepoCard'
import { SourcesPanel } from './SourcesPanel'

const api = window.repodash

/** A refresh faster than this never shows the busy scan line, so watcher refreshes do not flicker. */
const BUSY_DELAY_MS = 250

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [results, setResults] = useState<Record<string, RepoResult>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)

  // Callbacks read these so they never act on a stale render.
  const snapshotRef = useRef<Snapshot | null>(null)
  const inFlight = useRef(new Set<string>())
  const again = useRef(new Set<string>())
  const requested = useRef(new Set<string>())

  const applySnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  const apply = useCallback((update: Promise<Snapshot>) => void update.then(applySnapshot), [applySnapshot])

  const refresh = useCallback(async (path: string) => {
    // A change while git is already reading this repository is picked up by one more read afterwards.
    if (inFlight.current.has(path)) {
      again.current.add(path)
      return
    }
    inFlight.current.add(path)
    const showBusy = setTimeout(() => setBusy((current) => new Set(current).add(path)), BUSY_DELAY_MS)
    try {
      do {
        again.current.delete(path)
        const result = await api.getStatus(path)
        setResults((current) => ({ ...current, [path]: result }))
      } while (again.current.has(path))
    } finally {
      clearTimeout(showBusy)
      inFlight.current.delete(path)
      setBusy((current) => {
        if (!current.has(path)) return current
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }, [])

  const refreshAll = useCallback(() => snapshotRef.current?.repos.forEach((repo) => refresh(repo.path)), [refresh])

  useEffect(() => {
    api.getSnapshot().then(applySnapshot)
    const offSnapshot = api.onSnapshot(applySnapshot)
    const offChanged = api.onRepoChanged((path) => void refresh(path))
    window.addEventListener('focus', refreshAll)
    return () => {
      offSnapshot()
      offChanged()
      window.removeEventListener('focus', refreshAll)
    }
  }, [applySnapshot, refresh, refreshAll])

  // Read the status of repositories that just appeared; forget the ones that left.
  useEffect(() => {
    if (!snapshot) return
    const present = new Set(snapshot.repos.map((repo) => repo.path))
    for (const path of requested.current) if (!present.has(path)) requested.current.delete(path)
    for (const path of present) {
      if (requested.current.has(path)) continue
      requested.current.add(path)
      void refresh(path)
    }
  }, [snapshot, refresh])

  const handleAdd = useCallback(
    async (add: () => Promise<AddResult>) => {
      const result = await add()
      if (!result) return
      if ('error' in result) setNotice(result.error)
      else {
        setNotice(null)
        applySnapshot(result.snapshot)
      }
    },
    [applySnapshot]
  )
  const addRepo = useCallback(() => handleAdd(api.addRepository), [handleAdd])
  const addFolder = useCallback(() => handleAdd(api.addScanFolder), [handleAdd])
  const closeConfig = useCallback(() => setConfiguring(null), [])
  const closeSources = useCallback(() => setShowSources(false), [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const current = snapshotRef.current
      if (!current || !over || active.id === over.id) return
      const paths = current.repos.map((repo) => repo.path)
      const order = arrayMove(paths, paths.indexOf(String(active.id)), paths.indexOf(String(over.id)))
      // Move the cards now; the main process confirms with the same order.
      const byPath = new Map(current.repos.map((repo) => [repo.path, repo]))
      applySnapshot({ ...current, repos: order.map((path) => byPath.get(path)!) })
      apply(api.setOrder(order))
    },
    [apply, applySnapshot]
  )

  if (!snapshot) return <div className="app" />

  const paths = snapshot.repos.map((repo) => repo.path)
  const statuses = paths.flatMap((path) => {
    const result = results[path]
    return result?.ok ? [result.status] : []
  })
  const folderIds = new Set(snapshot.sources.filter((s) => s.kind === 'folder').map((s) => s.id))

  return (
    <div className="app">
      <header className="hud-top">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">RepoDash</span>
          <span className="brand-sub">{snapshot.scanning ? 'Scanning sources…' : 'Repository telemetry'}</span>
        </div>
        <div className="telemetry">
          <Stat label="Linked" value={paths.length} />
          <Stat label="Dirty" value={statuses.filter(isDirty).length} warn />
          <Stat label="Out of sync" value={statuses.filter(isOutOfSync).length} warn />
        </div>
        <div className="hud-actions">
          <button className="hud-btn" onClick={addRepo}>
            + Repository
          </button>
          <button className="hud-btn" onClick={addFolder}>
            + Scan folder
          </button>
          <button className="hud-btn" onClick={() => setShowSources(true)}>
            Sources
          </button>
          <button className="hud-btn" onClick={refreshAll} disabled={paths.length === 0}>
            Refresh
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {paths.length === 0 ? (
        <div className="empty">
          <div className="empty-reticle" />
          <div className="empty-title">{snapshot.scanning ? 'Scanning…' : 'No repositories linked'}</div>
          <div className="empty-actions">
            <button className="hud-btn" onClick={addRepo}>
              + Repository
            </button>
            <button className="hud-btn" onClick={addFolder}>
              + Scan folder
            </button>
          </div>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={paths} strategy={rectSortingStrategy}>
            <main className="grid">
              {snapshot.repos.map(({ path, sourceId }) => (
                <RepoCard
                  key={path}
                  path={path}
                  result={results[path]}
                  meta={snapshot.meta[path]}
                  busy={busy.has(path)}
                  onRefresh={() => refresh(path)}
                  onConfigure={() => setConfiguring(path)}
                  overlay={
                    configuring === path && (
                      <CardConfig
                        path={path}
                        meta={snapshot.meta[path]}
                        scanned={folderIds.has(sourceId)}
                        onSave={(meta) => apply(api.setMeta(path, meta))}
                        onRemove={() => {
                          setConfiguring(null)
                          apply(api.removeRepo(path))
                        }}
                        onClose={closeConfig}
                      />
                    )
                  }
                />
              ))}
            </main>
          </SortableContext>
        </DndContext>
      )}

      {showSources && (
        <SourcesPanel
          snapshot={snapshot}
          onAddFolder={addFolder}
          onAddRepo={addRepo}
          onClose={closeSources}
          apply={apply}
        />
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`stat${warn && value > 0 ? ' warn' : ''}`}>
      <div className="stat-value">{pad2(value)}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
