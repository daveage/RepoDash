import { useState, type KeyboardEvent, type PointerEvent } from 'react'

const STORAGE_KEY = 'repodash.detailWidth'
/** Narrower than this and the file lists squeeze the diff out. */
const MIN_WIDTH = 640
/** The dashboard keeps this much on the left, so a click there still closes the panel. */
const KEEP_LEFT = 48
const KEY_STEP = 40

function readWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return value >= MIN_WIDTH ? value : null
  } catch {
    return null
  }
}

function saveWidth(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(Math.round(width)))
  } catch {
    // Without storage the width lasts until the panel closes.
  }
}

const clamp = (width: number) => Math.max(MIN_WIDTH, Math.min(width, window.innerWidth - KEEP_LEFT))

/**
 * The detail panel's width, remembered across panels and restarts; `null` is the default from detail.css.
 * The panel is anchored right, so its width is the distance from the pointer to the window's right edge.
 */
export function usePanelWidth() {
  const [width, setWidth] = useState(readWidth)
  const change = (next: number | null) => {
    setWidth(next)
    saveWidth(next)
  }
  // A window made smaller than the stored width keeps the dashboard edge visible.
  const style = width === null ? undefined : { width: `min(${width}px, calc(100vw - ${KEEP_LEFT}px))` }
  return { width, change, style }
}

interface Props {
  width: number | null
  onChange(width: number | null): void
}

/** The panel's left edge: drag to resize, double-click for the default width, arrows from the keyboard. */
export function PanelResize({ width, onChange }: Props) {
  const current = (handle: HTMLElement) => width ?? handle.parentElement!.getBoundingClientRect().width

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // No text selection while dragging; the capture keeps the moves coming wherever the pointer goes.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onChange(clamp(window.innerWidth - event.clientX))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[event.key]
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    onChange(clamp(current(event.currentTarget) + step))
  }

  return (
    <div
      className="panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      tabIndex={0}
      title="Drag to resize · double-click for the default width"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={() => onChange(null)}
      onKeyDown={onKeyDown}
    />
  )
}
