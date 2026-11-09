import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RepoDashApi } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RepoDashApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  onSnapshot: (listener) => subscribe('snapshot', listener),
  onRepoChanged: (listener) => subscribe('repo:changed', listener),
  getStatus: (path) => ipcRenderer.invoke('repo:status', path),

  addRepository: () => ipcRenderer.invoke('source:add-repo'),
  addScanFolder: () => ipcRenderer.invoke('source:add-folder'),
  removeSource: (id) => ipcRenderer.invoke('source:remove', id),
  setFolderDepth: (id, depth) => ipcRenderer.invoke('source:set-depth', id, depth),
  rescan: () => ipcRenderer.invoke('source:rescan'),

  removeRepo: (path) => ipcRenderer.invoke('repo:remove', path),
  restoreRepo: (path) => ipcRenderer.invoke('repo:restore', path),
  setOrder: (paths) => ipcRenderer.invoke('repo:set-order', paths),
  setMeta: (path, meta) => ipcRenderer.invoke('repo:set-meta', path, meta),

  getDetails: (path) => ipcRenderer.invoke('repo:details', path),
  getHistory: (path, scope, limit) => ipcRenderer.invoke('repo:history', path, scope, limit),
  runOperation: (path, op, opId) => ipcRenderer.invoke('op:run', path, op, opId),
  cancelOperation: (opId) => ipcRenderer.invoke('op:cancel', opId),
  onOpOutput: (listener) => subscribe('op:output', listener)
}

contextBridge.exposeInMainWorld('repodash', api)
