import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCodes
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AddResult, Operation, RepoResult, Snapshot } from '../../shared/types'
import { Boot, prefersReducedMotion } from './Boot'
import { CardConfig } from './CardConfig'
import { baseName, defaultAccent, isDirty, isOutOfSync, pad2 } from './format'
import { useOperations } from './operations'
import { actionForKey, clickAction, dialogOpen, hasModifier, isTypingTarget } from './keys'
import { RepoCard } from './RepoCard'
import { RepoDetail, type DetailTab } from './RepoDetail'
import { Shortcuts } from './Shortcuts'
import { SourcesPanel } from './SourcesPanel'

const api = window.repodash

/** A refresh faster than this never shows the busy scan line, so watcher refreshes do not flicker. */
const BUSY_DELAY_MS = 250

// Enter opens a card, so only Space picks one up for keyboard reordering.
const DRAG_KEYS: KeyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [results, setResults] = useState<Record<string, RepoResult>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)
  const [detail, setDetail] = useState<{ path: string; tab: DetailTab } | null>(null)
  const [booting, setBooting] = useState(() => !prefersReducedMotion())
  const [showHelp, setShowHelp] = useState(false)
  const operations = useOperations()
  const dragging = useRef(false)

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
  const closeDetail = useCallback(() => setDetail(null), [])

  const { run: runOperation } = operations
  const run = useCallback(
    async (path: string, op: Operation, label: string) => {
      const result = await runOperation(path, op, label)
      // Failures are explained in the console; take the user there when the panel is open.
      if (!result.ok) setDetail((current) => (current?.path === path ? { ...current, tab: 'console' } : current))
      return result.ok
    },
    [runOperation]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: DRAG_KEYS })
  )

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      dragging.current = false
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

  const endBoot = useCallback(() => setBooting(false), [])

  // Grid keys; the panel and dialogs handle their own while open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = snapshotRef.current
      if (!current || detail || showSources || configuring || dragging.current || dialogOpen()) return
      if (isTypingTarget(event.target) || hasModifier(event)) return
      if (event.key === '?') return setShowHelp(true)
      if (event.key === 'R') return refreshAll()

      const cards = [...document.querySelectorAll<HTMLElement>('.grid .card')]
      if (cards.length === 0) return
      const index = cards.findIndex((card) => card.contains(document.activeElement))
      const columns = cards.filter((card) => card.offsetTop === cards[0].offsetTop).length
      const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }
      if (event.key in steps || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const target =
          event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : index < 0 ? 0 : index + steps[event.key]
        cards[Math.max(0, Math.min(cards.length - 1, target))].focus()
        return
      }
      if (index < 0) return
      // Cards render in the snapshot's order.
      const path = current.repos[index]?.path
      if (!path) return
      const tabs: Record<string, DetailTab> = { Enter: 'history', c: 'changes', b: 'branches', l: 'console' }
      if (event.key in tabs) {
        event.preventDefault()
        return setDetail({ path, tab: tabs[event.key] })
      }
      if (event.key === 'r') return void refresh(path)
      const action = actionForKey(event)
      if (action) {
        event.preventDefault()
        clickAction(cards[index], action)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, showSources, configuring, refresh, refreshAll])

  if (!snapshot) return <div className="app" />

  const paths = snapshot.repos.map((repo) => repo.path)
  const statuses = paths.flatMap((path) => {
    const result = results[path]
    return result?.ok ? [result.status] : []
  })
  const folderIds = new Set(snapshot.sources.filter((s) => s.kind === 'folder').map((s) => s.id))

  return (
    <div className={booting ? 'app' : 'app booted'}>
      {booting && <Boot repoCount={snapshot.repos.length} scanning={snapshot.scanning} onDone={endBoot} />}
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
          <button className="hud-btn" onClick={() => setShowHelp(true)} title="Keyboard shortcuts">
            ?
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => (dragging.current = true)}
          onDragCancel={() => (dragging.current = false)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={paths} strategy={rectSortingStrategy}>
            <main className="grid">
              {snapshot.repos.map(({ path, sourceId }, index) => (
                <RepoCard
                  key={path}
                  path={path}
                  index={index}
                  result={results[path]}
                  meta={snapshot.meta[path]}
                  busy={busy.has(path)}
                  opBusy={operations.isRunning(path)}
                  lastOp={operations.entries.findLast((entry) => entry.path === path)}
                  run={(op, label) => run(path, op, label)}
                  onOpen={(tab) => setDetail({ path, tab })}
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

      {detail && snapshot.repos.some((repo) => repo.path === detail.path) && (
        <RepoDetail
          key={detail.path}
          path={detail.path}
          name={snapshot.meta[detail.path]?.alias ?? baseName(detail.path)}
          accent={snapshot.meta[detail.path]?.color ?? defaultAccent(baseName(detail.path))}
          status={(() => {
            const result = results[detail.path]
            return result?.ok ? result.status : undefined
          })()}
          tab={detail.tab}
          entries={operations.entries.filter((entry) => entry.path === detail.path)}
          busy={operations.isRunning(detail.path)}
          onTab={(tab) => setDetail({ path: detail.path, tab })}
          run={(op, label) => run(detail.path, op, label)}
          onCancel={operations.cancel}
          onClose={closeDetail}
        />
      )}

      {showHelp && <Shortcuts onClose={() => setShowHelp(false)} />}

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
