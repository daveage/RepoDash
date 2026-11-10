import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface Choice {
  label: string
  tone?: 'primary' | 'danger'
  onChoose(): void
}

interface Props {
  title: string
  children: ReactNode
  choices: Choice[]
  cancelLabel?: string
  onCancel(): void
}

export function ConfirmDialog({ title, children, choices, cancelLabel = 'Cancel', onCancel }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    // Capture, so Escape closes the dialog and not the panel underneath.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  // Enter confirms the focused button: for a destructive choice that is Cancel, not the choice.
  const safeFocus = choices.length === 0 || choices[choices.length - 1].tone === 'danger'

  // Rendered into <body>, so a dialog opened from a card is not clipped or dragged along with it.
  return createPortal(
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button className="hud-btn" onClick={onCancel} autoFocus={safeFocus}>
            {cancelLabel}
          </button>
          {choices.map((choice, index) => (
            <button
              key={choice.label}
              className={`hud-btn${choice.tone ? ` ${choice.tone}` : ''}`}
              autoFocus={!safeFocus && index === choices.length - 1}
              onClick={choice.onChoose}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
