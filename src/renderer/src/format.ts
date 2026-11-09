import type { RepoStatus } from '../../shared/types'

export type Tone = 'ok' | 'info' | 'warn' | 'alert' | 'idle'

/** The one word a card leads with; the counts on the card tell the rest. */
export function summarize(s: RepoStatus): { label: string; tone: Tone } {
  if (s.operation) return { label: `${s.operation} in progress`, tone: 'alert' }
  if (s.conflicted > 0) return { label: 'conflict', tone: 'alert' }
  if (!s.branch) return { label: 'detached', tone: 'warn' }
  if (s.ahead > 0 && s.behind > 0) return { label: 'diverged', tone: 'warn' }
  if (s.behind > 0) return { label: 'behind', tone: 'warn' }
  if (s.staged + s.modified + s.untracked > 0) return { label: 'uncommitted', tone: 'warn' }
  if (s.ahead > 0) return { label: 'ahead', tone: 'info' }
  if (!s.upstream) return { label: 'no upstream', tone: 'idle' }
  return { label: 'synced', tone: 'ok' }
}

export function isDirty(s: RepoStatus): boolean {
  return s.staged + s.modified + s.untracked + s.conflicted > 0
}

export function isOutOfSync(s: RepoStatus): boolean {
  return s.ahead > 0 || s.behind > 0
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function relativeTime(time: number, now = Date.now()): string {
  const minutes = Math.round((now - time) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days}d`
  return `${Math.round(days / 30)}mo`
}

/** Accent colours offered for cards; all of them read on the dark HUD background. */
export const ACCENTS = [
  '#8fe6f2',
  '#4fd1c5',
  '#7cf2b0',
  '#c6f26b',
  '#f2b45c',
  '#ff7a59',
  '#ff8fb1',
  '#b8a6ff',
  '#6fa8ff',
  '#e8eef0'
]

/** A repository without a chosen colour gets a stable one from its name. */
export function defaultAccent(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ACCENTS[hash % ACCENTS.length]
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}
