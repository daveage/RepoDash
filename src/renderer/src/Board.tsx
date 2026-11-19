import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCodes
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Section, SectionEdit, Snapshot } from '../../shared/types'
import { pad2 } from './format'

const api = window.repodash

// Enter opens a card, so only Space picks one up for keyboard reordering.
const DRAG_KEYS: KeyboardCodes = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] }

/** Droppable ids of whole sections; card ids are repository paths. */
const DROP = 'section:'

/** Section id → its repositories, as they stand while a card is being dragged. */
type Layout = Record<string, string[]>

interface Props {
  snapshot: Snapshot
  /** The section whose name is being edited (a new section starts so). */
  renaming: string | null
  onRenaming(id: string | null): void
  renderCard(path: string, index: number): ReactNode
  renderPreview(path: string): ReactNode
  onDragging(dragging: boolean): void
  applySnapshot(snapshot: Snapshot): void
}

function containerOf(layout: Layout, id: string): string | undefined {
  if (id.startsWith(DROP)) return id.slice(DROP.length)
  return Object.keys(layout).find((section) => layout[section].includes(id))
}

export function Board({ snapshot, renaming, onRenaming, renderCard, renderPreview, onDragging, applySnapshot }: Props) {
  const base = useMemo<Layout>(
    () => Object.fromEntries(snapshot.sections.map((section) => [section.id, section.repos])),
    [snapshot]
  )
  const [dragLayout, setDragLayout] = useState<Layout | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const layout = dragLayout ?? base
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const collapsed = useMemo(() => new Set(snapshot.sections.filter((s) => s.collapsed).map((s) => s.id)), [snapshot])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: DRAG_KEYS })
  )

  // The card under the pointer; between cards, the closest card of the section under the pointer, or the
  // section itself when it is empty or collapsed. The keyboard (no pointer) moves from card to card.
  const collision: CollisionDetection = (args) => {
    const cards = args.droppableContainers.filter((container) => !String(container.id).startsWith(DROP))
    const hits = pointerWithin(args)
    if (hits.length === 0) return closestCenter({ ...args, droppableContainers: cards })
    const card = hits.find((hit) => !String(hit.id).startsWith(DROP))
    if (card) return [card]
    const section = String(hits[0].id).slice(DROP.length)
    const inSection = cards.filter((container) => layoutRef.current[section]?.includes(String(container.id)))
    if (inSection.length === 0 || collapsed.has(section)) return [hits[0]]
    return closestCenter({ ...args, droppableContainers: inSection })
  }

  const start = ({ active }: DragStartEvent) => {
    setActive(String(active.id))
    setDragLayout(base)
    onDragging(true)
  }

  // Across sections the card moves as soon as it is over another one, so that section makes room for it.
  const over = ({ active, over }: DragOverEvent) => {
    if (!over) return setTarget(null)
    const id = String(active.id)
    const current = layoutRef.current
    const from = containerOf(current, id)
    const to = containerOf(current, String(over.id))
    setTarget(to ?? null)
    if (!from || !to || from === to || collapsed.has(to)) return
    const list = current[to].filter((path) => path !== id)
    const at = list.indexOf(String(over.id))
    list.splice(at < 0 ? list.length : at, 0, id)
    setDragLayout({ ...current, [from]: current[from].filter((path) => path !== id), [to]: list })
  }

  const finish = () => {
    setActive(null)
    setTarget(null)
    onDragging(false)
  }

  const end = ({ active, over }: DragEndEvent) => {
    finish()
    const id = String(active.id)
    let next = layoutRef.current
    const from = containerOf(next, id)
    const to = over ? containerOf(next, String(over.id)) : undefined
    if (!over || !from || !to) return setDragLayout(null)
    if (from === to) {
      const list = next[to]
      const at = list.indexOf(String(over.id))
      if (at >= 0) next = { ...next, [to]: arrayMove(list, list.indexOf(id), at) }
    } else {
      // A collapsed section takes the card at its end.
      next = { ...next, [from]: next[from].filter((path) => path !== id), [to]: [...next[to], id] }
    }
    const order = snapshot.sections.flatMap((section) => next[section.id] ?? [])
    const before = snapshot.repos.find((repo) => repo.path === id)?.section
    if (to === before && order.join('\n') === snapshot.repos.map((repo) => repo.path).join('\n')) {
      return setDragLayout(null)
    }
    // The layout stays until the main process answers with the same arrangement, so nothing jumps back.
    setDragLayout(next)
    api.placeRepo(id, to, order).then(
      (result) => {
        applySnapshot(result)
        setDragLayout(null)
      },
      () => setDragLayout(null)
    )
  }

  const cancel = () => {
    finish()
    setDragLayout(null)
  }

  const edit = (change: SectionEdit) => api.editSections(change).then(applySnapshot)

  // Empty default sections stay off the board; the ones on it when a drag began stay until it ends.
  const shown = snapshot.sections.filter((section) => section.custom || base[section.id].length > 0)
  let index = 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={cancel}
    >
      <main className="board">
        {shown.map((section, position) => {
          const repos = layout[section.id] ?? []
          const first = index
          index += repos.length
          return (
            <SectionBlock
              key={section.id}
              section={section}
              repos={repos}
              first={position === 0}
              last={position === shown.length - 1}
              dropTarget={active !== null && target === section.id && containerOf(base, active) !== section.id}
              renaming={renaming === section.id}
              onRenaming={onRenaming}
              edit={edit}
            >
              {repos.map((path, offset) => renderCard(path, first + offset))}
            </SectionBlock>
          )
        })}
      </main>
      <DragOverlay>{active && renderPreview(active)}</DragOverlay>
    </DndContext>
  )
}

