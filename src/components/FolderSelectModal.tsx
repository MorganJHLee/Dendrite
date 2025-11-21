import { useState, useEffect, useRef } from 'react'
import { Folder } from 'lucide-react'
import { useVaultStore } from '../store/vaultStore'
import type { VaultFile } from '../types'
import './RenameModal.css'

interface FolderSelectModalProps {
  onSelectFolder: (folderPath: string) => void
  onClose: () => void
}

export default function FolderSelectModal({ onSelectFolder, onClose }: FolderSelectModalProps) {
  const { files, vaultPath } = useVaultStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus the input when modal opens
    if (inputRef.current) {
      inputRef.current.focus()
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Recursively get all folders
  const getAllFolders = (fileList: VaultFile[], prefix = ''): { path: string; displayPath: string }[] => {
    const folders: { path: string; displayPath: string }[] = []

    for (const file of fileList) {
      if (file.type === 'directory') {
        const displayPath = prefix ? `${prefix}/${file.name}` : file.name
        folders.push({ path: file.path, displayPath })

        if (file.children) {
          folders.push(...getAllFolders(file.children, displayPath))
        }
      }
    }

    return folders
  }

  // Add root folder option
  const allFolders = [
    { path: vaultPath || '', displayPath: 'Root', isRoot: true },
    ...getAllFolders(files).map(f => ({ ...f, isRoot: false }))
  ]

  // Filter folders based on search query
  const filteredFolders = searchQuery
    ? allFolders.filter(f =>
        f.displayPath.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allFolders

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFolder !== null) {
      onSelectFolder(selectedFolder)
    }
    onClose()
  }

  const handleFolderClick = (folderPath: string) => {
    setSelectedFolder(folderPath)
  }

  const handleFolderDoubleClick = (folderPath: string) => {
    onSelectFolder(folderPath)
    onClose()
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div
        className="rename-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minHeight: '400px', maxHeight: '600px', width: '400px' }}
      >
        <h3>Move to Folder</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search folders..."
            className="rename-input"
            style={{ marginBottom: '12px' }}
          />

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              marginBottom: '16px',
              maxHeight: '400px'
            }}
          >
            {filteredFolders.map((folder: any) => (
              <div
                key={folder.path}
                onClick={() => handleFolderClick(folder.path)}
                onDoubleClick={() => handleFolderDoubleClick(folder.path)}
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  backgroundColor: selectedFolder === folder.path ? 'rgba(102, 126, 234, 0.1)' : 'transparent',
                  borderBottom: '1px solid var(--color-border)',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => {
                  if (selectedFolder !== folder.path) {
                    e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedFolder !== folder.path) {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }
                }}
              >
                {folder.isRoot && <Folder size={16} />}
                {folder.displayPath}
              </div>
            ))}
            {filteredFolders.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-dim)' }}>
                No folders found
              </div>
            )}
          </div>

          <div className="rename-modal-buttons">
            <button type="button" onClick={onClose} className="rename-cancel-btn">
              Cancel
            </button>
            <button
              type="submit"
              className="rename-submit-btn"
              disabled={selectedFolder === null}
              style={{ opacity: selectedFolder === null ? 0.5 : 1 }}
            >
              Move Here
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
