import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check, FolderOpen, Plus, History } from 'lucide-react'
import './VaultSwitcher.css'

interface VaultSwitcherProps {
  currentVaultPath: string | null
  onOpenVault: () => void
  onCreateVault: () => void
  onSwitchVault: (path: string) => void
}

const VaultSwitcher: React.FC<VaultSwitcherProps> = ({
  currentVaultPath,
  onOpenVault,
  onCreateVault,
  onSwitchVault
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [recentVaults, setRecentVaults] = useState<string[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchRecentVaults = async () => {
      try {
        const vaults = await window.electronAPI.getRecentVaults()
        setRecentVaults(vaults || [])
      } catch (error) {
        console.error('Error fetching recent vaults:', error)
      }
    }

    if (isOpen) {
      fetchRecentVaults()
    }
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const getVaultName = (path: string) => {
    const separator = path.includes('\\') ? '\\' : '/'
    const parts = path.split(separator)
    return parts[parts.length - 1] || path
  }

  const handleSwitch = (path: string) => {
    onSwitchVault(path)
    setIsOpen(false)
  }

  const currentVaultName = currentVaultPath ? getVaultName(currentVaultPath) : 'Dendrite'

  return (
    <div className="vault-switcher" ref={dropdownRef}>
      <button
        className={`vault-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={currentVaultPath || 'No vault open'}
      >
        <span className="vault-name">{currentVaultName}</span>
        <ChevronDown size={14} className="chevron" />
      </button>

      {isOpen && (
        <div className="vault-dropdown">
          {recentVaults.length > 0 && (
            <>
              <div className="dropdown-section-label">Recent Vaults</div>
              {recentVaults.map((path) => (
                <button
                  key={path}
                  className={`dropdown-item ${path === currentVaultPath ? 'active' : ''}`}
                  onClick={() => handleSwitch(path)}
                  title={path}
                >
                  <History size={14} className="icon" />
                  <span>{getVaultName(path)}</span>
                  {path === currentVaultPath && <Check size={14} />}
                </button>
              ))}
              <div className="dropdown-divider" />
            </>
          )}

          <button
            className="dropdown-item"
            onClick={() => {
              onOpenVault()
              setIsOpen(false)
            }}
          >
            <FolderOpen size={14} className="icon" />
            <span>Open another vault...</span>
          </button>

          <button
            className="dropdown-item"
            onClick={() => {
              onCreateVault()
              setIsOpen(false)
            }}
          >
            <Plus size={14} className="icon" />
            <span>Create new vault...</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default VaultSwitcher
