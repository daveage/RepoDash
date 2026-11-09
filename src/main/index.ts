import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AddResult, Operation, RepoDetails, RepoMeta, Snapshot } from '../shared/types'
import { readChanges, readRepoStatus, resolveRepoRoot } from './git'
import { readHistory, readRefs, toBranches } from './history'
import { cancelOperation, runOperation } from './ops'
import { State } from './state'
import { RepoWatcher } from './watch'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

const watcher = new RepoWatcher((path) => broadcast('repo:changed', path))

function publish(snapshot: Snapshot): void {
  watcher.sync(snapshot.repos.map((repo) => repo.path))
  broadcast('snapshot', snapshot)
}

let state: State

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'RepoDash',
    backgroundColor: '#05080c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Directories passed on the command line, e.g. `repodash C:\src\repo-a C:\src\repo-b`, become sources. */
async function addCommandLineRepositories(): Promise<void> {
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  const dirs = args.filter((arg) => !arg.startsWith('-') && arg !== '.').map((arg) => resolve(arg))
  for (const dir of dirs.filter(isDirectory)) {
    const root = await resolveRepoRoot(dir).catch(() => null)
    if (root) state.addRepo(root)
  }
}

async function pickDirectory(event: IpcMainInvokeEvent, title: string): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = { title, properties: ['openDirectory' as const] }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => state.snapshot())

  ipcMain.handle('repo:status', (_event, path: unknown) => readRepoStatus(expectString(path, 'path')))

  ipcMain.handle('source:add-repo', async (event): Promise<AddResult> => {
    const dir = await pickDirectory(event, 'Add repository')
    if (!dir) return null
    const root = await resolveRepoRoot(dir).catch(() => null)
    if (!root) return { error: `Not a git repository: ${dir}` }
    state.addRepo(root)
    return { snapshot: state.snapshot() }
  })

  ipcMain.handle('source:add-folder', async (event): Promise<AddResult> => {
    const dir = await pickDirectory(event, 'Add folder to scan for repositories')
    if (!dir) return null
    state.addFolder(dir)
    return { snapshot: state.snapshot() }
  })

  ipcMain.handle('source:remove', (_event, id: unknown) => {
    state.removeSource(expectString(id, 'id'))
    return state.snapshot()
  })

  ipcMain.handle('source:set-depth', (_event, id: unknown, depth: unknown) => {
    if (typeof depth !== 'number') throw new Error('depth must be a number')
    state.setFolderDepth(expectString(id, 'id'), depth)
    return state.snapshot()
  })

  ipcMain.handle('source:rescan', async () => {
    await state.rescan()
    return state.snapshot()
  })

  ipcMain.handle('repo:remove', (_event, path: unknown) => {
    state.removeRepo(expectString(path, 'path'))
    return state.snapshot()
  })

  ipcMain.handle('repo:restore', (_event, path: unknown) => {
    state.restoreRepo(expectString(path, 'path'))
    return state.snapshot()
  })

  ipcMain.handle('repo:set-order', (_event, paths: unknown) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
      throw new Error('paths must be a string array')
    }
    state.setOrder(paths)
    return state.snapshot()
  })

  ipcMain.handle('repo:details', async (_event, path: unknown): Promise<RepoDetails> => {
    const repo = expectString(path, 'path')
    const [refs, files] = await Promise.all([readRefs(repo), readChanges(repo)])
    return { branches: toBranches(refs), files }
  })

  ipcMain.handle('repo:history', (_event, path: unknown, scope: unknown, limit: unknown) => {
    const count = typeof limit === 'number' ? Math.max(1, Math.min(5000, Math.round(limit))) : 300
    return readHistory(expectString(path, 'path'), scope === 'current' ? 'current' : 'all', count)
  })

  ipcMain.handle('op:run', async (event, path: unknown, op: unknown, opId: unknown) => {
    const repo = expectString(path, 'path')
    const id = expectString(opId, 'opId')
    if (typeof op !== 'object' || op === null || typeof (op as Operation).kind !== 'string') {
      throw new Error('op must be an operation')
    }
    const result = await runOperation(repo, op as Operation, id, (text) => {
      if (!event.sender.isDestroyed()) event.sender.send('op:output', { opId: id, text })
    })
    // The watcher sees most changes, but not e.g. a failed push; the card should show the outcome now.
    broadcast('repo:changed', repo)
    return result
  })

  ipcMain.handle('op:cancel', (_event, opId: unknown) => cancelOperation(expectString(opId, 'opId')))

  ipcMain.handle('repo:set-meta', (_event, path: unknown, meta: unknown) => {
    const { alias, color } = (meta ?? {}) as RepoMeta
    state.setMeta(expectString(path, 'path'), {
      alias: typeof alias === 'string' ? alias.slice(0, 80) : undefined,
      color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined
    })
    return state.snapshot()
  })
}

app.whenReady().then(async () => {
  state = new State(publish)
  registerIpc()
  await addCommandLineRepositories()
  createWindow()
  void state.rescan()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => watcher.close())