interface SectionProps {
  section: Section
  repos: string[]
  first: boolean
  last: boolean
  /** A dragged card would land here. */
  dropTarget: boolean
  renaming: boolean
  onRenaming(id: string | null): void
  edit(change: SectionEdit): Promise<void>
  children: ReactNode
}

function SectionBlock(props: SectionProps) {
  const { section, repos, first, last, dropTarget, renaming, onRenaming, edit, children } = props
  const { setNodeRef } = useDroppable({ id: `${DROP}${section.id}` })
  const ref = useRef<HTMLElement | null>(null)

  // A section made from the header is new at the bottom of the board: bring it into view.
  useEffect(() => {
    if (renaming) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [renaming])

  const classes = ['section', section.collapsed && 'collapsed', dropTarget && 'drop-target']
  return (
    <section
      ref={(element) => {
        ref.current = element
        setNodeRef(element)
      }}
      className={classes.filter(Boolean).join(' ')}
      aria-label={section.name}
    >
      <header className="section-head">
        <button
          className="section-toggle"
          onClick={() => edit({ kind: 'collapse', id: section.id, collapsed: !section.collapsed })}
          title={section.collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!section.collapsed}
        >
          {section.collapsed ? '▸' : '▾'}
        </button>
        {renaming ? (
          <NameInput
            name={section.name}
            onDone={(name) => {
              onRenaming(null)
              if (name !== null && name !== section.name) void edit({ kind: 'rename', id: section.id, name })
            }}
          />
        ) : (
          <button className="section-name" onClick={() => onRenaming(section.id)} title="Rename">
            {section.name}
          </button>
        )}
        <span className="section-count">{pad2(repos.length)}</span>
        {section.path && (
          <span className="section-path" title={section.path}>
            {section.path}
          </span>
        )}
        <span className="section-rule" />
        <span className="section-tools">
          <button className="icon-btn" disabled={first} onClick={() => edit({ kind: 'move', id: section.id, by: -1 })} title="Move up">
            ▲
          </button>
          <button className="icon-btn" disabled={last} onClick={() => edit({ kind: 'move', id: section.id, by: 1 })} title="Move down">
            ▼
          </button>
          {section.custom && (
            <button
              className="icon-btn section-delete"
              onClick={() => edit({ kind: 'delete', id: section.id })}
              title="Delete the section; its repositories go back to their folder's section"
            >
              ×
            </button>
          )}
        </span>
      </header>

      {!section.collapsed && section.suggestions.length > 0 && <Suggestions section={section} edit={edit} />}

      {!section.collapsed && (
        <SortableContext items={repos} strategy={rectSortingStrategy}>
          <div className="grid">
            {children}
            {repos.length === 0 && <div className="section-empty">Drag repositories here</div>}
          </div>
        </SortableContext>
      )}
    </section>
  )
}

/** Subfolders of a scan folder with two or more repositories, offered as sections of their own. */
function Suggestions({ section, edit }: { section: Section; edit(change: SectionEdit): Promise<void> }) {
  const { suggestions } = section
  // Created in reverse, each right after this section, so they end up in the listed order.
  const createAll = async () => {
    for (const suggestion of [...suggestions].reverse()) {
      await edit({ kind: 'create', name: suggestion.name, after: section.id, repos: suggestion.repos })
    }
  }
  return (
    <div className="section-suggest">
      <span className="suggest-label">Group by folder</span>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.path}
          className="hud-btn small suggest-chip"
          title={`New section ${suggestion.name} with the ${suggestion.repos.length} repositories in ${suggestion.path}`}
          onClick={() => edit({ kind: 'create', name: suggestion.name, after: section.id, repos: suggestion.repos })}
        >
          + {suggestion.name} <span className="suggest-count">{suggestion.repos.length}</span>
        </button>
      ))}
      {suggestions.length > 1 && (
        <button className="hud-btn small" onClick={createAll}>
          All {suggestions.length}
        </button>
      )}
      <button
        className="icon-btn"
        title="Dismiss these suggestions"
        onClick={() => edit({ kind: 'dismiss', id: section.id, paths: suggestions.map((s) => s.path) })}
      >
        ×
      </button>
    </div>
  )
}

/** Enter or leaving the field saves, Escape keeps the old name. */
function NameInput({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(name)
  const done = useRef(false)
  const finish = (result: string | null) => {
    if (done.current) return
    done.current = true
    onDone(result)
  }
  return (
    <input
      className="hud-input section-input"
      value={value}
      maxLength={60}
      autoFocus
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value.trim() || null)
        if (event.key === 'Escape') {
          event.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}
