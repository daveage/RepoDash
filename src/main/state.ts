import { randomUUID } from 'node:crypto'
import type { RepoEntry, RepoMeta, Settings, Snapshot, Source } from '../shared/types'
import { loadConfig, saveConfig, type Config } from './config'
import { canonicalPath } from './git'
import { DEFAULT_SCAN_DEPTH, scanFolder } from './scan'

/** Owns the user's sources and settings; every change is saved and announced through `onChange`. */
export class State {
  private config: Config = loadConfig()
  /** Repositories found by the last scan of each folder source. */
  private scanned = new Map<string, string[]>()
  private scansRunning = 0

  constructor(private onChange: (snapshot: Snapshot) => void) {}

  snapshot(): Snapshot {
    const { sources, hidden, order, meta, settings } = this.config
    const hiddenSet = new Set(hidden)
    const entries = new Map<string, RepoEntry>()
    for (const source of sources) {
      const paths = source.kind === 'repo' ? [source.path] : (this.scanned.get(source.id) ?? [])
      for (const path of paths) {
        if (entries.has(path) || (source.kind === 'folder' && hiddenSet.has(path))) continue
        entries.set(path, { path, sourceId: source.id })
      }
    }
    const rank = new Map(order.map((path, index) => [path, index]))
    const repos = [...entries.values()].sort((a, b) => {
      const byRank = (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity)
      return byRank || a.path.localeCompare(b.path)
    })
    return { sources, repos, hidden, meta, settings, scanning: this.scansRunning > 0 }
  }

  addRepo(path: string): void {
    const canonical = canonicalPath(path)
    this.config.hidden = this.config.hidden.filter((p) => p !== canonical)
    if (!this.config.sources.some((s) => s.kind === 'repo' && s.path === canonical)) {
      this.config.sources.push({ id: randomUUID(), kind: 'repo', path: canonical })
    }
    this.commit()
  }

  addFolder(path: string): void {
    const canonical = canonicalPath(path)
    if (this.config.sources.some((s) => s.kind === 'folder' && s.path === canonical)) return
    const source: Source = { id: randomUUID(), kind: 'folder', path: canonical, depth: DEFAULT_SCAN_DEPTH }
    this.config.sources.push(source)
    this.commit()
    void this.scan(source)
  }

  removeSource(id: string): void {
    this.config.sources = this.config.sources.filter((s) => s.id !== id)
    this.scanned.delete(id)
    this.commit()
  }

  setFolderDepth(id: string, depth: number): void {
    const source = this.config.sources.find((s) => s.id === id && s.kind === 'folder')
    if (!source) return
    source.depth = Math.max(0, Math.min(8, Math.round(depth)))
    this.commit()
    void this.scan(source)
  }

  /** Removes a repository from the dashboard; one found by a folder scan stays hidden until restored. */
  removeRepo(path: string): void {
    this.config.sources = this.config.sources.filter((s) => !(s.kind === 'repo' && s.path === path))
    const foundByScan = [...this.scanned.values()].some((paths) => paths.includes(path))
    if (foundByScan && !this.config.hidden.includes(path)) this.config.hidden.push(path)
    this.commit()
  }

  restoreRepo(path: string): void {
    this.config.hidden = this.config.hidden.filter((p) => p !== path)
    this.commit()
  }

  setOrder(paths: string[]): void {
    this.config.order = paths
    this.commit()
  }

  setMeta(path: string, meta: RepoMeta): void {
    const clean: RepoMeta = {}
    if (meta.alias?.trim()) clean.alias = meta.alias.trim()
    if (meta.color) clean.color = meta.color
    if (Object.keys(clean).length > 0) this.config.meta[path] = clean
    else delete this.config.meta[path]
    this.commit()
  }

  setSettings(settings: Partial<Settings>): void {
    this.config.settings = { ...this.config.settings, ...settings }
    this.commit()
  }

  async rescan(): Promise<void> {
    await Promise.all(this.config.sources.filter((s) => s.kind === 'folder').map((s) => this.scan(s)))
  }

  private async scan(source: Source): Promise<void> {
    this.scansRunning++
    this.onChange(this.snapshot())
    try {
      const found = await scanFolder(source.path, source.depth ?? DEFAULT_SCAN_DEPTH)
      // The source may have been removed while the scan ran.
      if (this.config.sources.includes(source)) this.scanned.set(source.id, found.map(canonicalPath))
    } finally {
      this.scansRunning--
      this.onChange(this.snapshot())
    }
  }

  private commit(): void {
    saveConfig(this.config)
    this.onChange(this.snapshot())
  }
}
