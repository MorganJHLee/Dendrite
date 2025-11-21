import { useState, useEffect, useRef } from 'react'
import './RenameModal.css'

interface CreateWhiteboardModalProps {
  onCreateWhiteboard: (whiteboardName: string) => void
  onClose: () => void
}

export default function CreateWhiteboardModal({ onCreateWhiteboard, onClose }: CreateWhiteboardModalProps) {
  const [whiteboardName, setWhiteboardName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus the input when modal opens with multiple strategies for reliability
    // Note: Buttons are blurred with delay before modal opens (see Sidebar.tsx)

    // Strategy 1: Immediate focus attempt
    if (inputRef.current) {
      inputRef.current.focus()
    }

    // Strategy 2: Double requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      })
    })

    // Strategy 3: Delayed focus as fallback
    const focusTimeout = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 50)

    // Strategy 4: Extra delayed focus for stubborn cases
    const extraFocusTimeout = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 150)

    // Strategy 5: Very delayed focus for post-deletion cases
    const veryLateTimeout = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 300)

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      clearTimeout(focusTimeout)
      clearTimeout(extraFocusTimeout)
      clearTimeout(veryLateTimeout)
    }
  }, [onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (whiteboardName.trim()) {
      onCreateWhiteboard(whiteboardName.trim())
    }
    onClose()
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Ensure we blur any stale focus and don't interfere with the input
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Refocus the input if clicking within the modal
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  return (
    <div className="rename-modal-backdrop" onClick={handleBackdropClick}>
      <div className="rename-modal" onClick={handleModalClick}>
        <h3>Create New Whiteboard</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={whiteboardName}
            onChange={(e) => setWhiteboardName(e.target.value)}
            placeholder="Enter whiteboard name"
            className="rename-input"
            autoFocus
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
