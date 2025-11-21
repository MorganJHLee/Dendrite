import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { FileSystemService } from './services/FileSystemService'
import { GraphService } from './services/GraphService'
import { MetadataService } from './services/MetadataService'
import { ConfigService } from './services/ConfigService'
import { getAtomicFileStorage } from './services/AtomicFileStorage'
import { pdfService } from './services/PdfService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In production, the app structure is:
// app.asar/
//   dist-electron/  (contains main.js, preload.js)
//   dist/           (contains index.html and web assets)
const DIST_PATH = path.join(__dirname, '../dist')
const PUBLIC_PATH = app.isPackaged
  ? DIST_PATH
  : path.join(DIST_PATH, '../public')

let win: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// Services
const fileSystemService = new FileSystemService()
const configService = new ConfigService()
let graphService: GraphService | null = null
let metadataService: MetadataService | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(PUBLIC_PATH, 'electron-vite.svg'),
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    // Use absolute path to index.html in packaged app
    const indexPath = path.join(DIST_PATH, 'index.html')
    win.loadFile(indexPath)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Flush pending writes before quit to prevent data loss
app.on('before-quit', async (event) => {
  event.preventDefault()
  const storage = getAtomicFileStorage()
  const stats = storage.getQueueStats()

  if (stats.queueLength > 0 || stats.isProcessing) {
    console.log(`Flushing ${stats.queueLength} pending writes before quit...`)
    await storage.flush()
    console.log('All writes flushed successfully')
  }

  app.exit()
})

app.whenReady().then(async () => {
  await configService.init()
  createWindow()
})

// ===== IPC Handlers =====

// Config
ipcMain.handle('config:getLastVault', () => {
  return configService.getLastOpenedVault()
})

ipcMain.handle('config:setLastVault', async (_event, vaultPath: string | null) => {
  await configService.setLastOpenedVault(vaultPath)
})

ipcMain.handle('config:getRecentVaults', () => {
  return configService.getRecentVaults()
})

// Dialog
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory'],
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// File System
ipcMain.handle('fs:readVault', async (_event, vaultPath: string) => {
  try {
    return await fileSystemService.readVault(vaultPath)
  } catch (error) {
    console.error('Error reading vault:', error)
    throw error
  }
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    return await fileSystemService.readFile(filePath)
  } catch (error) {
    console.error('Error reading file:', error)
    throw error
  }
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  try {
    await fileSystemService.writeFile(filePath, content)
  } catch (error) {
    console.error('Error writing file:', error)
    throw error
  }
})

ipcMain.handle('fs:createFile', async (_event, filePath: string, content: string) => {
  try {
    await fileSystemService.createFile(filePath, content)
  } catch (error) {
    console.error('Error creating file:', error)
    throw error
  }
})

ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
  try {
    await fileSystemService.deleteFile(filePath)
  } catch (error) {
    console.error('Error deleting file:', error)
    throw error
  }
})

ipcMain.handle('fs:renameFile', async (_event, oldPath: string, newPath: string) => {
  try {
    await fileSystemService.renameFile(oldPath, newPath)
  } catch (error) {
    console.error('Error renaming file:', error)
    throw error
  }
})

// Folder Operations
ipcMain.handle('fs:createFolder', async (_event, vaultPath: string, folderName: string) => {
  try {
    await fileSystemService.createFolder(vaultPath, folderName)
  } catch (error) {
    console.error('Error creating folder:', error)
    throw error
  }
})

ipcMain.handle('fs:renameFolder', async (_event, oldPath: string, newPath: string) => {
  try {
    await fileSystemService.renameFolder(oldPath, newPath)
  } catch (error) {
    console.error('Error renaming folder:', error)
    throw error
  }
})

ipcMain.handle('fs:deleteFolder', async (_event, folderPath: string) => {
  try {
    await fileSystemService.deleteFolder(folderPath)
  } catch (error) {
    console.error('Error deleting folder:', error)
    throw error
  }
})

ipcMain.handle('fs:moveFile', async (_event, oldPath: string, newFolderPath: string) => {
  try {
    return await fileSystemService.moveFile(oldPath, newFolderPath)
  } catch (error) {
    console.error('Error moving file:', error)
    throw error
  }
})

ipcMain.handle('fs:ensureDirectory', async (_event, dirPath: string) => {
  try {
    await fileSystemService.ensureDirectory(dirPath)
  } catch (error) {
    console.error('Error ensuring directory:', error)
    throw error
  }
})

ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
  try {
    return await fileSystemService.readDirectory(dirPath)
  } catch (error) {
    console.error('Error reading directory:', error)
    throw error
  }
})

// Image Operations
ipcMain.handle('fs:writeImageFile', async (_event, filePath: string, base64Data: string) => {
  try {
    await fileSystemService.writeImageFile(filePath, base64Data)
  } catch (error) {
    console.error('Error writing image file:', error)
    throw error
  }
})

ipcMain.handle('fs:readImageFile', async (_event, filePath: string) => {
  try {
    return await fileSystemService.readImageFile(filePath)
  } catch (error) {
    console.error('Error reading image file:', error)
    throw error
  }
})

