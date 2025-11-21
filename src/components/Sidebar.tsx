import { useState, useEffect, useRef } from 'react'
import { FolderPlus, Plus, Trash2, LayoutGrid, Edit2, ChevronDown, Vault } from 'lucide-react'
import './Sidebar.css'
import { useVaultStore } from '../store/vaultStore'
import FileTree from './FileTree'
import CreateFolderModal from './CreateFolderModal'
import CreateWhiteboardModal from './CreateWhiteboardModal'
import RenameWhiteboardModal from './RenameWhiteboardModal'
import { useConfirm } from '../hooks/useConfirm'
import type { VaultFile } from '../types'

function Sidebar() {
  const {
    vaultPath,
    files,
    notes,
    selectedNoteId,
    setSelectedNoteId,
    setEditingNoteId,
    setFiles,
    whiteboards,
    activeWhiteboardId,
    setActiveWhiteboard,
    addWhiteboard,
    deleteWhiteboard
  } = useVaultStore()
  const { confirm } = useConfirm()
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false)
  const [showCreateWhiteboardModal, setShowCreateWhiteboardModal] = useState(false)
  const [renameWhiteboardId, setRenameWhiteboardId] = useState<string | null>(null)

  // Dropdowns
  const [isWhiteboardDropdownOpen, setIsWhiteboardDropdownOpen] = useState(false)

  const whiteboardDropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (whiteboardDropdownRef.current && !whiteboardDropdownRef.current.contains(event.target as Node)) {
        setIsWhiteboardDropdownOpen(false)
      }
    }

    if (isWhiteboardDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isWhiteboardDropdownOpen])

  if (!vaultPath) {
    return null
  }

  const renameWhiteboard = whiteboards.find(w => w.id === renameWhiteboardId)

  const handleSelectFile = (file: VaultFile) => {
    // Extract note ID from file path (same logic as MarkdownParser.getNoteId)
    let noteId = file.path
    if (vaultPath) {
      // Remove vault path prefix
      if (noteId.startsWith(vaultPath)) {
        noteId = noteId.substring(vaultPath.length)
      }
    }
    // Remove leading path separators (both / and \)
    noteId = noteId.replace(/^[/\\]+/, '')
    // Remove .md extension
    noteId = noteId.replace(/\.md$/, '')
    // Normalize path separators to forward slashes
    noteId = noteId.replace(/\\/g, '/')

    setSelectedNoteId(noteId)

    // Dispatch custom event to notify other components (like Canvas)
    // that a note was selected from the sidebar
    const event = new CustomEvent('sidebar-note-selected', {
      detail: { noteId }
    })
    window.dispatchEvent(event)
  }

  const handleEditFile = (file: VaultFile) => {
    // Extract note ID from file path (same logic as MarkdownParser.getNoteId)
    let noteId = file.path
    if (vaultPath) {
      // Remove vault path prefix
      if (noteId.startsWith(vaultPath)) {
        noteId = noteId.substring(vaultPath.length)
      }
    }
    // Remove leading path separators (both / and \)
    noteId = noteId.replace(/^[/\\]+/, '')
    // Remove .md extension
    noteId = noteId.replace(/\.md$/, '')
    // Normalize path separators to forward slashes
    noteId = noteId.replace(/\\/g, '/')

    setEditingNoteId(noteId)
  }

  const handleCreateFolder = async (folderName: string) => {
    if (!vaultPath) return

    try {
      await window.electronAPI.createFolder(vaultPath, folderName)
      // Refresh the file tree
      const updatedFiles = await window.electronAPI.readVault(vaultPath)
      setFiles(updatedFiles)
    } catch (error) {
      console.error('Error creating folder:', error)
      alert('Failed to create folder')
    }
  }

  const handleCreateNote = async () => {
    if (!vaultPath) return

    // Find next available "New Note" name
    const existingNames = Array.from(notes.values()).map(note =>
      note.name.replace(/\.md$/, '')
    )

    let fileName: string
    if (!existingNames.includes('New Note')) {
      fileName = 'New Note.md'
    } else {
      // Find the next available number
      let num = 1
      while (existingNames.includes(`New Note ${num}`)) {
        num++
      }
      fileName = `New Note ${num}.md`
    }

    const filePath = `${vaultPath}/${fileName}`
    const content = ''

    try {
      // Create the file - do NOT add it to any whiteboard
      await window.electronAPI.createFile(filePath, content)

      // Compute the note ID
      const noteId = filePath
        .replace(vaultPath, '')
        .replace(/^[\\\/]/, '')
        .replace(/\.md$/, '')
        .replace(/\\/g, '/')

      // Wait for the note to be loaded into the store, then open it for editing
      let retries = 0
      const maxRetries = 20 // 2 seconds max (20 * 100ms)
      const checkInterval = setInterval(() => {
        const loadedNote = useVaultStore.getState().notes.get(noteId)
        if (loadedNote) {
          clearInterval(checkInterval)
          // Open the note for editing
          setEditingNoteId(noteId)
        } else if (retries >= maxRetries) {
          clearInterval(checkInterval)
          console.error('Timeout waiting for note to load:', noteId)
        }
        retries++
      }, 100)
    } catch (error) {
      console.error('Error creating note:', error)
      alert('Failed to create note')
    }
  }

  const handleCreateWhiteboard = async (whiteboardName: string) => {
    if (!vaultPath) return

    const newWhiteboard = {
      id: `whiteboard-${Date.now()}`,
      name: whiteboardName,
      cards: [],
      arrows: [],
      groups: [],
      stickyNotes: [],
      textBoxes: [],
      pdfCards: [],
      highlightCards: [],
      createdAt: new Date(),
      modifiedAt: new Date()
    }

    addWhiteboard(newWhiteboard)
    setActiveWhiteboard(newWhiteboard.id)

    // Persist to metadata file
    try {
      await window.electronAPI.saveMetadata({
        version: '1.0',
        whiteboards: [...whiteboards, newWhiteboard],
        activeWhiteboardId: newWhiteboard.id
      })
    } catch (error) {
      console.error('Error saving whiteboard metadata:', error)
      alert('Failed to save whiteboard')
    }
  }

  const handleRenameWhiteboard = async (whiteboardId: string, newName: string) => {
    if (!vaultPath) return

    // Update the whiteboard name in the store
    const updatedWhiteboards = whiteboards.map(w =>
      w.id === whiteboardId ? { ...w, name: newName, modifiedAt: new Date() } : w
    )

    // Update the store (we need to manually update since there's no renameWhiteboard action)
    useVaultStore.setState({ whiteboards: updatedWhiteboards })

    // Persist to metadata file
    try {
      await window.electronAPI.saveMetadata({
        version: '1.0',
        whiteboards: updatedWhiteboards,
        activeWhiteboardId
      })
    } catch (error) {
      console.error('Error saving whiteboard metadata:', error)
      alert('Failed to rename whiteboard')
    }
  }

  const handleDeleteWhiteboard = async (whiteboardId: string) => {
    if (!vaultPath) return

    // Prevent deleting the last whiteboard
    if (whiteboards.length <= 1) {
      alert('Cannot delete the last whiteboard')
      return
    }

    const confirmed = await confirm({
      message: 'Are you sure you want to delete this whiteboard?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true
    })

    if (!confirmed) {
      return
    }

    deleteWhiteboard(whiteboardId)

    // Get the updated whiteboards after deletion
    const updatedWhiteboards = whiteboards.filter(w => w.id !== whiteboardId)
    const newActiveId = whiteboardId === activeWhiteboardId && updatedWhiteboards.length > 0
      ? updatedWhiteboards[0].id
      : activeWhiteboardId

    // Persist to metadata file
    try {
      await window.electronAPI.saveMetadata({
        version: '1.0',
        whiteboards: updatedWhiteboards,
        activeWhiteboardId: newActiveId
      })
    } catch (error) {
      console.error('Error saving whiteboard metadata:', error)
      alert('Failed to delete whiteboard')
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Whiteboards</h3>
        <div className="header-buttons">
          <button
            className="btn-icon"
            onClick={(e) => {
              // Blur the button to prevent focus interference with modal
              if (e.currentTarget instanceof HTMLElement) {
                e.currentTarget.blur()
              }
              // Add delay to ensure blur completes before modal opens
              setTimeout(() => {
                setShowCreateWhiteboardModal(true)
              }, 50)
            }}
            title="New Whiteboard"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="whiteboard-dropdown-container" ref={whiteboardDropdownRef}>
        <button
          className="whiteboard-dropdown-trigger"
          onClick={() => setIsWhiteboardDropdownOpen(!isWhiteboardDropdownOpen)}
        >
          <LayoutGrid size={16} />
          <span className="whiteboard-current-name">
            {whiteboards.find(w => w.id === activeWhiteboardId)?.name || 'Select Whiteboard'}
          </span>
          <ChevronDown size={16} className={`dropdown-chevron ${isWhiteboardDropdownOpen ? 'open' : ''}`} />
        </button>

        {isWhiteboardDropdownOpen && (
          <div className="whiteboard-dropdown-menu">
            {whiteboards.map((whiteboard) => (
              <div
                key={whiteboard.id}
                className={`whiteboard-dropdown-item ${whiteboard.id === activeWhiteboardId ? 'active' : ''}`}
                onClick={() => {
                  setActiveWhiteboard(whiteboard.id)
                  setIsWhiteboardDropdownOpen(false)
                  // Persist active whiteboard change
                  window.electronAPI.saveMetadata({
                    version: '1.0',
                    whiteboards,
                    activeWhiteboardId: whiteboard.id
                  }).catch((error: unknown) => {
                    console.error('Error saving active whiteboard:', error)
                  })
                }}
              >
                <LayoutGrid size={14} />
                <span className="whiteboard-name">{whiteboard.name}</span>
                <div className="whiteboard-actions">
                  <button
                    className="btn-icon-small"
                    onClick={(e) => {
                      e.stopPropagation()
                      // Blur the button to prevent focus interference with modal
                      if (e.currentTarget instanceof HTMLElement) {
                        e.currentTarget.blur()
                      }
                      // Add delay to ensure blur completes before modal opens
                      setTimeout(() => {
                        setRenameWhiteboardId(whiteboard.id)
                      }, 50)
                    }}
                    title="Rename Whiteboard"
                  >
                    <Edit2 size={12} />
                  </button>
                  {whiteboards.length > 1 && (
                    <button
                      className="btn-icon-small"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteWhiteboard(whiteboard.id)
                      }}
                      title="Delete Whiteboard"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-header">
        <h3>Files</h3>
        <div className="header-buttons">
          <button
            className="btn-icon"
            onClick={handleCreateNote}
            title="New Note"
          >
            <Plus size={18} />
          </button>
          <button
            className="btn-icon"
            onClick={() => setShowCreateFolderModal(true)}
            title="New Folder"
          >
            <FolderPlus size={18} />
          </button>
        </div>
      </div>

      <div className="search-box">
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="file-tree-container">
        <FileTree files={files} selectedNoteId={selectedNoteId} vaultPath={vaultPath} onSelectFile={handleSelectFile} onEditFile={handleEditFile} searchQuery={searchQuery} />
      </div>

      {showCreateFolderModal && (
        <CreateFolderModal
          onCreateFolder={handleCreateFolder}
          onClose={() => setShowCreateFolderModal(false)}
        />
      )}

      {showCreateWhiteboardModal && (
        <CreateWhiteboardModal
          onCreateWhiteboard={handleCreateWhiteboard}
          onClose={() => setShowCreateWhiteboardModal(false)}
        />
      )}

      {renameWhiteboardId && renameWhiteboard && (
        <RenameWhiteboardModal
          currentName={renameWhiteboard.name}
          onRenameWhiteboard={(newName) => handleRenameWhiteboard(renameWhiteboardId, newName)}
          onClose={() => setRenameWhiteboardId(null)}
        />
      )}
    </div>
  )
}

export default Sidebar
