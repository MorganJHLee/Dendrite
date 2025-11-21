import { useEffect, useRef } from 'react'
import { useVaultStore } from '../store/vaultStore'
import type { Note } from '../types'
import { isRenamingInternally, setRenameCompleteCallback, getNoteIdMapping, isInternalWrite } from '../components/NoteEditor'
import { initializeImageRegistry, cleanupUnusedImages } from '../services/imageService'

export function useVault() {
  const { vaultPath, setFiles, setNotes, setGraph, setIsLoading, setWhiteboards, setActiveWhiteboard } = useVaultStore()
  const watcherSetupRef = useRef(false)

  useEffect(() => {
    if (!vaultPath) return

    const loadVault = async () => {
      try {
        setIsLoading(true)

        // Read vault file structure
        const files = await window.electronAPI.readVault(vaultPath)
        setFiles(files)

        // Compute graph and get notes
        const { graph, notes } = await window.electronAPI.computeGraph(vaultPath)

        // Convert notes array to Map
        const notesMap = new Map<string, Note>()
        notes.forEach((note: Note) => {
          notesMap.set(note.id, note)
        })

        setNotes(notesMap)
        setGraph(graph)

        // Initialize image registry with current notes
        initializeImageRegistry(notesMap)
        console.log('Image registry initialized')

        // Initialize PDF service
        try {
          await window.electronAPI.pdfInitialize(vaultPath)
          console.log('PDF service initialized')
        } catch (error) {
          console.error('Error initializing PDF service:', error)
        }

        // Load whiteboard metadata
        try {
          const metadata = await window.electronAPI.loadMetadata(vaultPath)
          // Ensure pdfCards array exists for backwards compatibility
          const whiteboardsWithPdfCards = metadata.whiteboards.map((wb: any) => ({
            ...wb,
            pdfCards: wb.pdfCards || [],
            highlightCards: wb.highlightCards || [],
          }))
          setWhiteboards(whiteboardsWithPdfCards)
          setActiveWhiteboard(metadata.activeWhiteboardId || 'default')
        } catch (error) {
          console.error('Error loading metadata:', error)
          // Use defaults if metadata fails to load
          setWhiteboards([{
            id: 'default',
            name: 'Main Whiteboard',
            cards: [],
            arrows: [],
            groups: [],
            stickyNotes: [],
            textBoxes: [],
            pdfCards: [],
            highlightCards: [],
            createdAt: new Date(),
            modifiedAt: new Date(),
          }])
          setActiveWhiteboard('default')
        }
      } catch (error) {
        console.error('Error loading vault:', error)
      } finally {
        setIsLoading(false)
      }
    }

    // Set up the file watcher ONCE, outside of loadVault
    const setupWatcher = async () => {
      if (watcherSetupRef.current) return
      watcherSetupRef.current = true

      await window.electronAPI.watchVault(vaultPath, (eventType: string, filePath: string) => {
        console.log('File changed:', eventType, filePath)

        // Handle internal rename - ignore events during rename, will reload after
        if (isRenamingInternally()) {
          console.log('Internal rename in progress - event will be handled after rename completes')
          return
        }

        // Handle internal write (auto-save) - ignore to prevent vault reload and editor flash
        if (isInternalWrite(filePath)) {
          console.log('Internal write detected - skipping vault reload to prevent editor flash')
          return
        }

        // For all file changes (external or after rename completes), reload the vault
        loadVault()
      })
    }

    loadVault()
    setupWatcher()

    // Register callback when internal rename completes
    // Note: We don't reload the vault here because the note is already updated locally
    // in NoteEditor (updateNote + updateFileInTree), and reloading would cause editor flash
    setRenameCompleteCallback(() => {
      console.log('Rename complete - updating editingNoteId if needed')

      // Get the note ID mapping
      const mapping = getNoteIdMapping()

      // Update editingNoteId if the currently edited note was renamed
      const currentEditingNoteId = useVaultStore.getState().editingNoteId
      if (mapping && currentEditingNoteId === mapping.oldId) {
        console.log(`Updating editingNoteId: ${mapping.oldId} → ${mapping.newId}`)
        useVaultStore.getState().setEditingNoteId(mapping.newId)
      }
    })

    // Set up periodic cleanup of unused images (every 5 minutes)
    const cleanupInterval = setInterval(async () => {
      if (vaultPath) {
        try {
          const deletedCount = await cleanupUnusedImages(vaultPath)
          if (deletedCount > 0) {
            console.log(`Cleaned up ${deletedCount} unused images`)
          }
        } catch (error) {
          console.error('Error during image cleanup:', error)
        }
      }
    }, 5 * 60 * 1000) // 5 minutes

    return () => {
      watcherSetupRef.current = false
      window.electronAPI.unwatchVault()
      setRenameCompleteCallback(() => {}) // Clear callback
      clearInterval(cleanupInterval) // Clear cleanup interval
    }
  }, [vaultPath, setFiles, setNotes, setGraph, setIsLoading, setWhiteboards, setActiveWhiteboard])
}
