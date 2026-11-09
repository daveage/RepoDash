import type { HistoryCommit } from '../../shared/types'

/** A line from one row's centre to the next row's centre, between two columns. */
export interface Segment {
  row: number
  from: number
  to: number
  /** History lane whose colour the line takes. */
  lane: number
}

export interface GraphLayout {
  columns: number
  /** Column of each commit's node, by row. */
  nodeColumn: number[]
  segments: Segment[]
}

/**
 * Lays commits (newest first, as git log prints them) out in columns, the way `git log --graph` does.
 * Each column waits for one commit: a commit takes the first column waiting for it, hands the column on
 * to its first parent and opens or joins a column for every further parent. Columns that waited for the
 * same commit converge on its node. A first-parent line takes the child's colour (the branch runs down to
 * where it forked); a merge line takes the merged parent's colour (that branch comes in).
 */
export function layoutGraph(commits: HistoryCommit[]): GraphLayout {
  const laneOf = new Map(commits.map((c) => [c.hash, c.lane]))
  let slots: ({ hash: string; lane: number } | null)[] = []
  const nodeColumn: number[] = []
  const segments: Segment[] = []
  let columns = 0

  const freeSlot = () => {
    const free = slots.indexOf(null)
    return free >= 0 ? free : slots.length
  }

  commits.forEach((commit, row) => {
    let col = slots.findIndex((slot) => slot?.hash === commit.hash)
    if (col < 0) col = freeSlot()
    // Every other column that waited for this commit ends in its node; the previous row drew them there.
    slots = slots.map((slot, k) => (k !== col && slot?.hash === commit.hash ? null : slot))
    nodeColumn[row] = col

    const [first, ...rest] = commit.parents
    slots[col] = first ? { hash: first, lane: commit.lane } : null
    // Where each column's line starts in this row: its own column, or the node for lines opened here.
    const starts = new Map<number, number>([[col, col]])
    const joins: { to: number; lane: number }[] = []
    for (const parent of rest) {
      const lane = laneOf.get(parent) ?? -1
      const existing = slots.findIndex((slot) => slot?.hash === parent)
      if (existing >= 0) {
        joins.push({ to: existing, lane })
      } else {
        const k = freeSlot()
        slots[k] = { hash: parent, lane }
        starts.set(k, col)
      }
    }
    while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop()

    // A column waiting for the next commit bends into the column that commit's node will take.
    const next = commits[row + 1]
    const nextColumn = next ? slots.findIndex((slot) => slot?.hash === next.hash) : -1
    const end = (k: number) => (nextColumn >= 0 && slots[k]?.hash === next?.hash ? nextColumn : k)

    slots.forEach((slot, k) => {
      if (slot) segments.push({ row, from: starts.get(k) ?? k, to: end(k), lane: slot.lane })
    })
    for (const join of joins) segments.push({ row, from: col, to: end(join.to), lane: join.lane })

    columns = Math.max(columns, slots.length, col + 1)
  })

  return { columns, nodeColumn, segments }
}
