import { useEffect } from 'react'
import './ColorPickerModal.css'

interface ColorPickerModalProps {
  currentColor: string
  onSelectColor: (color: string) => void
  onClose: () => void
}

const COLORS = [
  { name: 'Blue', value: '#667eea' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Light Yellow', value: '#fef08a' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Gray', value: '#6b7280' },
]

export default function ColorPickerModal({ currentColor, onSelectColor, onClose }: ColorPickerModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSelectColor = (color: string) => {
    onSelectColor(color)
    onClose()
  }

  return (
    <div className="color-picker-backdrop" onClick={onClose}>
      <div className="color-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Choose Group Color</h3>
        <div className="color-grid">
          {COLORS.map((color) => (
            <button
              key={color.value}
              className={`color-option ${currentColor === color.value ? 'selected' : ''}`}
              style={{ backgroundColor: color.value }}
              onClick={() => handleSelectColor(color.value)}
              title={color.name}
            >
              {currentColor === color.value && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M16.6667 5L7.50004 14.1667L3.33337 10"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span className="color-name">{color.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
