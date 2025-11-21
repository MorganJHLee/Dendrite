import { useState, useEffect, useRef } from 'react'
import './RenameModal.css'

interface StickyNoteEditorModalProps {
  currentText?: string
  onSubmit: (text: string) => void
  onClose: () => void
}

export default function StickyNoteEditorModal({ currentText = '', onSubmit, onClose }: StickyNoteEditorModalProps) {
  const [text, setText] = useState(currentText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Focus and select the textarea when modal opens
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
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
    onSubmit(text.trim())
    onClose()
  }

  return (
    <div className="rename-modal-backdrop" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Sticky Note</h3>
        <form onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter sticky note text"
            className="rename-input sticky-note-textarea"
            rows={6}
          />
          <div className="rename-modal-buttons">
            <button type="button" onClick={onClose} className="rename-cancel-btn">
              Cancel
            </button>
            <button type="submit" className="rename-submit-btn">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
