import { useEffect, useRef } from 'react'
import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  danger?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to keep menu on screen
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      const menu = menuRef.current

      if (rect.right > window.innerWidth) {
        menu.style.left = `${x - rect.width}px`
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${y - rect.height}px`
      }
    }
  }, [x, y])

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 10000,
      }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.icon && <span className="context-menu-icon">{item.icon}</span>}
          <span className="context-menu-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
