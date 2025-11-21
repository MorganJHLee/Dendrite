import { useState, useEffect } from 'react'
import './App.css'
import Sidebar from './components/Sidebar'
import WhiteboardCanvas from './components/WhiteboardCanvas'
import GraphView from './components/GraphView'
import { NoteEditor } from './components/NoteEditor'
import CreateVaultModal from './components/CreateVaultModal'
import VaultSwitcher from './components/VaultSwitcher'
import { useVaultStore } from './store/vaultStore'
import { useVault } from './hooks/useVault'
import { ConfirmProvider } from './hooks/useConfirm'
import { Minus, Square, X, Grid3x3, Network } from 'lucide-react'

type View = 'whiteboard' | 'graph'

function App() {
  const [currentView, setCurrentView] = useState<View>('whiteboard')
  const [showCreateVaultModal, setShowCreateVaultModal] = useState(false)
  const { vaultPath, isLoading, editingNoteId, setEditingNoteId } = useVaultStore()

  // Hook to load vault data
  useVault()

  // Auto-open last opened vault
  useEffect(() => {
    const checkLastVault = async () => {
      const path = await window.electronAPI.getLastVault()
      if (path && !useVaultStore.getState().vaultPath) {
        useVaultStore.getState().setVaultPath(path)
      }
    }
    checkLastVault()
  }, [])

  const handleOpenVault = async () => {
    const path = await window.electronAPI.openDirectory()
    if (path) {
      useVaultStore.getState().setVaultPath(path)
      window.electronAPI.setLastVault(path)
    }
  }

  const handleSwitchVault = async (path: string) => {
    if (path && path !== vaultPath) {
      useVaultStore.getState().setVaultPath(path)
      window.electronAPI.setLastVault(path)
    }
  }

  return (
    <ConfirmProvider>
      <div className="app">
        <div className="toolbar">
          <VaultSwitcher
            currentVaultPath={vaultPath}
            onOpenVault={handleOpenVault}
            onCreateVault={() => setShowCreateVaultModal(true)}
            onSwitchVault={handleSwitchVault}
          />
          <div className="window-controls">
            <button
              className="window-control-btn minimize"
              onClick={() => window.electronAPI.minimizeWindow()}
              title="Minimize"
            >
              <Minus size={16} />
            </button>
            <button
              className="window-control-btn maximize"
              onClick={() => window.electronAPI.maximizeWindow()}
              title="Maximize"
            >
              <Square size={14} />
            </button>
            <button
              className="window-control-btn close"
              onClick={() => window.electronAPI.closeWindow()}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="main-layout">
          <Sidebar />
          <div className="content-area">
            {!vaultPath ? (
              <div className="welcome-screen">
                <h2>Welcome to Dendrite</h2>
                <p>Open a vault to get started</p>
                <div className="welcome-buttons">
                  <button
                    className="open-vault-btn"
                    onClick={handleOpenVault}
                  >
                    Open Existing Vault
                  </button>
                  <button
                    className="create-vault-btn"
                    onClick={() => setShowCreateVaultModal(true)}
                  >
                    Create New Vault
                  </button>
                </div>
              </div>
            ) : isLoading ? (
              <div className="welcome-screen">
                <h2>Loading vault...</h2>
              </div>
            ) : (
              <>
                {currentView === 'whiteboard' && <WhiteboardCanvas />}
                {currentView === 'graph' && <GraphView />}
              </>
            )}
          </div>

          {/* Floating View Switcher */}
          {vaultPath && (
            <div className="floating-view-switcher">
              <button
                className={`floating-view-btn ${currentView === 'whiteboard' ? 'active' : ''}`}
                onClick={() => setCurrentView('whiteboard')}
                title="Whiteboard View"
              >
                <Grid3x3 size={16} />
              </button>
              <button
                className={`floating-view-btn ${currentView === 'graph' ? 'active' : ''}`}
                onClick={() => setCurrentView('graph')}
                title="Graph View"
              >
                <Network size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Global Note Editor Modal */}
        {editingNoteId && (
          <NoteEditor noteId={editingNoteId} onClose={() => setEditingNoteId(null)} />
        )}

        {/* Create Vault Modal (from welcome screen) */}
        {showCreateVaultModal && (
          <CreateVaultModal
            onClose={() => setShowCreateVaultModal(false)}
            onCreateVault={async (parentPath, name) => {
              try {
                await window.electronAPI.createFolder(parentPath, name)
                const separator = parentPath.includes('\\') ? '\\' : '/'
                const newVaultPath = parentPath.endsWith(separator)
                  ? `${parentPath}${name}`
                  : `${parentPath}${separator}${name}`

                useVaultStore.getState().setVaultPath(newVaultPath)
                window.electronAPI.setLastVault(newVaultPath)
              } catch (error) {
                console.error('Error creating vault:', error)
                throw error
              }
            }}
          />
        )}
      </div>
    </ConfirmProvider>
  )
}

export default App
