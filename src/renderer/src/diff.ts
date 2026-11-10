export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'note'
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffFile {
  path: string
  /** Renames: the path before. */
  oldPath?: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  binary: boolean
  added: number
  removed: number
  lines: DiffLine[]
}

/** `a/x b/x` → `x`; a rename or an unusual path is settled by the lines that follow the header. */
function headerPath(rest: string): string {
  const half = (rest.length - 1) / 2
  const left = rest.slice(0, half)
  const right = rest.slice(half + 1)
  if (left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2)) return left.slice(2)
  return rest
}

const stripPrefix = (path: string, prefix: string) => (path.startsWith(prefix) ? path.slice(prefix.length) : path)

/**
 * Splits git's unified diff into files and numbered lines. Handles combined diffs of conflicts
 * (`diff --cc`, one sign column per parent) as well; there only the new side is numbered.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let inHeader = false
  // Sign columns: 1 in a normal diff, one per parent in a combined one.
  let signs = 1
  let oldNo = 0
  let newNo = 0

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      const git = line.startsWith('diff --git ')
      file = {
        path: git ? headerPath(line.slice(11)) : line.slice(line.indexOf(' ', 5) + 1),
        status: 'modified',
        binary: false,
        added: 0,
        removed: 0,
        lines: []
      }
      files.push(file)
      inHeader = true
      continue
    }
    if (!file) continue

    if (line.startsWith('@@')) {
      inHeader = false
      const marks = /^(@+)/.exec(line)![1].length
      signs = marks - 1
      const numbers = /-(\d+)(?:,\d+)?.*?\+(\d+)(?:,\d+)?/.exec(line)
      oldNo = numbers ? Number(numbers[1]) : 0
      newNo = numbers ? Number(numbers[2]) : 0
      file.lines.push({ kind: 'hunk', text: line })
      continue
    }

    if (inHeader) {
      if (line.startsWith('--- ')) {
        if (line !== '--- /dev/null') file.oldPath = stripPrefix(line.slice(4), 'a/')
      } else if (line.startsWith('+++ ')) {
        if (line !== '+++ /dev/null') file.path = stripPrefix(line.slice(4), 'b/')
      } else if (line.startsWith('new file')) file.status = 'added'
      else if (line.startsWith('deleted file')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed'
        file.oldPath = line.slice(12)
      } else if (line.startsWith('rename to ')) file.path = line.slice(10)
      else if (line.startsWith('Binary files ') || line.startsWith('File too large')) {
        file.binary = line.startsWith('Binary files ')
        file.lines.push({ kind: 'note', text: line })
      }
      continue
    }

    if (line === '') continue
    if (line.startsWith('\\')) {
      file.lines.push({ kind: 'note', text: line })
      continue
    }
    const sign = line.slice(0, signs)
    const body = line.slice(signs)
    if (sign.includes('+')) {
      file.added++
      file.lines.push({ kind: 'add', text: body, newNo: newNo++ })
    } else if (sign.includes('-')) {
      file.removed++
      file.lines.push({ kind: 'del', text: body, oldNo: signs === 1 ? oldNo++ : undefined })
    } else {
      file.lines.push({ kind: 'ctx', text: body, oldNo: signs === 1 ? oldNo++ : undefined, newNo: newNo++ })
    }
  }

  // Plain diffs name the old path in `---` even without a rename; keep it only where it differs.
  for (const each of files) {
    if (each.oldPath === each.path) delete each.oldPath
    if (each.oldPath && each.status === 'modified') each.status = 'renamed'
  }
  return files
}
