import type { ConsoleEntry } from './operations'
import { terminalText } from './operations'

interface Props {
  entries: ConsoleEntry[]
  onCancel(id: string): void
}

export function ConsoleView({ entries, onCancel }: Props) {
  if (entries.length === 0) return <div className="pane-empty">No operations yet</div>
  return (
    <div className="console-pane">
      {[...entries].reverse().map((entry) => (
        <section key={entry.id} className={`console-entry state-${entry.state}`}>
          <header className="console-head">
            <span className="console-state">{entry.state === 'running' ? 'running' : entry.state === 'ok' ? 'done' : 'failed'}</span>
            <span className="console-label">{entry.label}</span>
            <span className="console-time">
              {new Date(entry.startedAt).toLocaleTimeString()}
              {entry.endedAt && ` · ${((entry.endedAt - entry.startedAt) / 1000).toFixed(1)} s`}
            </span>
            {entry.state === 'running' && (
              <button className="hud-btn small danger" onClick={() => onCancel(entry.id)}>
                Cancel
              </button>
            )}
          </header>
          <pre className="console-text">{terminalText(entry.text) || ' '}</pre>
        </section>
      ))}
    </div>
  )
}
