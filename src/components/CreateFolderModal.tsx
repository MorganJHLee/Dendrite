import { useState, useEffect, useRef } from 'react'
import './RenameModal.css'

interface CreateFolderModalProps {
  onCreateFolder: (folderName: string) => void
  onClose: () => void
}

export default function CreateFolderModal({ onCreateFolder, onClose }: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState('')
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (folderName.trim()) {
      onCreateFolder(folderName.trim())
    }
    onClose()
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create New Folder</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Enter folder name"
            className="rename-input"
          />
          <div className="rename-modal-buttons">
            <button type="button" onClick={onClose} className="rename-cancel-btn">
              Cancel
            </button>
            <button type="submit" className="rename-submit-btn">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
