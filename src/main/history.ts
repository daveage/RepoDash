import type { BranchInfo, History, HistoryLane, HistoryRef, HistoryScope } from '../shared/types'
import { runGit } from './git'

export interface Ref {
  kind: 'local' | 'remote' | 'tag'
  /** `main`, `origin/main`, `v1.0` */
  name: string
  /** Commit the ref points at (tags peeled). */
  hash: string
  current: boolean
  upstream: string
  track: string
  time: number
  subject: string
}

const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:unix)',
  '%(contents:subject)'
].join('%00')

export async function readRefs(path: string): Promise<Ref[]> {
  const out = await runGit(path, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'])
  const refs: Ref[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [refname, object, peeled, head, upstream, track, time, subject] = line.split('\0')
    const kind = refname.startsWith('refs/heads/') ? 'local' : refname.startsWith('refs/remotes/') ? 'remote' : 'tag'
    const name = refname.replace(/^refs\/(heads|remotes|tags)\//, '')
    // origin/HEAD only names the remote's default branch, which is listed anyway.
    if (kind === 'remote' && name.endsWith('/HEAD')) continue
    refs.push({
      kind,
      name,
      hash: peeled || object,
      current: head === '*',
      upstream,
      track,
      time: Number(time) * 1000,
      subject
    })
  }
  return refs
}

/** `origin/feature/x` → `feature/x`; remote names are assumed to contain no slash. */
function withoutRemote(name: string): string {
  return name.slice(name.indexOf('/') + 1)
}

export function toBranches(refs: Ref[]): BranchInfo[] {
  const locals = refs.filter((r) => r.kind === 'local')
  const localNames = new Set(locals.map((r) => r.name))
  const upstreams = new Set(locals.map((r) => r.upstream).filter(Boolean))
  return refs
    .filter((r) => r.kind !== 'tag')
    .map((r) => {
      const branch: BranchInfo = {
        name: r.name,
        kind: r.kind as BranchInfo['kind'],
        hash: r.hash,
        current: r.current,
        subject: r.subject,
        time: r.time
      }
      if (r.kind === 'local') {
        if (r.upstream) branch.upstream = r.upstream
        branch.ahead = Number(/ahead (\d+)/.exec(r.track)?.[1] ?? 0)
        branch.behind = Number(/behind (\d+)/.exec(r.track)?.[1] ?? 0)
        if (r.track === 'gone') branch.gone = true
      } else {
        branch.hasLocal = upstreams.has(r.name) || localNames.has(withoutRemote(r.name))
      }
      return branch
    })
}

interface RawCommit {
  hash: string
  parents: string[]
  author: string
  time: number
  subject: string
}

const DEFAULT_BRANCHES = ['main', 'master', 'develop', 'development', 'dev', 'trunk']

/** Branch name a merge commit's message names for its second parent, e.g. "Merge branch 'x' into y". */
export function mergedBranchName(subject: string): string | null {
  const patterns = [
    /^Merge (?:remote-tracking )?branch '([^']+)'/,
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/,
    /^Merged? in (\S+)/,
    /^Merge branch "([^"]+)"/
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(subject)
    if (match) return match[1].replace(/^origin\//, '')
  }
  return null
}

/**
 * Gives each commit to one branch, the way people read history: walking first parents from the tip,
 * a branch owns every commit no branch earlier in the order already owns. The order is main/master/
 * develop..., then the current branch, then other local branches and remote-only ones, newest first.
 * Commits brought in by a merge whose branch is gone are named from the merge message.
 */
