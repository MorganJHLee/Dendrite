import React, { useState } from 'react'
import { X, FolderPlus, FolderOpen, ArrowLeft } from 'lucide-react'
import './CreateVaultModal.css'

interface CreateVaultModalProps {
  onClose: () => void
  onCreateVault: (parentPath: string, vaultName: string) => Promise<void>
}

const CreateVaultModal: React.FC<CreateVaultModalProps> = ({ onClose, onCreateVault }) => {
  const [step, setStep] = useState<'select-parent' | 'name-vault'>('select-parent')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [vaultName, setVaultName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSelectParent = async () => {
    try {
      const path = await window.electronAPI.openDirectory()
      if (path) {
        setParentPath(path)
        setStep('name-vault')
      }
    } catch (error) {
      console.error('Error selecting directory:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parentPath || !vaultName.trim()) return

    setIsSubmitting(true)
    try {
      await onCreateVault(parentPath, vaultName)
      onClose()
    } catch (error) {
      console.error('Error creating vault:', error)
      alert('Failed to create vault')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content create-vault-modal">
        <div className="modal-header">
          <h3>Create New Vault</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {step === 'select-parent' ? (
          <div className="modal-body">
            <p className="modal-description">
              Choose a location where you want to create your new vault folder.
            </p>
            <button className="select-location-btn" onClick={handleSelectParent}>
              <FolderOpen size={18} />
              Select Location
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-body">
             <div className="selected-path-display">
                <span className="label">Location:</span>
                <span className="path" title={parentPath || ''}>{parentPath}</span>
             </div>
            <div className="input-group">
              <label htmlFor="vaultName">Vault Name</label>
              <input
                id="vaultName"
                type="text"
                value={vaultName}
                onChange={(e) => setVaultName(e.target.value)}
                placeholder="My New Vault"
                autoFocus
                required
              />
            </div>
            <div className="modal-actions">
               <button
                type="button"
                className="back-btn"
                onClick={() => setStep('select-parent')}
                disabled={isSubmitting}
              >
                <ArrowLeft size={16} />
                Back
              </button>
              <button type="submit" className="create-btn" disabled={isSubmitting}>
                <FolderPlus size={16} />
                Create Vault
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default CreateVaultModal
