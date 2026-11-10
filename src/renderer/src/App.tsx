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
import type { AddResult, Notice, Operation, RepoResult, Snapshot, UiCommand } from '../../shared/types'
import { Boot, prefersReducedMotion } from './Boot'
import { CardConfig } from './CardConfig'
import { baseName, canPullClean, defaultAccent, isDirty, isOutOfSync, pad2 } from './format'
import { useOperations } from './operations'
import { actionForKey, clickAction, dialogOpen, hasModifier, isTypingTarget } from './keys'
import { RepoCard } from './RepoCard'
import { RepoDetail, type DetailTab } from './RepoDetail'
import { SettingsPanel } from './SettingsPanel'
import { Shortcuts } from './Shortcuts'

const api = window.repodash

/** A refresh faster than this never shows the busy scan line, so watcher refreshes do not flicker. */
const BUSY_DELAY_MS = 250
/** Fetch all / pull clean run this many repositories at once. */
const BULK_PARALLEL = 4
/** New remote commits found within this window (one background fetch round) make one notification. */
const NEWS_DELAY_MS = 2000
const OK_NOTICE_MS = 8000

// Enter opens a card, so only Space picks one up for keyboard reordering.
const DRAG_KEYS: KeyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }

interface Bulk {
  label: string
  done: number
  total: number
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [results, setResults] = useState<Record<string, RepoResult>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [detail, setDetail] = useState<{ path: string; tab: DetailTab } | null>(null)
  const [booting, setBooting] = useState(() => !prefersReducedMotion())
  const [showHelp, setShowHelp] = useState(false)
  const [bulk, setBulk] = useState<Bulk | null>(null)
  const operations = useOperations()
  const dragging = useRef(false)

  // Callbacks read these so they never act on a stale render.
  const snapshotRef = useRef<Snapshot | null>(null)
  const resultsRef = useRef<Record<string, RepoResult>>({})
  const operationsRef = useRef(operations)
  operationsRef.current = operations
  const inFlight = useRef(new Set<string>())
  const again = useRef(new Set<string>())
  const requested = useRef(new Set<string>())
  const news = useRef(new Map<string, { count: number; upstream: string }>())
  const newsTimer = useRef<number | null>(null)
  const bulkRunning = useRef(false)

