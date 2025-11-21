import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Config APIs
  getLastVault: () => ipcRenderer.invoke('config:getLastVault'),
  setLastVault: (vaultPath: string | null) => ipcRenderer.invoke('config:setLastVault', vaultPath),
  getRecentVaults: () => ipcRenderer.invoke('config:getRecentVaults'),

  // Dialog APIs
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // File System APIs (to be implemented)
  readVault: (vaultPath: string) => ipcRenderer.invoke('fs:readVault', vaultPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:createFile', filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke('fs:deleteFile', filePath),
  renameFile: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renameFile', oldPath, newPath),

  // Folder operations
  createFolder: (vaultPath: string, folderName: string) => ipcRenderer.invoke('fs:createFolder', vaultPath, folderName),
  renameFolder: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renameFolder', oldPath, newPath),
  deleteFolder: (folderPath: string) => ipcRenderer.invoke('fs:deleteFolder', folderPath),
  moveFile: (oldPath: string, newFolderPath: string) => ipcRenderer.invoke('fs:moveFile', oldPath, newFolderPath),
  ensureDirectory: (dirPath: string) => ipcRenderer.invoke('fs:ensureDirectory', dirPath),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('fs:readDirectory', dirPath),

  // Image operations
  writeImageFile: (filePath: string, base64Data: string) => ipcRenderer.invoke('fs:writeImageFile', filePath, base64Data),
  readImageFile: (filePath: string) => ipcRenderer.invoke('fs:readImageFile', filePath),

  // File watching APIs
  watchVault: (vaultPath: string, callback: (event: string, path: string) => void) => {
    // Remove any existing listeners to prevent memory leaks
    ipcRenderer.removeAllListeners('fs:fileChanged')

    // Add the new listener
    const listener = (_event: any, eventType: string, filePath: string) => {
      callback(eventType, filePath)
    }
    ipcRenderer.on('fs:fileChanged', listener)

    return ipcRenderer.invoke('fs:watchVault', vaultPath)
  },
  unwatchVault: () => {
    ipcRenderer.removeAllListeners('fs:fileChanged')
    return ipcRenderer.invoke('fs:unwatchVault')
  },

  // Graph computation APIs
  computeGraph: (vaultPath: string) => ipcRenderer.invoke('graph:compute', vaultPath),

  // Metadata / Whiteboard APIs
  loadMetadata: (vaultPath: string) => ipcRenderer.invoke('metadata:load', vaultPath),
  saveMetadata: (metadata: any) => ipcRenderer.invoke('metadata:save', metadata),
  updateCardPosition: (cardPosition: any) => ipcRenderer.invoke('metadata:updateCardPosition', cardPosition),
  removeCardFromWhiteboard: (noteId: string, whiteboardId: string) => ipcRenderer.invoke('metadata:removeCardFromWhiteboard', noteId, whiteboardId),

  // PDF APIs
  pdfInitialize: (vaultPath: string) => ipcRenderer.invoke('pdf:initialize', vaultPath),
  pdfImport: (sourcePath: string, fileName?: string) => ipcRenderer.invoke('pdf:import', sourcePath, fileName),
  pdfGetInfo: (pdfPath: string) => ipcRenderer.invoke('pdf:getInfo', pdfPath),
  pdfDelete: (pdfPath: string) => ipcRenderer.invoke('pdf:delete', pdfPath),
  pdfList: () => ipcRenderer.invoke('pdf:list'),
  pdfReadFile: (pdfPath: string) => ipcRenderer.invoke('pdf:readFile', pdfPath),
  pdfSaveThumbnail: (thumbnailDataArray: number[], pdfFileName: string) => ipcRenderer.invoke('pdf:saveThumbnail', thumbnailDataArray, pdfFileName),
  pdfReadThumbnail: (thumbnailPath: string) => ipcRenderer.invoke('pdf:readThumbnail', thumbnailPath),
  pdfDeleteThumbnail: (thumbnailPath: string) => ipcRenderer.invoke('pdf:deleteThumbnail', thumbnailPath),
  openPdfFile: () => ipcRenderer.invoke('dialog:openPdfFile'),

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
})

// Type definitions for TypeScript
export interface ElectronAPI {
  getLastVault: () => Promise<string | null>
  setLastVault: (vaultPath: string | null) => Promise<void>
  getRecentVaults: () => Promise<string[]>
  openDirectory: () => Promise<string | null>
  readVault: (vaultPath: string) => Promise<any>
  readFile: (filePath: string) => Promise<string>
  writeFile: (filePath: string, content: string) => Promise<void>
  createFile: (filePath: string, content: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  createFolder: (vaultPath: string, folderName: string) => Promise<void>
  renameFolder: (oldPath: string, newPath: string) => Promise<void>
  deleteFolder: (folderPath: string) => Promise<void>
  moveFile: (oldPath: string, newFolderPath: string) => Promise<string>
  ensureDirectory: (dirPath: string) => Promise<void>
  readDirectory: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean }>>
  writeImageFile: (filePath: string, base64Data: string) => Promise<void>
  readImageFile: (filePath: string) => Promise<string>
  watchVault: (vaultPath: string, callback: (event: string, path: string) => void) => Promise<void>
  unwatchVault: () => Promise<void>
  computeGraph: (vaultPath: string) => Promise<any>
  loadMetadata: (vaultPath: string) => Promise<any>
  saveMetadata: (metadata: any) => Promise<void>
  updateCardPosition: (cardPosition: any) => Promise<void>
  removeCardFromWhiteboard: (noteId: string, whiteboardId: string) => Promise<void>
  pdfInitialize: (vaultPath: string) => Promise<void>
  pdfImport: (sourcePath: string, fileName?: string) => Promise<{ fileName: string; fileSize: number; pageCount: number; pdfPath: string }>
  pdfGetInfo: (pdfPath: string) => Promise<{ fileName: string; fileSize: number; pageCount: number; pdfPath: string }>
  pdfDelete: (pdfPath: string) => Promise<void>
  pdfList: () => Promise<string[]>
  pdfReadFile: (pdfPath: string) => Promise<number[]>
  pdfSaveThumbnail: (thumbnailDataArray: number[], pdfFileName: string) => Promise<string>
  pdfReadThumbnail: (thumbnailPath: string) => Promise<number[]>
  pdfDeleteThumbnail: (thumbnailPath: string) => Promise<void>
  openPdfFile: () => Promise<string | null>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
