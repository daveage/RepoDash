import { useCallback, useEffect, useState } from 'react'
import type { Operation, OpResult } from '../../shared/types'

export interface ConsoleEntry {
  id: string
  path: string
  label: string
  text: string
  state: 'running' | 'ok' | 'error'
  error?: string
  startedAt: number
  endedAt?: number
}

const MAX_ENTRIES = 200
/** Progress output of a long fetch can be large; the tail is what matters. */
const MAX_TEXT = 100_000

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export interface Operations {
  entries: ConsoleEntry[]
  run(path: string, op: Operation, label: string): Promise<OpResult>
  cancel(id: string): void
  isRunning(path: string): boolean
}

export function useOperations(): Operations {
  const [entries, setEntries] = useState<ConsoleEntry[]>([])

  useEffect(
    () =>
      window.repodash.onOpOutput(({ opId, text }) =>
        setEntries((current) =>
          current.map((entry) => (entry.id === opId ? { ...entry, text: (entry.text + text).slice(-MAX_TEXT) } : entry))
        )
      ),
    []
  )

  const run = useCallback(async (path: string, op: Operation, label: string) => {
    const id = crypto.randomUUID()
    const entry: ConsoleEntry = { id, path, label, text: '', state: 'running', startedAt: Date.now() }
    setEntries((current) => [...current.slice(-(MAX_ENTRIES - 1)), entry])
    let result: OpResult
    try {
      result = await window.repodash.runOperation(path, op, id)
    } catch (error) {
      result = { ok: false, error: errorMessage(error) }
    }
    setEntries((current) =>
      current.map((e) =>
        e.id === id ? { ...e, state: result.ok ? 'ok' : 'error', error: result.error, endedAt: Date.now() } : e
      )
    )
    return result
  }, [])

  const cancel = useCallback((id: string) => void window.repodash.cancelOperation(id), [])

  const isRunning = useCallback(
    (path: string) => entries.some((entry) => entry.path === path && entry.state === 'running'),
    [entries]
  )

  return { entries, run, cancel, isRunning }
}

/** Applies carriage returns the way a terminal does, so git's progress lines overwrite themselves. */
export function terminalText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      return trimmed.slice(trimmed.lastIndexOf('\r') + 1)
    })
    .join('\n')
}
