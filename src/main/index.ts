import { app, BrowserWindow, dialog, ipcMain, Notification, type IpcMainInvokeEvent } from 'electron'
import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import icon from '../../resources/icon.png?asset'
import {
  AUTO_FETCH_CHOICES,
  PANEL_TABS,
  type AddResult,
  type DiffTarget,
  type Notice,
  type Operation,
  type PanelTab,
  type RepoDetails,
  type RepoMeta,
  type RepoResult,
  type SectionEdit,
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
/** Set when RepoDash really quits (tray menu, Cmd+Q, end of the session); until then closing only hides. */
let quitting = false

/** Brings the window back from the tray, the taskbar or (macOS) a closed state. */
function showWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Commands wait here until the renderer listens (`ui:ready`), e.g. an `--open` given when RepoDash starts. */
let rendererReady = false
const queued: UiCommand[] = []

/** Fetch all / pull clean from the tray run where the window is; opening a repository brings it up. */
function command(command: UiCommand): void {
  if (command.kind === 'open') showWindow()
  if (rendererReady) broadcast('ui:command', command)
  else queued.push(command)
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
  // A (re)loading page listens again only once it says `ui:ready`.
  win.webContents.on('did-start-loading', () => (rendererReady = false))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Closing keeps RepoDash in the tray, so auto fetch, notifications and the badge go on.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
    tray?.hintOnce()
  })
  // Windows ends the session without `before-quit`; a hidden window must not hold up shutdown.
  win.on('query-session-end', () => (quitting = true))

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

interface CommandLine {
  /** Plain directories, e.g. `repodash C:\src\repo-a C:\src\repo-b`: added to the dashboard. */
  dirs: string[]
  /** `--open <dir>` or `--open=<dir>`, optionally with `--tab=<tab>` (default changes): shown in the panel. */
  open: { dir: string; tab: PanelTab } | null
}

function parseCommandLine(argv: string[], cwd: string): CommandLine {
  const args = argv.slice(app.isPackaged ? 1 : 2)
  const dirs: string[] = []
  let open: string | null = null
  let tab: PanelTab = 'changes'
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--open' && i + 1 < args.length) open = args[++i]
    else if (arg.startsWith('--open=')) open = arg.slice('--open='.length)
    else if (arg.startsWith('--tab=')) {
      const value = arg.slice('--tab='.length)
      if ((PANEL_TABS as readonly string[]).includes(value)) tab = value as PanelTab
    } else if (!arg.startsWith('-') && arg !== '.') dirs.push(resolve(cwd, arg))
  }
  return { dirs, open: open ? { dir: resolve(cwd, open), tab } : null }
}

async function addCommandLineRepositories({ dirs }: CommandLine): Promise<void> {
  for (const dir of dirs.filter(isDirectory)) {
    const root = await resolveRepoRoot(dir).catch(() => null)
    if (root) state.addRepo(root)
  }
}

/** Resolves when the folder scans RepoDash started with are done. */
let initialScan: Promise<void> = Promise.resolve()

/** `--open`: the repository holding the directory, added first if the dashboard does not show it yet. */
async function openFromCommandLine({ open }: CommandLine): Promise<void> {
  if (!open) return
  const root = isDirectory(open.dir) ? await resolveRepoRoot(open.dir).catch(() => null) : null
  if (!root) {
    showWindow()
    notify({ title: 'RepoDash', body: `Not a git repository: ${open.dir}` })
    return
  }
  // A repository a folder scan finds must not also become a source of its own.
  await initialScan
  const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
  let path = state.snapshot().repos.find((repo) => same(repo.path, root))?.path
  if (!path) {
    state.addRepo(root, true)
    path = root
  }
  command({ kind: 'open', path, tab: open.tab })
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

function expectStrings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a string array`)
  }
  return value
}

function sectionEdit(value: unknown): SectionEdit {
  const edit = (value ?? {}) as Record<string, unknown>
  switch (edit.kind) {
    case 'create':
      return {
        kind: 'create',
        name: expectString(edit.name, 'name'),
        after: edit.after === undefined ? undefined : expectString(edit.after, 'after'),
        repos: edit.repos === undefined ? undefined : expectStrings(edit.repos, 'repos')
      }
    case 'rename':
      return { kind: 'rename', id: expectString(edit.id, 'id'), name: expectString(edit.name, 'name') }
    case 'move':
      return { kind: 'move', id: expectString(edit.id, 'id'), by: edit.by === -1 ? -1 : 1 }
    case 'delete':
      return { kind: 'delete', id: expectString(edit.id, 'id') }
    case 'collapse':
      return { kind: 'collapse', id: expectString(edit.id, 'id'), collapsed: edit.collapsed === true }
    case 'dismiss':
      return { kind: 'dismiss', id: expectString(edit.id, 'id'), paths: expectStrings(edit.paths, 'paths') }
    default:
      throw new Error('Unknown section edit')
  }
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => state.snapshot())

  ipcMain.handle('repo:status', (_event, path: unknown): Promise<RepoResult> | RepoResult => {
    const repo = expectString(path, 'path')
    // git cannot even start in a deleted folder ("spawn git ENOENT"); say what happened instead.
    const missing = state.forgetMissing(repo)
    return missing ? { ok: false, path: repo, error: missing } : readRepoStatus(repo)
  })

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

  ipcMain.handle('repo:place', (_event, path: unknown, section: unknown, order: unknown) => {
    state.placeRepo(expectString(path, 'path'), expectString(section, 'section'), expectStrings(order, 'order'))
    return state.snapshot()
  })

  ipcMain.handle('section:edit', (_event, edit: unknown) => {
    state.editSections(sectionEdit(edit))
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

  ipcMain.on('ui:ready', () => {
    rendererReady = true
    for (const each of queued.splice(0)) broadcast('ui:command', each)
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

/** What a second start hands to the running RepoDash: its own arguments, unchanged. */
interface SecondStart {
  argv: string[]
  cwd: string
}

// One RepoDash at a time: starting it again (e.g. from the taskbar while it sits in the tray) brings up
// the running one, and the second start's directories and `--open` are handled there. Its arguments travel
// as additional data: the `argv` of the event is reordered by Chromium, which also splits `--open <dir>`.
if (!app.requestSingleInstanceLock({ argv: process.argv, cwd: process.cwd() } satisfies SecondStart)) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, cwd, data) => {
    showWindow()
    if (!state) return
    const start = data as Partial<SecondStart> | null
    const sent = Array.isArray(start?.argv) && typeof start.cwd === 'string'
    const commandLine = parseCommandLine(sent ? start.argv! : argv, sent ? start.cwd! : cwd)
    void addCommandLineRepositories(commandLine)
    void openFromCommandLine(commandLine)
  })

  app.whenReady().then(async () => {
    state = new State(publish)
    registerIpc()
    const commandLine = parseCommandLine(process.argv, process.cwd())
    await addCommandLineRepositories(commandLine)
    createWindow()
    tray = new StatusTray(showWindow, command)
    publish(state.snapshot())
    initialScan = state.rescan().catch(() => {})
    void openFromCommandLine(commandLine)
    // macOS: clicking the dock icon brings back the hidden window.
    app.on('activate', showWindow)
  })
}

app.on('before-quit', () => (quitting = true))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  watcher.close()
  autoFetch.stop()
  tray?.destroy()
})