// File Watching
ipcMain.handle('fs:watchVault', async (_event, vaultPath: string) => {
  fileSystemService.watchVault(vaultPath, (eventType, filePath) => {
    win?.webContents.send('fs:fileChanged', eventType, filePath)
  })
})

ipcMain.handle('fs:unwatchVault', async () => {
  fileSystemService.unwatchVault()
})

// Graph Computation
ipcMain.handle('graph:compute', async (_event, vaultPath: string) => {
  try {
    graphService = new GraphService(vaultPath)
    const graph = await graphService.buildGraph()

    // Also return the notes
    const notes = graphService.getAllNotes()

    return {
      graph,
      notes,
    }
  } catch (error) {
    console.error('Error computing graph:', error)
    throw error
  }
})

ipcMain.handle('graph:getLocalGraph', async (_event, noteId: string, depth: number) => {
  if (!graphService) {
    throw new Error('Graph service not initialized')
  }
  return graphService.getLocalGraph(noteId, depth)
})

// Metadata / Whiteboard Persistence
ipcMain.handle('metadata:load', async (_event, vaultPath: string) => {
  try {
    metadataService = new MetadataService(vaultPath)
    return await metadataService.loadMetadata()
  } catch (error) {
    console.error('Error loading metadata:', error)
    throw error
  }
})

ipcMain.handle('metadata:save', async (_event, metadata: any) => {
  if (!metadataService) {
    throw new Error('Metadata service not initialized')
  }
  try {
    await metadataService.saveMetadata(metadata)
  } catch (error) {
    console.error('Error saving metadata:', error)
    throw error
  }
})

ipcMain.handle('metadata:updateCardPosition', async (_event, cardPosition: any) => {
  if (!metadataService) {
    throw new Error('Metadata service not initialized')
  }
  try {
    await metadataService.updateCardPosition(cardPosition)
  } catch (error) {
    console.error('Error updating card position:', error)
    throw error
  }
})

ipcMain.handle('metadata:removeCardFromWhiteboard', async (_event, noteId: string, whiteboardId: string) => {
  if (!metadataService) {
    throw new Error('Metadata service not initialized')
  }
  try {
    await metadataService.removeCardFromWhiteboard(noteId, whiteboardId)
  } catch (error) {
    console.error('Error removing card from whiteboard:', error)
    throw error
  }
})

// PDF Operations
ipcMain.handle('pdf:initialize', async (_event, vaultPath: string) => {
  try {
    pdfService.setVaultPath(vaultPath)
    await pdfService.initialize()
  } catch (error) {
    console.error('Error initializing PDF service:', error)
    throw error
  }
})

ipcMain.handle('pdf:import', async (_event, sourcePath: string, fileName?: string) => {
  try {
    return await pdfService.importPdf(sourcePath, fileName)
  } catch (error) {
    console.error('Error importing PDF:', error)
    throw error
  }
})

ipcMain.handle('pdf:getInfo', async (_event, pdfPath: string) => {
  try {
    return await pdfService.getPdfInfo(pdfPath)
  } catch (error) {
    console.error('Error getting PDF info:', error)
    throw error
  }
})

ipcMain.handle('pdf:delete', async (_event, pdfPath: string) => {
  try {
    await pdfService.deletePdf(pdfPath)
  } catch (error) {
    console.error('Error deleting PDF:', error)
    throw error
  }
})

ipcMain.handle('pdf:list', async () => {
  try {
    return await pdfService.listPdfs()
  } catch (error) {
    console.error('Error listing PDFs:', error)
    throw error
  }
})

ipcMain.handle('pdf:readFile', async (_event, pdfPath: string) => {
  try {
    const buffer = await pdfService.readPdfFile(pdfPath)
    // Convert buffer to array for IPC transfer
    return Array.from(buffer)
  } catch (error) {
    console.error('Error reading PDF file:', error)
    throw error
  }
})

ipcMain.handle('pdf:saveThumbnail', async (_event, thumbnailDataArray: number[], pdfFileName: string) => {
  try {
    const thumbnailBuffer = Buffer.from(thumbnailDataArray)
    return await pdfService.saveThumbnail(thumbnailBuffer, pdfFileName)
  } catch (error) {
    console.error('Error saving thumbnail:', error)
    throw error
  }
})

ipcMain.handle('pdf:readThumbnail', async (_event, thumbnailPath: string) => {
  try {
    const buffer = await pdfService.readThumbnail(thumbnailPath)
    // Convert buffer to array for IPC transfer
    return Array.from(buffer)
  } catch (error) {
    console.error('Error reading thumbnail:', error)
    throw error
  }
})

ipcMain.handle('pdf:deleteThumbnail', async (_event, thumbnailPath: string) => {
  try {
    await pdfService.deleteThumbnail(thumbnailPath)
  } catch (error) {
    console.error('Error deleting thumbnail:', error)
    throw error
  }
})

ipcMain.handle('dialog:openPdfFile', async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Window Controls
ipcMain.handle('window:minimize', () => {
  if (win) {
    win.minimize()
  }
})

ipcMain.handle('window:maximize', () => {
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  }
})

ipcMain.handle('window:close', () => {
  if (win) {
    win.close()
  }
})
