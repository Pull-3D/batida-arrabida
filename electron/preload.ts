import { contextBridge, ipcRenderer } from 'electron'

const toPlain = (value: any) => JSON.parse(JSON.stringify(value))

const desktopApi = {
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getMeta: () => ipcRenderer.invoke('app:meta'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: any) => ipcRenderer.invoke('config:set', toPlain(config)),
  search: (payload: any) => ipcRenderer.invoke('search:run', toPlain(payload)),
  scrapeTops: (payload: any) => ipcRenderer.invoke('tops:scrape', toPlain(payload)),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  addDownload: (payload: any) => ipcRenderer.invoke('downloads:add', toPlain(payload)),
  clearCompletedJobs: () => ipcRenderer.invoke('jobs:clear-completed'),
  getLogs: () => ipcRenderer.invoke('logs:list'),
  onAppLog: (callback: (msg: string) => void) => {
    ipcRenderer.on('app-log', (_, msg) => callback(msg))
  },
  onJobsUpdated: (callback: (jobs: any[]) => void) => {
    ipcRenderer.on('jobs-updated', (_, jobs) => callback(jobs))
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  selectFolder: (defaultPath?: string) => ipcRenderer.invoke('dialog:selectFolder', defaultPath),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  deletePath: (path: string) => ipcRenderer.invoke('shell:deletePath', path),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getRuntimeInfo: () => ipcRenderer.invoke('app:getRuntimeInfo'),
  getServerPort: () => ipcRenderer.invoke('server:getPort'),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_, isMaximized) => callback(isMaximized))
  },
  onAuthExpired: (callback: (data: { reason: string }) => void) => {
    ipcRenderer.on('auth:expired', (_, data) => callback(data))
  },
  onSessionHealth: (callback: (data: {
    isHealthy: boolean
    sessionAge: number | null
    lastActivity: string | null
    consecutiveFailures: number
    expiresIn: number | null
  }) => void) => {
    ipcRenderer.on('session:health', (_, data) => callback(data))
  },
  safeStorage: {
    isAvailable: () => ipcRenderer.invoke('safeStorage:isAvailable'),
    encrypt: (plaintext: string) => ipcRenderer.invoke('safeStorage:encrypt', plaintext),
    decrypt: (encryptedBase64: string, isEncrypted: boolean) => ipcRenderer.invoke('safeStorage:decrypt', encryptedBase64, isEncrypted)
  },
  deezerLogin: {
    openLoginWindow: () => ipcRenderer.invoke('deezer:openLoginWindow'),
    closeLoginWindow: () => ipcRenderer.invoke('deezer:closeLoginWindow')
  },
  playlistSync: {
    onSyncStart: (callback: (data: { playlistId: string }) => void) => { ipcRenderer.on('sync:start', (_, data) => callback(data)) },
    onSyncProgress: (callback: (data: { playlistId: string; current: number; total: number; phase: string }) => void) => { ipcRenderer.on('sync:progress', (_, data) => callback(data)) },
    onSyncComplete: (callback: (data: any) => void) => { ipcRenderer.on('sync:complete', (_, data) => callback(data)) },
    onSyncError: (callback: (data: { playlistId: string; error: string }) => void) => { ipcRenderer.on('sync:error', (_, data) => callback(data)) }
  },
  storage: {
    saveCredentials: (credentials: { arl?: string; spotifyClientId?: string; spotifyRefreshToken?: string }) => ipcRenderer.invoke('storage:saveCredentials', credentials),
    loadCredentials: () => ipcRenderer.invoke('storage:loadCredentials'),
    saveSettings: (settings: object) => ipcRenderer.invoke('storage:saveSettings', settings),
    loadSettings: () => ipcRenderer.invoke('storage:loadSettings'),
    saveProfiles: (data: object) => ipcRenderer.invoke('storage:saveProfiles', data),
    loadProfiles: () => ipcRenderer.invoke('storage:loadProfiles')
  },
  desktop: desktopApi
})

contextBridge.exposeInMainWorld('desktop', desktopApi)

type SafeStorageResult = { encrypted: boolean; data: string }
type StorageCredentials = { arl?: string; spotifyClientId?: string; spotifyRefreshToken?: string }
type StorageResult = { success: boolean; error?: string }

declare global {
  interface Window {
    desktop: typeof desktopApi
    electronAPI: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      selectFolder: (defaultPath?: string) => Promise<string | null>
      openPath: (path: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      deletePath: (path: string) => Promise<void>
      getVersion: () => Promise<string>
      getRuntimeInfo: () => Promise<{ electron: string; chromium: string; node: string; v8: string; os: string }>
      getServerPort: () => Promise<number>
      onMaximizeChange: (callback: (isMaximized: boolean) => void) => void
      onAuthExpired: (callback: (data: { reason: string }) => void) => void
      onSessionHealth: (callback: (data: { isHealthy: boolean; sessionAge: number | null; lastActivity: string | null; consecutiveFailures: number; expiresIn: number | null }) => void) => void
      safeStorage: {
        isAvailable: () => Promise<boolean>
        encrypt: (plaintext: string) => Promise<SafeStorageResult>
        decrypt: (encryptedBase64: string, isEncrypted: boolean) => Promise<string>
      }
      deezerLogin: {
        openLoginWindow: () => Promise<{ success: boolean; arl?: string; error?: string }>
        closeLoginWindow: () => Promise<void>
      }
      playlistSync: {
        onSyncStart: (callback: (data: { playlistId: string }) => void) => void
        onSyncProgress: (callback: (data: { playlistId: string; current: number; total: number; phase: string }) => void) => void
        onSyncComplete: (callback: (data: any) => void) => void
        onSyncError: (callback: (data: { playlistId: string; error: string }) => void) => void
      }
      storage: {
        saveCredentials: (credentials: StorageCredentials) => Promise<StorageResult>
        loadCredentials: () => Promise<{ success: boolean; credentials: StorageCredentials }>
        saveSettings: (settings: object) => Promise<StorageResult>
        loadSettings: () => Promise<{ success: boolean; settings: object | null }>
        saveProfiles: (data: object) => Promise<StorageResult>
        loadProfiles: () => Promise<{ success: boolean; data: any }>
      }
      desktop: typeof desktopApi
    }
  }
}