  const applySnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next
    setSnapshot(next)
  }, [])

  const apply = useCallback((update: Promise<Snapshot>) => void update.then(applySnapshot), [applySnapshot])

  const nameOf = useCallback((path: string) => snapshotRef.current?.meta[path]?.alias ?? baseName(path), [])

  /** Desktop notifications only matter while the user looks elsewhere; the cards tell the rest. */
  const notifyAway = useCallback((notice: Notice) => {
    if (snapshotRef.current?.settings.notifications && !document.hasFocus()) api.notify(notice)
  }, [])

  const flushNews = useCallback(() => {
    newsTimer.current = null
    const items = [...news.current]
    news.current.clear()
    if (items.length === 0) return
    const lines = items.map(
      ([path, { count, upstream }]) => `${nameOf(path)}: ${plural(count, 'new commit', 'new commits')} on ${upstream}`
    )
    notifyAway({
      title: items.length === 1 ? 'New remote commits' : `New remote commits in ${items.length} repositories`,
      body: lines.join('\n'),
      path: items.length === 1 ? items[0][0] : undefined
    })
  }, [nameOf, notifyAway])

  /** Remembers commits that arrived on the upstream (a fetch made the branch fall further behind). */
  const noteNews = useCallback(
    (path: string, previous: RepoResult | undefined, next: RepoResult) => {
      if (!previous?.ok || !next.ok) return
      const before = previous.status
      const after = next.status
      if (!after.upstream || after.branch !== before.branch || after.upstream !== before.upstream) return
      if (after.behind <= before.behind) return
      const count = (news.current.get(path)?.count ?? 0) + after.behind - before.behind
      news.current.set(path, { count, upstream: after.upstream })
      newsTimer.current ??= window.setTimeout(flushNews, NEWS_DELAY_MS)
    },
    [flushNews]
  )

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
        const previous = resultsRef.current[path]
        resultsRef.current = { ...resultsRef.current, [path]: result }
        setResults(resultsRef.current)
        noteNews(path, previous, result)
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
  }, [noteNews])

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
      if ('error' in result) setNotice({ text: result.error, tone: 'warn' })
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
  const closeSettings = useCallback(() => setShowSettings(false), [])
  const closeDetail = useCallback(() => setDetail(null), [])

  const { run: runOperation } = operations
  const run = useCallback(
    async (path: string, op: Operation, label: string) => {
      const result = await runOperation(path, op, label)
      // Failures are explained in the console; take the user there when the panel is open.
      if (!result.ok) setDetail((current) => (current?.path === path ? { ...current, tab: 'console' } : current))
      notifyAway({
        title: `${label} ${result.ok ? 'finished' : 'failed'}`,
        body: result.ok ? nameOf(path) : `${nameOf(path)}: ${result.error ?? 'git failed'}`,
        path
      })
      return result.ok
    },
    [runOperation, nameOf, notifyAway]
  )

  /** Runs one operation in many repositories, a few at a time, and reports once at the end. */
  const runBulk = useCallback(
    async (label: string, verb: string, paths: string[], op: Operation) => {
      if (bulkRunning.current) return
      if (paths.length === 0) return setNotice({ text: `${label}: nothing to do`, tone: 'ok' })
      bulkRunning.current = true
      const queue = [...paths]
      const failed: string[] = []
      let done = 0
      setBulk({ label, done, total: paths.length })
      const worker = async () => {
        for (let path = queue.shift(); path; path = queue.shift()) {
          const result = await runOperation(path, op, label)
          if (!result.ok) failed.push(`${nameOf(path)} (${(result.error ?? 'git failed').split('\n')[0]})`)
          setBulk({ label, done: ++done, total: paths.length })
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, paths.length) }, worker))
      } finally {
        bulkRunning.current = false
        setBulk(null)
      }
      const ok = paths.length - failed.length
      const text =
        failed.length === 0
          ? `${verb} ${plural(ok, 'repository', 'repositories')}`
          : `${verb} ${ok} of ${paths.length} · failed: ${failed.join(', ')}`
      setNotice({ text, tone: failed.length ? 'warn' : 'ok' })
      notifyAway({ title: `${label} finished`, body: text })
    },
    [runOperation, nameOf, notifyAway]
  )

  /** Repositories an operation can start in now; one already running keeps its operation. */
  const idlePaths = useCallback(
    () => (snapshotRef.current?.repos ?? []).map((repo) => repo.path).filter((path) => !operationsRef.current.isRunning(path)),
    []
  )
  const pullablePaths = useCallback(
    () =>
      idlePaths().filter((path) => {
        const result = resultsRef.current[path]
        return result?.ok && canPullClean(result.status)
      }),
    [idlePaths]
  )
  const fetchAll = useCallback(() => runBulk('Fetch all', 'Fetched', idlePaths(), { kind: 'fetch' }), [runBulk, idlePaths])
  const pullClean = useCallback(
    () => runBulk('Pull clean', 'Pulled', pullablePaths(), { kind: 'pull' }),
    [runBulk, pullablePaths]
  )

  // Tray menu and notification clicks.
  const onCommand = useRef<(command: UiCommand) => void>(() => {})
  onCommand.current = (command) => {
    if (command.kind === 'fetch-all') return void fetchAll()
    if (command.kind === 'pull-clean') return void pullClean()
    if (snapshotRef.current?.repos.some((repo) => repo.path === command.path)) {
      setShowSettings(false)
      setConfiguring(null)
      setDetail({ path: command.path, tab: 'history' })
    }
  }
  useEffect(() => api.onCommand((command) => onCommand.current(command)), [])

  // Success notices step aside on their own; warnings wait to be read.
  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const timer = setTimeout(() => setNotice(null), OK_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

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
      if (!current || detail || showSettings || configuring || dragging.current || dialogOpen()) return
      if (isTypingTarget(event.target) || hasModifier(event)) return
      if (event.key === '?') return setShowHelp(true)
      if (event.key === 'R') return refreshAll()
      if (event.key === 'F') return void fetchAll()
      if (event.key === 'U') return void pullClean()

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
  }, [detail, showSettings, configuring, refresh, refreshAll, fetchAll, pullClean])

  const paths = snapshot?.repos.map((repo) => repo.path) ?? []
  const statuses = paths.flatMap((path) => {
    const result = results[path]
    return result?.ok ? [result.status] : []
  })
  const dirty = statuses.filter(isDirty).length
  const outOfSync = statuses.filter(isOutOfSync).length
  const pullable = statuses.filter((status) => canPullClean(status) && !operations.isRunning(status.path)).length

  // The tray icon and the taskbar / dock badge.
  useEffect(() => api.setSummary({ dirty, outOfSync, pullable }), [dirty, outOfSync, pullable])

  if (!snapshot) return <div className="app" />

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
          <Stat label="Dirty" value={dirty} warn />
          <Stat label="Out of sync" value={outOfSync} warn />
        </div>
        <div className="hud-actions">
          <button
            className="hud-btn"
            onClick={fetchAll}
            disabled={paths.length === 0 || bulk !== null}
            title="Fetch every repository (Shift+F)"
          >
            {bulk?.label === 'Fetch all' ? `Fetching ${bulk.done}/${bulk.total}` : 'Fetch all'}
          </button>
          <button
            className={`hud-btn${pullable > 0 ? ' attention' : ''}`}
            onClick={pullClean}
            disabled={pullable === 0 || bulk !== null}
            title="Fast-forward every repository without local changes or commits that is behind (Shift+U)"
          >
            {bulk?.label === 'Pull clean' ? `Pulling ${bulk.done}/${bulk.total}` : `Pull clean${pullable ? ` ▼${pad2(pullable)}` : ''}`}
          </button>
          <button className="hud-btn" onClick={() => setShowSettings(true)}>
            Settings
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
        <div className={`notice tone-${notice.tone}`} onClick={() => setNotice(null)}>
          {notice.text}
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

      {showSettings && (
        <SettingsPanel
          snapshot={snapshot}
          onAddFolder={addFolder}
          onAddRepo={addRepo}
          onClose={closeSettings}
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
