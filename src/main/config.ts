import { app } from 'electron'
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RepoMeta, Settings, Source } from '../shared/types'

export interface Config {
  version: 1
  sources: Source[]
  hidden: string[]
  order: string[]
  meta: Record<string, RepoMeta>
  settings: Settings
}

// Background fetches reach the network, so they wait until the user turns them on.
const DEFAULT_SETTINGS: Settings = { autoFetchMinutes: 0, notifications: true }

function emptyConfig(): Config {
  return { version: 1, sources: [], hidden: [], order: [], meta: {}, settings: { ...DEFAULT_SETTINGS } }
}

function configFile(): string {
  return join(app.getPath('userData'), 'repodash.json')
}

export function loadConfig(): Config {
  const file = configFile()
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return emptyConfig()
  }
  try {
    const parsed = JSON.parse(text)
    // Settings added in a later version get their defaults.
    return { ...emptyConfig(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } }
  } catch {
    // Keep the unreadable file for the user instead of overwriting it on the next save.
    copyFileSync(file, `${file}.bad`)
    return emptyConfig()
  }
}

export function saveConfig(config: Config): void {
  const file = configFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2))
  renameSync(`${file}.tmp`, file)
}
