import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import type {
  RepoEntry,
  RepoMeta,
  Section,
  SectionEdit,
  SectionSuggestion,
  Settings,
  Snapshot,
  Source
} from '../shared/types'
import { loadConfig, saveConfig, type Config, type SectionConfig } from './config'
import { canonicalPath } from './git'
import { DEFAULT_SCAN_DEPTH, scanFolder } from './scan'

const CUSTOM = 'custom:'
const MAX_SECTION_NAME = 60

/** `C:\src\apps` → `apps`; a drive root keeps its whole path. */
function folderName(path: string): string {
  return basename(path) || path
}

function sectionName(name: string): string {
  return name.trim().slice(0, MAX_SECTION_NAME)
}

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

    // Default sections, in the order of their sources: one per scan folder, one per folder holding single repositories.
    const defaults = new Map<string, string>()
    const homeOf = (source: Source, path: string) => (source.kind === 'folder' ? `source:${source.id}` : `dir:${dirname(path)}`)
    for (const source of sources) {
      const id = homeOf(source, source.path)
      if (!defaults.has(id)) defaults.set(id, source.kind === 'folder' ? source.path : dirname(source.path))
    }
    const configs = new Map(this.config.sections.map((section) => [section.id, section]))
    const exists = (id: string) => defaults.has(id) || (id.startsWith(CUSTOM) && configs.has(id))

    const entries = new Map<string, RepoEntry>()
    for (const source of sources) {
      const paths = source.kind === 'repo' ? [source.path] : (this.scanned.get(source.id) ?? [])
      for (const path of paths) {
        if (entries.has(path) || (source.kind === 'folder' && hiddenSet.has(path))) continue
        const home = homeOf(source, path)
        const chosen = meta[path]?.section
        entries.set(path, { path, sourceId: source.id, home, section: chosen && exists(chosen) ? chosen : home })
      }
    }
    const rank = new Map(order.map((path, index) => [path, index]))
    const ranked = [...entries.values()].sort((a, b) => {
      const byRank = (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity)
      return byRank || a.path.localeCompare(b.path)
    })

    const ids = this.config.sections.map((section) => section.id).filter(exists)
    for (const id of defaults.keys()) if (!ids.includes(id)) ids.push(id)
    const sections: Section[] = ids.map((id) => {
      const path = defaults.get(id)
      const repos = ranked.filter((entry) => entry.section === id).map((entry) => entry.path)
      const config = configs.get(id)
      return {
        id,
        name: config?.name ?? folderName(path ?? ''),
        path,
        custom: path === undefined,
        collapsed: config?.collapsed ?? false,
        repos,
        suggestions: id.startsWith('source:') && path ? this.suggestions(id, path, repos) : []
      }
    })
    const repos = sections.flatMap((section) => section.repos.map((path) => entries.get(path)!))
    return { sources, repos, sections, hidden, meta, settings, scanning: this.scansRunning > 0 }
  }

  /** Subfolders below a scan folder that hold two or more of its section's repositories, but not all of them. */
  private suggestions(id: string, root: string, repos: string[]): SectionSuggestion[] {
    const byFolder = new Map<string, string[]>()
    for (const repo of repos) {
      const folder = dirname(repo)
      if (folder !== root) byFolder.set(folder, [...(byFolder.get(folder) ?? []), repo])
    }
    return [...byFolder]
      .filter(([folder, list]) => list.length >= 2 && list.length < repos.length && !this.config.dismissed.includes(`${id}|${folder}`))
      .map(([folder, list]) => ({ path: folder, name: folderName(folder), repos: list }))
      .sort((a, b) => a.path.localeCompare(b.path))
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

  /** Alias and colour; the section is changed by `placeRepo` only. */
  setMeta(path: string, meta: RepoMeta): void {
    const clean: RepoMeta = {}
    if (meta.alias?.trim()) clean.alias = meta.alias.trim()
    if (meta.color) clean.color = meta.color
    this.storeMeta(path, { ...clean, section: this.config.meta[path]?.section })
    this.commit()
  }

  placeRepo(path: string, section: string, order: string[]): void {
    const snapshot = this.snapshot()
    const entry = snapshot.repos.find((repo) => repo.path === path)
    if (!entry || !snapshot.sections.some((s) => s.id === section)) return
    this.storeMeta(path, { ...this.config.meta[path], section: section === entry.home ? undefined : section })
    this.config.order = order
    this.commit()
  }

  editSections(edit: SectionEdit): void {
    const snapshot = this.snapshot()
    const known = snapshot.sections.find((section) => section.id === ('id' in edit ? edit.id : ''))
    if (edit.kind !== 'create' && !known) return
    switch (edit.kind) {
      case 'create': {
        const id = `${CUSTOM}${randomUUID()}`
        const ids = snapshot.sections.map((section) => section.id)
        const at = edit.after && ids.includes(edit.after) ? ids.indexOf(edit.after) + 1 : ids.length
        ids.splice(at, 0, id)
        this.arrange(ids)
        this.sectionConfig(id).name = sectionName(edit.name) || 'New section'
        const paths = new Set(snapshot.repos.map((repo) => repo.path))
        for (const path of edit.repos ?? []) {
          if (paths.has(path)) this.storeMeta(path, { ...this.config.meta[path], section: id })
        }
        break
      }
      case 'rename': {
        const name = sectionName(edit.name)
        if (known!.custom) {
          if (name) this.sectionConfig(edit.id).name = name
        } else {
          // A default section without a name of its own is called after its folder again.
          this.sectionConfig(edit.id).name = name && name !== folderName(known!.path!) ? name : undefined
        }
        break
      }
      case 'move': {
        // Empty default sections are not on the board, so a move steps over them.
        const shown = snapshot.sections.filter((section) => section.custom || section.repos.length > 0)
        const neighbour = shown[shown.findIndex((section) => section.id === edit.id) + edit.by]
        if (!neighbour) return
        const ids = snapshot.sections.map((section) => section.id)
        const [a, b] = [ids.indexOf(edit.id), ids.indexOf(neighbour.id)]
        ;[ids[a], ids[b]] = [ids[b], ids[a]]
        this.arrange(ids)
        break
      }
      case 'delete': {
        if (!known!.custom) return
        this.config.sections = this.config.sections.filter((section) => section.id !== edit.id)
        for (const path of known!.repos) this.storeMeta(path, { ...this.config.meta[path], section: undefined })
        break
      }
      case 'collapse':
        this.sectionConfig(edit.id).collapsed = edit.collapsed || undefined
        break
      case 'dismiss':
        for (const path of edit.paths) {
          const key = `${edit.id}|${path}`
          if (!this.config.dismissed.includes(key)) this.config.dismissed.push(key)
        }
        break
    }
    this.commit()
  }

  /** Lists every section in this order; settings of sections that no longer exist are dropped. */
  private arrange(ids: string[]): void {
    const configs = new Map(this.config.sections.map((section) => [section.id, section]))
    this.config.sections = ids.map((id) => configs.get(id) ?? { id })
  }

  /** The settings of an existing section, listed first if it is a default section that was not yet. */
  private sectionConfig(id: string): SectionConfig {
    if (!this.config.sections.some((section) => section.id === id)) {
      // Listing every section in the board's order keeps the default section where it is.
      this.arrange(this.snapshot().sections.map((section) => section.id))
    }
    return this.config.sections.find((section) => section.id === id)!
  }

  private storeMeta(path: string, meta: RepoMeta): void {
    const clean = Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)) as RepoMeta
    if (Object.keys(clean).length > 0) this.config.meta[path] = clean
    else delete this.config.meta[path]
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
