import { app } from 'electron'
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RepoMeta, Source } from '../shared/types'

export interface Config {
  version: 1
  sources: Source[]
  hidden: string[]
  order: string[]
  meta: Record<string, RepoMeta>
}

function emptyConfig(): Config {
  return { version: 1, sources: [], hidden: [], order: [], meta: {} }
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
    return { ...emptyConfig(), ...JSON.parse(text) }
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
