/** Keys typed into a field belong to the field, not to shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Shortcut keys ignore modifier chords, so Ctrl+C and friends keep working. */
export function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
}

export type ActionKey = 'fetch' | 'pull' | 'push'

/** F fetch, P pull, Shift+P push. */
export function actionForKey(event: KeyboardEvent): ActionKey | null {
  if (event.key === 'f' || event.key === 'F') return 'fetch'
  if (event.key === 'p') return 'pull'
  if (event.key === 'P') return 'push'
  return null
}

/**
 * Runs an action the same way its button does, so a shortcut gets the same checks and prompts
 * (disabled while busy, the rebase-or-merge question on a diverged pull).
 */
export function clickAction(root: Element | null, action: ActionKey): void {
  root?.querySelector<HTMLButtonElement>(`[data-action="${action}"]:not(:disabled)`)?.click()
}

export function dialogOpen(): boolean {
  return document.querySelector('.dialog') !== null
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '← ↑ → ↓', action: 'Move between cards' },
  { keys: 'Enter', action: 'Open history' },
  { keys: 'C / B / L', action: 'Open changes / branches / console' },
  { keys: 'F', action: 'Fetch' },
  { keys: 'P', action: 'Pull' },
  { keys: 'Shift+P', action: 'Push' },
  { keys: 'R / Shift+R', action: 'Refresh card / all' },
  { keys: 'Space on card header', action: 'Pick up card; arrows move it, Space drops it' },
  { keys: '1 – 4', action: 'Panel tabs' },
  { keys: 'Esc', action: 'Close panel or dialog' },
  { keys: '?', action: 'This list' }
]
