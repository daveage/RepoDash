import { app, BrowserWindow, dialog, ipcMain, Notification, type IpcMainInvokeEvent } from 'electron'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import icon from '../../resources/icon.png?asset'
import {
  AUTO_FETCH_CHOICES,
  type AddResult,
  type DiffTarget,
  type Notice,
  type Operation,
  type RepoDetails,
  type RepoMeta,
  type Settings,
  type Snapshot,
  type Summary,
  type UiCommand
} from '../shared/types'
import { AutoFetch } from './autofetch'
import { readDiff } from './diff'
import { readChanges, readRepoStatus, resolveRepoRoot } from './git'
import { readHistory, readRefs, toBranches } from './history'
import { cancelOperation, runOperation } from './ops'
import { State } from './state'
import { StatusTray } from './tray'
import { RepoWatcher } from './watch'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

const watcher = new RepoWatcher((path) => broadcast('repo:changed', path))
// The watcher sees most of a fetch, but not one that only updated FETCH_HEAD; tell the renderer anyway.
const autoFetch = new AutoFetch(
  () => state.snapshot().repos.map((repo) => repo.path),
  (path) => broadcast('repo:changed', path)
)

function publish(snapshot: Snapshot): void {
  watcher.sync(snapshot.repos.map((repo) => repo.path))
  autoFetch.configure(snapshot.settings.autoFetchMinutes)
  broadcast('snapshot', snapshot)
}

let state: State
let tray: StatusTray | null = null

/** Brings the window back from the tray, the taskbar or (macOS) a closed state. */
function showWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Fetch all / pull clean from the tray run where the window is; opening a repository brings it up. */
function command(command: UiCommand): void {
  if (command.kind === 'open') showWindow()
  broadcast('ui:command', command)
}

function notify({ title, body, path }: Notice): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.on('click', () => (path ? command({ kind: 'open', path }) : showWindow()))
  notification.show()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'RepoDash',
    icon,
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

  ipcMain.handle('repo:diff', (_event, path: unknown, target: unknown) => {
    if (typeof target !== 'object' || target === null) throw new Error('target must be a diff target')
    // readDiff checks every field: file paths stay inside the repository, hashes are hex.
    return readDiff(expectString(path, 'path'), target as DiffTarget)
  })

  ipcMain.handle('settings:set', (_event, settings: unknown) => {
    const { autoFetchMinutes, notifications } = (settings ?? {}) as Partial<Settings>
    const clean: Partial<Settings> = {}
    if (typeof autoFetchMinutes === 'number' && AUTO_FETCH_CHOICES.includes(autoFetchMinutes)) {
      clean.autoFetchMinutes = autoFetchMinutes
    }
    if (typeof notifications === 'boolean') clean.notifications = notifications
    state.setSettings(clean)
    return state.snapshot()
  })

  ipcMain.on('ui:summary', (_event, summary: unknown) => {
    const { dirty, outOfSync, pullable } = (summary ?? {}) as Summary
    const count = (value: unknown) => (typeof value === 'number' && value >= 0 ? Math.round(value) : 0)
    tray?.update({ dirty: count(dirty), outOfSync: count(outOfSync), pullable: count(pullable) })
  })

  ipcMain.on('ui:notify', (_event, notice: unknown) => {
    const { title, body, path } = (notice ?? {}) as Notice
    if (typeof title !== 'string' || typeof body !== 'string') return
    notify({ title: title.slice(0, 120), body: body.slice(0, 400), path: typeof path === 'string' ? path : undefined })
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

// Windows shows notifications under this id; the installer's Start menu shortcut carries the same one.
app.setAppUserModelId('com.repodash.app')

app.whenReady().then(async () => {
  state = new State(publish)
  registerIpc()
  await addCommandLineRepositories()
  createWindow()
  tray = new StatusTray(showWindow, command)
  publish(state.snapshot())
  void state.rescan()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  watcher.close()
  autoFetch.stop()
  tray?.destroy()
})
