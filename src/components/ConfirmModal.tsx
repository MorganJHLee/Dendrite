import { useEffect } from 'react'
import './ConfirmModal.css'

interface ConfirmModalProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
  isDanger?: boolean
}

export default function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDanger = false
}: ConfirmModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    const handleEnter = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        onConfirm()
      }
    }

    document.addEventListener('keydown', handleEscape)
    document.addEventListener('keydown', handleEnter)

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('keydown', handleEnter)
    }
  }, [onCancel, onConfirm])

  return (
    <div className="confirm-modal-backdrop" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-content">
          <p>{message}</p>
        </div>
        <div className="confirm-modal-buttons">
          <button
            type="button"
            onClick={onCancel}
            className="confirm-cancel-btn"
            autoFocus
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`confirm-confirm-btn ${isDanger ? 'danger' : ''}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