export function assignLanes(
  commits: RawCommit[],
  refs: Ref[],
  detachedHead: string | null
): { lanes: HistoryLane[]; laneOf: Map<string, number> } {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const laneOf = new Map<string, number>()
  const lanes: HistoryLane[] = []
  const laneIndex = new Map<string, number>()

  interface Group {
    name: string
    kind: HistoryLane['kind']
    current: boolean
    tips: string[]
    time: number
  }
  const groups = new Map<string, Group>()
  const group = (name: string, kind: Group['kind'], time: number) => {
    let g = groups.get(name)
    if (!g) groups.set(name, (g = { name, kind, current: false, tips: [], time }))
    g.time = Math.max(g.time, time)
    return g
  }
  if (detachedHead) {
    const g = group('HEAD', 'detached', Infinity)
    g.current = true
    g.tips.push(detachedHead)
  }
  for (const ref of refs.filter((r) => r.kind === 'local')) {
    const g = group(ref.name, 'local', ref.time)
    g.current ||= ref.current
    g.tips.unshift(ref.hash)
  }
  for (const ref of refs.filter((r) => r.kind === 'remote')) {
    group(withoutRemote(ref.name), 'remote', ref.time).tips.push(ref.hash)
  }

  // The main line goes first so a feature branch owns only its own commits, not the trunk it started from.
  const rank = (g: Group) => {
    const index = DEFAULT_BRANCHES.indexOf(g.name)
    if (index >= 0) return index
    if (g.current) return DEFAULT_BRANCHES.length
    return g.kind === 'local' ? DEFAULT_BRANCHES.length + 1 : DEFAULT_BRANCHES.length + 2
  }
  const ordered = [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.time - a.time)

  const claim = (start: string | undefined, name: string, kind: HistoryLane['kind'], current: boolean) => {
    let commit = start ? byHash.get(start) : undefined
    while (commit && !laneOf.has(commit.hash)) {
      let index = laneIndex.get(name)
      if (index === undefined) {
        index = lanes.push({ name, kind, current, count: 0 }) - 1
        laneIndex.set(name, index)
      }
      laneOf.set(commit.hash, index)
      lanes[index].count++
      commit = byHash.get(commit.parents[0])
    }
  }

  for (const g of ordered) for (const tip of g.tips) claim(tip, g.name, g.kind, g.current)
  // Newest first, so an outer merge names its branch before the merges inside that branch are reached.
  for (const commit of commits) {
    for (const parent of commit.parents.slice(1)) {
      if (laneOf.has(parent)) continue
      claim(parent, mergedBranchName(commit.subject) ?? 'merged', 'merged', false)
    }
  }
  return { lanes, laneOf }
}

const LOG_FORMAT = ['%H', '%P', '%an', '%ct', '%s'].join('%x1f')

export async function readHistory(path: string, scope: HistoryScope, limit: number): Promise<History> {
  const [refs, head] = await Promise.all([
    readRefs(path),
    runGit(path, ['rev-parse', '-q', '--verify', 'HEAD']).then(
      (out) => out.trim(),
      () => null
    )
  ])
  if (!head) return { commits: [], lanes: [], truncated: false }

  const revisions = scope === 'all' ? ['--branches', '--remotes', '--tags', 'HEAD'] : ['HEAD']
  const out = await runGit(path, ['log', `--max-count=${limit + 1}`, '--date-order', `--format=${LOG_FORMAT}`, ...revisions])
  const raw: RawCommit[] = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, author, time, subject] = line.split('\x1f')
      return { hash, parents: parents ? parents.split(' ') : [], author, time: Number(time) * 1000, subject }
    })
  const truncated = raw.length > limit
  const commits = raw.slice(0, limit)

  // Refs whose commit is outside the loaded window simply claim nothing.
  const detached = refs.some((r) => r.current) ? null : head
  const { lanes, laneOf } = assignLanes(commits, refs, detached)
  const laneByName = new Map(lanes.map((lane, index) => [lane.name, index]))

  const refsAt = new Map<string, HistoryRef[]>()
  const addRef = (hash: string, ref: HistoryRef) => refsAt.set(hash, [...(refsAt.get(hash) ?? []), ref])
  addRef(head, { name: 'HEAD', kind: 'head', lane: -1 })
  for (const ref of refs) {
    const laneName = ref.kind === 'remote' ? withoutRemote(ref.name) : ref.name
    addRef(ref.hash, { name: ref.name, kind: ref.kind, lane: ref.kind === 'tag' ? -1 : (laneByName.get(laneName) ?? -1) })
  }

  return {
    commits: commits.map((c) => ({ ...c, refs: refsAt.get(c.hash) ?? [], lane: laneOf.get(c.hash) ?? -1 })),
    lanes,
    truncated
  }
}
