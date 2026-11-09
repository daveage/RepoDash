import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_SCAN_DEPTH = 3

/** Directories that never contain repositories worth listing, or are too large to walk. */
const SKIP = new Set(['node_modules', 'bower_components', 'venv', '__pycache__', 'target'])

/**
 * Finds repositories in `root` and up to `depth` levels below it. Descends into repositories too,
 * because workspaces often clone repositories inside another repository's folder.
 * Symbolic links and junctions are not followed, so the walk cannot loop.
 */
export async function scanFolder(root: string, depth: number): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string, level: number): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    // `.git` is a directory in a normal clone and a file in a worktree or submodule.
    if (entries.some((entry) => entry.name === '.git')) found.push(dir)
    if (level >= depth) return
    const children = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name)
    )
    await Promise.all(children.map((entry) => walk(join(dir, entry.name), level + 1)))
  }

  await walk(root, 0)
  return found.sort((a, b) => a.localeCompare(b))
}
