import fs from 'fs/promises'
import path from 'path'
import { watch, FSWatcher } from 'chokidar'

export interface FileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export class FileSystemService {
  private watcher: FSWatcher | null = null
  private vaultPath: string | null = null

  async readVault(vaultPath: string): Promise<FileNode[]> {
    this.vaultPath = vaultPath
    return this.readDirectoryTree(vaultPath)
  }

  private async readDirectoryTree(dirPath: string): Promise<FileNode[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const nodes: FileNode[] = []

      for (const entry of entries) {
        // Skip hidden files and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue
        }

        const fullPath = path.join(dirPath, entry.name)
        const node: FileNode = {
          path: fullPath,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }

        if (entry.isDirectory()) {
          node.children = await this.readDirectoryTree(fullPath)
        }

        nodes.push(node)
      }

      return nodes.sort((a, b) => {
        // Directories first, then files
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
    } catch (error) {
      console.error('Error reading directory:', dirPath, error)
      return []
    }
  }

  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      console.error('Error reading file:', filePath, error)
      throw error
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      console.error('Error writing file:', filePath, error)
      throw error
    }
  }

  async createFile(filePath: string, content: string): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      // Write file
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      console.error('Error creating file:', filePath, error)
      throw error
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath)
      if (stat.isDirectory()) {
        await fs.rmdir(filePath, { recursive: true })
      } else {
        await fs.unlink(filePath)
      }
    } catch (error) {
      console.error('Error deleting file:', filePath, error)
      throw error
    }
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    try {
      // Ensure target directory exists
      const dir = path.dirname(newPath)
      await fs.mkdir(dir, { recursive: true })

      await fs.rename(oldPath, newPath)
    } catch (error) {
      console.error('Error renaming file:', oldPath, newPath, error)
      throw error
    }
  }

  async getAllMarkdownFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []

    const processDirectory = async (currentPath: string) => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true })

        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue

          const fullPath = path.join(currentPath, entry.name)

          if (entry.isDirectory()) {
            await processDirectory(fullPath)
          } else if (entry.name.endsWith('.md')) {
            files.push(fullPath)
          }
        }
      } catch (error) {
        console.error('Error processing directory:', currentPath, error)
      }
    }

    await processDirectory(dirPath)
    return files
  }

  watchVault(vaultPath: string, onChange: (event: string, path: string) => void): void {
    if (this.watcher) {
      this.watcher.close()
    }

    this.watcher = watch(vaultPath, {
      ignored: /(^|[\/\\])\../, // ignore hidden files
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher
      .on('add', (path) => onChange('add', path))
      .on('change', (path) => onChange('change', path))
      .on('unlink', (path) => onChange('unlink', path))
      .on('addDir', (path) => onChange('addDir', path))
      .on('unlinkDir', (path) => onChange('unlinkDir', path))
  }

  unwatchVault(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  async createFolder(vaultPath: string, folderName: string): Promise<void> {
    try {
      const folderPath = path.join(vaultPath, folderName)
      await fs.mkdir(folderPath, { recursive: true })
    } catch (error) {
      console.error('Error creating folder:', vaultPath, folderName, error)
      throw error
    }
  }

  async renameFolder(oldPath: string, newPath: string): Promise<void> {
    try {
      await fs.rename(oldPath, newPath)
    } catch (error) {
      console.error('Error renaming folder:', oldPath, newPath, error)
      throw error
    }
  }

  async deleteFolder(folderPath: string): Promise<void> {
    try {
      await fs.rm(folderPath, { recursive: true, force: true })
    } catch (error) {
      console.error('Error deleting folder:', folderPath, error)
      throw error
    }
  }

  async moveFile(oldPath: string, newFolderPath: string): Promise<string> {
    try {
      const fileName = path.basename(oldPath)
      const newPath = path.join(newFolderPath, fileName)

      await fs.rename(oldPath, newPath)

      return newPath
    } catch (error) {
      console.error('Error moving file:', oldPath, newFolderPath, error)
      throw error
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      console.error('Error ensuring directory:', dirPath, error)
      throw error
    }
  }

  async readDirectory(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries
        .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }))
    } catch (error) {
      console.error('Error reading directory:', dirPath, error)
      throw error
    }
  }

  async writeImageFile(filePath: string, base64Data: string): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      // Convert base64 to buffer and write
      const buffer = Buffer.from(base64Data, 'base64')
      await fs.writeFile(filePath, buffer)
    } catch (error) {
      console.error('Error writing image file:', filePath, error)
      throw error
    }
  }

  async readImageFile(filePath: string): Promise<string> {
    try {
      // Read the file as a buffer
      const buffer = await fs.readFile(filePath)

      // Convert to base64
      const base64 = buffer.toString('base64')

      // Detect mime type from file extension
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
      }
      const mimeType = mimeTypes[ext] || 'image/png'

      // Return as data URL
      return `data:${mimeType};base64,${base64}`
    } catch (error) {
      console.error('Error reading image file:', filePath, error)
      throw error
    }
  }
}
