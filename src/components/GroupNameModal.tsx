import { useState, useEffect, useRef } from 'react'
import './RenameModal.css'

interface GroupNameModalProps {
  currentName?: string
  title: string
  onSubmit: (name: string) => void
  onClose: () => void
}

export default function GroupNameModal({ currentName = 'New Group', title, onSubmit, onClose }: GroupNameModalProps) {
  const [name, setName] = useState(currentName)
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
    if (name.trim()) {
      onSubmit(name.trim())
    }
    onClose()
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter group name"
            className="rename-input"
          />
          <div className="rename-modal-buttons">
            <button type="button" onClick={onClose} className="rename-cancel-btn">
              Cancel
            </button>
            <button type="submit" className="rename-submit-btn">
              {currentName ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
