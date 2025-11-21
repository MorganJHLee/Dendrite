import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'

export interface PdfInfo {
  fileName: string
  fileSize: number
  pageCount: number
  pdfPath: string
}

export class PdfService {
  private vaultPath: string | null = null

  setVaultPath(vaultPath: string) {
    this.vaultPath = vaultPath
  }

  private ensureVaultPath(): string {
    if (!this.vaultPath) {
      throw new Error('Vault path not set')
    }
    return this.vaultPath
  }

  private getPdfFolderPath(): string {
    return path.join(this.ensureVaultPath(), '.pdfs')
  }

  private getThumbnailFolderPath(): string {
    return path.join(this.ensureVaultPath(), '.attachments', 'pdf-thumbnails')
  }

  async initialize(): Promise<void> {
    const vaultPath = this.ensureVaultPath()

    // Create .pdfs folder
    const pdfFolder = this.getPdfFolderPath()
    await fs.mkdir(pdfFolder, { recursive: true })

    // Create .attachments/pdf-thumbnails folder
    const thumbnailFolder = this.getThumbnailFolderPath()
    await fs.mkdir(thumbnailFolder, { recursive: true })
  }

  async importPdf(sourcePath: string, fileName?: string): Promise<PdfInfo> {
    const pdfFolder = this.getPdfFolderPath()

    // Read source file
    const fileBuffer = await fs.readFile(sourcePath)
    const stats = await fs.stat(sourcePath)

    // Use provided filename or extract from source path
    const originalFileName = fileName || path.basename(sourcePath)

    // Check for duplicate and append timestamp if needed
    let finalFileName = originalFileName
    const destPath = path.join(pdfFolder, finalFileName)

    try {
      await fs.access(destPath)
      // File exists, append timestamp
      const ext = path.extname(originalFileName)
      const base = path.basename(originalFileName, ext)
      const timestamp = Date.now()
      finalFileName = `${base}-${timestamp}${ext}`
    } catch {
      // File doesn't exist, use original name
    }

    const finalDestPath = path.join(pdfFolder, finalFileName)

    // Copy file to .pdfs folder
    await fs.writeFile(finalDestPath, fileBuffer)

    // Note: Page count will be determined by frontend PDF.js
    // We'll return a placeholder value here
    return {
      fileName: finalFileName,
      fileSize: stats.size,
      pageCount: 0, // Will be updated by frontend
      pdfPath: finalDestPath,
    }
  }

  async getPdfInfo(pdfPath: string): Promise<PdfInfo> {
    try {
      const stats = await fs.stat(pdfPath)
      const fileName = path.basename(pdfPath)

      return {
        fileName,
        fileSize: stats.size,
        pageCount: 0, // Will be determined by frontend
        pdfPath,
      }
    } catch (error) {
      console.error('Error getting PDF info:', pdfPath, error)
      throw error
    }
  }

  async deletePdf(pdfPath: string): Promise<void> {
    try {
      await fs.unlink(pdfPath)
    } catch (error) {
      console.error('Error deleting PDF:', pdfPath, error)
      throw error
    }
  }

  async listPdfs(): Promise<string[]> {
    try {
      const pdfFolder = this.getPdfFolderPath()
      const files = await fs.readdir(pdfFolder)
      return files
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(f => path.join(pdfFolder, f))
    } catch (error) {
      console.error('Error listing PDFs:', error)
      return []
    }
  }

  async readPdfFile(pdfPath: string): Promise<Buffer> {
    try {
      return await fs.readFile(pdfPath)
    } catch (error) {
      console.error('Error reading PDF file:', pdfPath, error)
      throw error
    }
  }

  async saveThumbnail(thumbnailData: Buffer, pdfFileName: string): Promise<string> {
    const thumbnailFolder = this.getThumbnailFolderPath()

    // Generate thumbnail filename based on PDF filename
    const ext = path.extname(pdfFileName)
    const base = path.basename(pdfFileName, ext)
    const thumbnailFileName = `${base}.png`
    const thumbnailPath = path.join(thumbnailFolder, thumbnailFileName)

    await fs.writeFile(thumbnailPath, thumbnailData)

    return thumbnailPath
  }

  async readThumbnail(thumbnailPath: string): Promise<Buffer> {
    try {
      return await fs.readFile(thumbnailPath)
    } catch (error) {
      console.error('Error reading thumbnail:', thumbnailPath, error)
      throw error
    }
  }

  async deleteThumbnail(thumbnailPath: string): Promise<void> {
    try {
      await fs.unlink(thumbnailPath)
    } catch (error) {
      console.error('Error deleting thumbnail:', thumbnailPath, error)
      // Don't throw - thumbnail deletion is not critical
    }
  }
}

export const pdfService = new PdfService()
