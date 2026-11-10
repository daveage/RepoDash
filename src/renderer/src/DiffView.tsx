import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Diff, DiffTarget } from '../../shared/types'
import { parseDiff, type DiffFile } from './diff'
import { errorMessage } from './operations'

interface Props {
  diff: Diff | null
  error?: string | null
  /** Shown above the diff while it loads and after; a file path or a commit. */
  title?: ReactNode
  /** Shown when git's diff is empty. */
  empty?: ReactNode
}

interface Loaded {
  key: string
  diff: Diff | null
  error: string | null
}

/**
 * Reads the diff of `target`, again whenever `stamp` changes. While it re-reads the same target the
 * previous diff stays on screen; a different target starts empty.
 */
export function useDiff(path: string, target: DiffTarget | null, stamp?: number): Omit<Loaded, 'key'> {
  const key = target ? JSON.stringify(target) : ''
  const [loaded, setLoaded] = useState<Loaded>({ key: '', diff: null, error: null })
  useEffect(() => {
    if (!target) return
    let live = true
    window.repodash.getDiff(path, target).then(
      (diff) => live && setLoaded({ key, diff, error: null }),
      (error) => live && setLoaded({ key, diff: null, error: errorMessage(error) })
    )
    return () => {
      live = false
    }
    // `key` stands for `target`, which is a new object on every render.
  }, [path, key, stamp])
  return loaded.key === key ? loaded : { diff: null, error: null }
}

/** Thousands of DOM rows stall the panel; beyond this a file shows only its start. */
const MAX_LINES = 6000

const STATUS_LETTER: Record<DiffFile['status'], string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R' }

/** A file git lists without a single line: say why rather than show an empty box. */
const NO_LINES: Record<DiffFile['status'], string> = {
  modified: 'No content change',
  added: 'Empty file',
  deleted: 'Empty file deleted',
  renamed: 'Renamed without content changes'
}

export function DiffView({ diff, error, title, empty }: Props) {
  const files = useMemo(() => (diff ? parseDiff(diff.text) : null), [diff])
  const fileRefs = useRef<(HTMLElement | null)[]>([])

  let budget = MAX_LINES
  return (
    <div className="diff">
      {title && <div className="diff-title">{title}</div>}
      {error ? (
        <div className="notice">{error}</div>
      ) : !diff || !files ? (
        <div className="pane-empty">Reading diff…</div>
      ) : (
        <>
          {diff.message && <pre className="diff-message">{diff.message}</pre>}
          {files.length === 0 && (empty ? <div className="diff-empty">{empty}</div> : <div className="pane-empty">No changes</div>)}
          {files.length > 1 && (
            <ul className="diff-index">
              {files.map((file, index) => (
                <li key={`${index}:${file.path}`}>
                  <button className="diff-index-row" onClick={() => fileRefs.current[index]?.scrollIntoView({ block: 'start' })}>
                    <span className={`file-letter letter-${STATUS_LETTER[file.status]}`}>{STATUS_LETTER[file.status]}</span>
                    <span className="file-path">{file.path}</span>
                    <Counts file={file} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.map((file, index) => {
            const shown = file.lines.slice(0, Math.max(0, budget))
            budget -= shown.length
            return (
              <section key={`${index}:${file.path}`} className="diff-file" ref={(el) => void (fileRefs.current[index] = el)}>
                <header className="diff-file-head">
                  <span className={`file-letter letter-${STATUS_LETTER[file.status]}`}>{STATUS_LETTER[file.status]}</span>
                  <span className="file-path" title={file.path}>
                    {file.oldPath && <span className="file-orig">{file.oldPath} → </span>}
                    {file.path}
                  </span>
                  <Counts file={file} />
                </header>
                <div className="diff-lines">
                  {shown.map((line, n) => (
                    <div key={n} className={`diff-line ${line.kind}`}>
                      <span className="ln">{line.oldNo ?? ''}</span>
                      <span className="ln">{line.newNo ?? ''}</span>
                      <span className="code">
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'ctx' ? ' ' : ''}
                        {line.text}
                      </span>
                    </div>
                  ))}
                  {file.lines.length === 0 && (
                    <div className="diff-line note">
                      <span className="ln" />
                      <span className="ln" />
                      <span className="code">{NO_LINES[file.status]}</span>
                    </div>
                  )}
                  {shown.length < file.lines.length && (
                    <div className="diff-line note">
                      <span className="ln" />
                      <span className="ln" />
                      <span className="code">… {file.lines.length - shown.length} more lines not shown</span>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
          {diff.truncated && <div className="diff-cut">Diff cut at 1 MB</div>}
        </>
      )}
    </div>
  )
}

function Counts({ file }: { file: DiffFile }) {
  if (file.binary) return <span className="diff-counts">binary</span>
  return (
    <span className="diff-counts">
      {file.added > 0 && <span className="diff-added">+{file.added}</span>}
      {file.removed > 0 && <span className="diff-removed">−{file.removed}</span>}
    </span>
  )
}
