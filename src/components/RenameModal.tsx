import { useState, useEffect, useRef } from 'react'
import './RenameModal.css'

interface RenameModalProps {
  currentName: string
  onRename: (newName: string) => void
  onClose: () => void
}

export default function RenameModal({ currentName, onRename, onClose }: RenameModalProps) {
  const [newName, setNewName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus and select the input when modal opens
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
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
    if (newName.trim() && newName !== currentName) {
      onRename(newName.trim())
    }
    onClose()
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Rename Note</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Enter new name"
            className="rename-input"
          />
          <div className="rename-modal-buttons">
            <button type="button" onClick={onClose} className="rename-cancel-btn">
              Cancel
            </button>
            <button type="submit" className="rename-submit-btn">
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
