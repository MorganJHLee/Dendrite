import { useState } from 'react'
import { useVaultStore } from '../store/vaultStore'
import { getPdfInfo, generatePdfThumbnail, savePdfThumbnail } from '../services/pdfService'
import type { PdfCard } from '../types'
import './RenameModal.css'

interface AddPdfModalProps {
  whiteboardId: string
  onClose: () => void
}

export default function AddPdfModal({ whiteboardId, onClose }: AddPdfModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { vaultPath, addPdfCard } = useVaultStore()

  const handleFileSelect = async () => {
    if (!vaultPath) {
      setError('No vault path set')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Open file dialog
      const sourcePath = await window.electronAPI.openPdfFile()
      if (!sourcePath) {
        setIsLoading(false)
        return // User cancelled
      }

      // Import PDF to vault
      const importResult = await window.electronAPI.pdfImport(sourcePath)

      // Get PDF info (including page count)
      const pdfInfo = await getPdfInfo(importResult.pdfPath)

      // Generate thumbnail from first page
      const thumbnailDataUrl = await generatePdfThumbnail(importResult.pdfPath, 200, 300)

      // Save thumbnail to disk
      const thumbnailPath = await savePdfThumbnail(thumbnailDataUrl, importResult.fileName)

      // Create PDF card
      const pdfCard: PdfCard = {
        id: `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        whiteboardId,
        pdfPath: importResult.pdfPath,
        fileName: importResult.fileName,
        title: importResult.fileName.replace(/\.pdf$/i, ''),
        x: 100,
        y: 100,
        width: 250,
        height: 350,
        thumbnailPath,
        pageCount: pdfInfo.pageCount,
        fileSize: pdfInfo.fileSize,
        createdAt: new Date(),
        modifiedAt: new Date(),
      }

      // Add to store
      addPdfCard(pdfCard)

      // Persist to backend
      await window.electronAPI.saveMetadata({
        whiteboards: useVaultStore.getState().whiteboards,
        activeWhiteboardId: whiteboardId,
      })

      onClose()
    } catch (err) {
      console.error('Error adding PDF:', err)
      setError(err instanceof Error ? err.message : 'Failed to add PDF')
      setIsLoading(false)
    }
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add PDF to Whiteboard</h3>
        <p style={{ marginBottom: '20px', color: '#6b7280' }}>
          Select a PDF file to add to your whiteboard
        </p>

        {error && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        )}

        <div className="rename-modal-buttons">
          <button
            type="button"
            onClick={onClose}
            className="rename-cancel-btn"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFileSelect}
            className="rename-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? 'Importing...' : 'Select PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
