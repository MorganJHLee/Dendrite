import React, { useState, useEffect, useRef } from 'react'
import { MoreHorizontal, Maximize2, X, Folder, Trash2 } from 'lucide-react'
import { useVaultStore } from '../store/vaultStore'
import type { Note } from '../types'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { createWYSIWYGExtensions, setWikilinkClickHandler, setImagePasteHandler, setVaultPath } from './wysiwygEditor'
import { savePastedImage, scanNoteForImages } from '../services/imageService'
import { useConfirm } from '../hooks/useConfirm'
import ContextMenu from './ContextMenu'
import FolderSelectModal from './FolderSelectModal'
import LocalGraphVisualization from './LocalGraphVisualization'
import './NoteEditor.css'

// Callback to notify when rename completes
let onRenameComplete: (() => void) | null = null

export function setRenameCompleteCallback(callback: () => void) {
  onRenameComplete = callback
}

interface NoteEditorProps {
  noteId: string
  onClose: () => void
}

// Counter to track concurrent rename operations
// Using a counter instead of boolean to handle overlapping renames
let activeRenameCount = 0

// Helper to check if any rename is in progress
export function isRenamingInternally() {
  return activeRenameCount > 0
}

// Track internal writes (auto-saves) to prevent vault reload
let internalWriteTimestamps = new Map<string, number>()

// Helper to check if a file path has a recent internal write
export function isInternalWrite(filePath: string): boolean {
  const timestamp = internalWriteTimestamps.get(filePath)
  if (!timestamp) return false

  const now = Date.now()
  const isRecent = now - timestamp < 1000 // Within 1 second

  // Clean up old timestamps
  if (!isRecent) {
    internalWriteTimestamps.delete(filePath)
  }

  return isRecent
}

// Helper to mark a file path as being written internally
function markInternalWrite(filePath: string) {
  internalWriteTimestamps.set(filePath, Date.now())

  // Clean up after 2 seconds
  setTimeout(() => {
    internalWriteTimestamps.delete(filePath)
  }, 2000)
}

// Store pending rename info so vault watcher can update sidebar
let pendingRename: { oldPath: string; newPath: string; newName: string } | null = null

// Helper to get pending rename info
export function getPendingRename() {
  return pendingRename
}

// Track old→new note ID mapping for updating editingNoteId
let noteIdMapping: { oldId: string; newId: string } | null = null

// Helper to get and clear note ID mapping
export function getNoteIdMapping() {
  const mapping = noteIdMapping
  noteIdMapping = null // Clear after reading
  return mapping
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ noteId, onClose }) => {
  const { notes, updateNote, updateFileInTree, vaultPath, setEditingNoteId, setSelectedNoteId, deleteNote, isLoading } = useVaultStore()
  const { confirm } = useConfirm()
  const note = notes.get(noteId)
  const [noteLoadAttempts, setNoteLoadAttempts] = useState(0)

  // Keep a stable reference to the last known good note to prevent editor issues during vault reloads
  const lastKnownNoteRef = useRef<Note | null>(note || null)
  if (note && !isLoading) {
    lastKnownNoteRef.current = note
  }

  const [content, setContent] = useState(note?.content || '')
  const [title, setTitle] = useState(note?.title || '')
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const [showFolderSelectModal, setShowFolderSelectModal] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // Set up wikilink click handler to navigate to linked notes
  useEffect(() => {
    setWikilinkClickHandler((linkText: string) => {
      // Find the note by link text (same logic as GraphService.findNoteByLink)
      const normalizedLink = linkText.replace(/\.md$/, '').replace(/\\/g, '/')

      // Try exact match first
      let targetNote = notes.get(normalizedLink)

      // Try finding by name (case-insensitive)
      if (!targetNote) {
        const linkName = normalizedLink.toLowerCase()
        for (const note of notes.values()) {
          if (note.name.toLowerCase() === linkName || note.title.toLowerCase() === linkName) {
            targetNote = note
            break
          }
        }
      }

      if (targetNote) {
        // Navigate to the linked note
        setEditingNoteId(targetNote.id)
        setSelectedNoteId(targetNote.id)
      } else {
        console.warn('Note not found for wikilink:', linkText)
      }
    })
  }, [notes, setEditingNoteId, setSelectedNoteId])

  // Set vault path for image resolution
  useEffect(() => {
    setVaultPath(vaultPath)
  }, [vaultPath])

  // Set up image paste handler to save pasted images
  useEffect(() => {
    if (!vaultPath || !noteId) return

    setImagePasteHandler(async (imageBlob: Blob) => {
      if (!vaultPath) {
        throw new Error('Vault path not set')
      }
      const filename = await savePastedImage(imageBlob, vaultPath, noteId)
      return filename
    })
  }, [vaultPath, noteId])
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const renameTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const previousNoteIdRef = useRef<string | null>(null)
  const lastRenameTimestampRef = useRef<number>(0)

  useEffect(() => {
    if (note) {
      setContent(note.content)
      setTitle(note.title)
    } else {
      // If note is not available yet, retry a few times
      // This handles cases where the editor opens before vault reload completes
      if (noteLoadAttempts < 10) {
        const timer = setTimeout(() => {
          setNoteLoadAttempts(prev => prev + 1)
        }, 200)
        return () => clearTimeout(timer)
      }
    }
  }, [note, noteLoadAttempts])

  // Initialize CodeMirror editor when note data becomes available
  useEffect(() => {
    if (!editorContainerRef.current) return
    if (editorRef.current) return // Don't recreate if already exists
    if (!note) return // Wait for note data to be available

    const startState = EditorState.create({
      doc: note.content || '',
      extensions: [
        ...createWYSIWYGExtensions(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString()
            setContent(newContent)
          }
        }),
      ],
    })

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current,
    })

    editorRef.current = view
    console.log('CodeMirror editor initialized')

    // Move cursor to end of document to avoid interfering with first-line element rendering
    // When cursor is at position 0, first-line elements don't render (they show raw markdown)
    setTimeout(() => {
      const docLength = view.state.doc.length
      view.dispatch({
        selection: { anchor: docLength, head: docLength },
      })
    }, 0)
  }, [note]) // Only depend on note availability, guard prevents recreation

  // Cleanup editor only on component unmount
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        console.log('Destroying CodeMirror editor')
        editorRef.current.destroy()
        editorRef.current = null
      }
    }
  }, []) // Empty array - cleanup only on unmount

  // Update editor content when note changes
  useEffect(() => {
    // Skip updates during vault reload to prevent editor from becoming unresponsive
    if (isLoading) {
      console.log('Skipping editor update - vault is reloading')
      return
    }

    if (!editorRef.current || !note) return

    const editorContent = editorRef.current.state.doc.toString()
    const noteContent = note.content
    const currentNoteId = note.id
    const now = Date.now()

    // Check if we're within 2 seconds of a rename operation
    const isWithinRenameWindow = now - lastRenameTimestampRef.current < 2000

    // Detect note ID change (either switching notes or rename)
    const noteIdChanged = previousNoteIdRef.current !== null && previousNoteIdRef.current !== currentNoteId

    if (noteIdChanged) {
      console.log(`Note ID changed: ${previousNoteIdRef.current} → ${currentNoteId}`)

      // If within rename window and content matches, skip update
      if (isWithinRenameWindow && editorContent && editorContent === noteContent) {
        console.log('Skipping editor update - within rename window and content matches')
        previousNoteIdRef.current = currentNoteId
        return
      }
    }

    // If within rename window and content is similar (only frontmatter might differ), skip update
    if (isWithinRenameWindow && editorContent && noteContent) {
      // Remove frontmatter from both for comparison
      const stripFrontmatter = (content: string) => {
        return content.replace(/^---\n[\s\S]*?\n---\n/, '')
      }
      const editorBody = stripFrontmatter(editorContent)
      const noteBody = stripFrontmatter(noteContent)

      if (editorBody === noteBody) {
        console.log('Skipping editor update - within rename window, only frontmatter differs')
        previousNoteIdRef.current = currentNoteId
        return
      }
    }

    // Update previousNoteIdRef for next comparison
    previousNoteIdRef.current = currentNoteId

    // Only update if the note content differs from editor content
    if (noteContent !== editorContent) {
      // Safety check: never clear a non-empty editor with empty/undefined content
      // This prevents the editor from going blank during note ID transitions or race conditions
      if (!noteContent && editorContent) {
        console.warn('Prevented editor clear: noteContent is empty but editor has content')
        return
      }

      console.log('Updating editor from note content')
      const transaction = editorRef.current.state.update({
        changes: {
          from: 0,
          to: editorRef.current.state.doc.length,
          insert: noteContent || '',
        },
      })
      editorRef.current.dispatch(transaction)
    }
  }, [note, isLoading])

  // Auto-save functionality
  useEffect(() => {
    if (!note) return

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    // Set new timeout for auto-save (1 second after typing stops)
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleAutoSave()
    }, 1000)

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
      }
    }
  }, [content])

  const handleAutoSave = async () => {
    if (!note) return

    // Get current content from editor (source of truth)
    const currentContent = editorRef.current?.state.doc.toString() || content

    // Skip if content hasn't changed
    if (currentContent === note.content) return

    setIsSaving(true)
    try {
      // Prepare frontmatter with current title
      const frontmatter = {
        ...(note.frontmatter || {}),
        title: title,
      }

      // Combine frontmatter + content for file writing
      const fileContent = serializeWithFrontmatter(currentContent, frontmatter)

      // Mark this as an internal write to prevent vault reload
      markInternalWrite(note.path)

      // Save to file system (with frontmatter) - MUST succeed before updating store
      await window.electronAPI.writeFile(note.path, fileContent)

      // Re-parse content to extract wikilinks
      const extractedLinks = extractWikilinksFromContent(currentContent)

      // Update store with content only (no frontmatter), updated frontmatter, and extracted links
      updateNote(noteId, {
        content: currentContent,
        frontmatter: frontmatter,
        links: extractedLinks,
        title: title,
      })

      // Scan for images to update usage tracking
      scanNoteForImages(noteId, currentContent)

      // Recompute backlinks for all notes after links change
      recomputeBacklinks()

      // Rebuild graph to reflect changes
      rebuildGraph()

      // Only update UI state if save was successful
      setContent(currentContent)
      setLastSaved(new Date())
    } catch (error) {
      console.error('Error auto-saving note:', error)
      // Don't update lastSaved or content state on error
      // User will still see their changes in the editor, but won't see false "Saved" message
      alert(`Failed to save note: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSaving(false)
    }
  }

  // Helper function to extract wikilinks from content
  const extractWikilinksFromContent = (content: string): string[] => {
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g
    const links: string[] = []
    let match

    while ((match = wikilinkRegex.exec(content)) !== null) {
      let link = match[1]

      // Remove alias if present (link|alias)
      if (link.includes('|')) {
        link = link.split('|')[0]
      }

      // Remove heading anchor if present (link#heading)
      if (link.includes('#')) {
        link = link.split('#')[0]
      }

      link = link.trim()
      if (link && !links.includes(link)) {
        links.push(link)
      }
    }

    return links
  }

  // Helper function to recompute backlinks for all notes
  const recomputeBacklinks = () => {
    // Get fresh data from store (not from stale hook closure)
    const currentNotes = useVaultStore.getState().notes

    // Create a new Map with cloned Note objects to maintain immutability
    const allNotes = new Map<string, Note>()

    // First pass: clone all notes with empty backlinks
    for (const [id, note] of currentNotes.entries()) {
      allNotes.set(id, {
        ...note,
        backlinks: [], // Reset backlinks
      })
    }

    // Second pass: compute backlinks
    for (const note of allNotes.values()) {
      for (const link of note.links) {
        // Find the target note
        const targetNote = findNoteByLink(link, allNotes)
        if (targetNote && targetNote.id !== note.id) {
          if (!targetNote.backlinks.includes(note.id)) {
            // Create a new note object with updated backlinks (immutable update)
            const updatedTarget = {
              ...targetNote,
              backlinks: [...targetNote.backlinks, note.id],
            }
            allNotes.set(targetNote.id, updatedTarget)
          }
        }
      }
    }

    // Update all notes in the store with the new Map
    useVaultStore.getState().setNotes(allNotes)
  }

  // Helper function to find a note by wikilink
  const findNoteByLink = (link: string, notesMap: Map<string, Note>): Note | undefined => {
    const normalizedLink = link.replace(/\.md$/, '').replace(/\\/g, '/')

    // Try exact match first
    let targetNote = notesMap.get(normalizedLink)
    if (targetNote) return targetNote

    // Try finding by name (case-insensitive)
    const linkName = normalizedLink.toLowerCase()
    for (const note of notesMap.values()) {
      if (note.name.toLowerCase() === linkName || note.title.toLowerCase() === linkName) {
        return note
      }
    }

    return undefined
  }

  // Helper function to rebuild the graph
  const rebuildGraph = () => {
    // Get fresh data from store (not from stale hook closure)
    const allNotes = useVaultStore.getState().notes
    const graphNodes: any[] = []
    const graphEdges: any[] = []
    const edgeSet = new Set<string>()

    for (const note of allNotes.values()) {
      // Add node with current title
      graphNodes.push({
        id: note.id,
        label: note.title,
        data: note,
      })

      // Add edges for links
      for (const link of note.links) {
        const targetNote = findNoteByLink(link, allNotes)
        if (targetNote && targetNote.id !== note.id) {
          const edgeKey = `${note.id}->${targetNote.id}`
          if (!edgeSet.has(edgeKey)) {
            graphEdges.push({
              source: note.id,
              target: targetNote.id,
              type: 'link',
            })
            edgeSet.add(edgeKey)
          }
        }
      }
    }

    // Update graph in store
    useVaultStore.getState().setGraph({
      nodes: graphNodes,
      edges: graphEdges,
    })
  }

  // Helper function to serialize content with frontmatter for file writing
  // This keeps frontmatter separate from editor content but combines them for disk storage
  const serializeWithFrontmatter = (content: string, frontmatter: Record<string, any>): string => {
    // If frontmatter is empty, just return content
    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      return content
    }

    // Build frontmatter YAML
    const frontmatterLines = Object.entries(frontmatter).map(([key, value]) => {
      // Handle different value types
      if (typeof value === 'string') {
        return `${key}: ${value}`
      } else if (Array.isArray(value)) {
        return `${key}: [${value.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]`
      } else {
        return `${key}: ${JSON.stringify(value)}`
      }
    })

    return `---\n${frontmatterLines.join('\n')}\n---\n${content}`
  }

  // Handle title changes and file rename when title input loses focus
  const handleTitleBlur = async (immediate = false) => {
    if (!note || title === note.title || !vaultPath) return

    // Clear existing rename timeout
    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    // Return a promise that resolves when rename completes
    return new Promise<void>((resolve) => {
      const executeRename = async () => {
        try {
        // Increment counter to track this rename operation
        activeRenameCount++
        console.log(`Rename started (active count: ${activeRenameCount})`)

        // Get current content from editor (source of truth) instead of state
        // This prevents race conditions where state hasn't updated yet
        if (!editorRef.current) {
          console.error('Editor ref is null during title change')
          activeRenameCount--
          resolve()
          return
        }

        const currentContent = editorRef.current.state.doc.toString()

        // Safety check: ensure we have content
        if (!currentContent && note.content) {
          console.warn('Editor is empty but note has content - using note content')
        }

        // Use editor content if available, otherwise fallback to note content
        // Allow empty strings as valid content (for blank notes)
        const contentToUse = currentContent !== undefined ? currentContent : note.content
        if (contentToUse === undefined || contentToUse === null) {
          console.error('No content available to save')
          activeRenameCount--
          resolve()
          return
        }

        // Prepare frontmatter with updated title
        const updatedFrontmatter = {
          ...(note.frontmatter || {}),
          title: title,
        }

        // Combine frontmatter + content for file writing
        const fileContent = serializeWithFrontmatter(contentToUse, updatedFrontmatter)

        // Create new file path based on title
        const oldPath = note.path
        const normalizedPath = oldPath.replace(/\\/g, '/')
        const lastSlashIndex = normalizedPath.lastIndexOf('/')

        if (lastSlashIndex === -1) {
          console.error('Invalid path format:', oldPath)
          updateNote(noteId, { title })
          activeRenameCount--
          resolve()
        } else {
          const directory = normalizedPath.substring(0, lastSlashIndex)
          const newPath = `${directory}/${title}.md`
          const finalNewPath = oldPath.includes('\\') ? newPath.replace(/\//g, '\\') : newPath

          // Compute new note ID
          const newId = finalNewPath
            .replace(vaultPath, '')
            .replace(/^[\\\/]/, '')
            .replace(/\.md$/, '')
            .replace(/\\/g, '/')

          // Store the old→new note ID mapping
          noteIdMapping = {
            oldId: noteId,
            newId: newId,
          }

          // Store the pending rename info
          pendingRename = {
            oldPath,
            newPath: finalNewPath,
            newName: `${title}.md`,
          }

          // Mark the rename timestamp to protect editor from updates for 2 seconds
          // This prevents the editor from being updated during rename and subsequent vault reloads
          lastRenameTimestampRef.current = Date.now()
          console.log('Set rename timestamp for protection window')

          // First write the file content (with frontmatter) to disk
          await window.electronAPI.writeFile(oldPath, fileContent)

          // Then rename file
          await window.electronAPI.renameFile(oldPath, finalNewPath)

          // Update store: remove old note and add new note with new ID
          // This is necessary because the note ID is based on the file path
          const { notes, updateNote: _updateNote, deleteNote, addNote, setEditingNoteId } = useVaultStore.getState()
          const oldNote = notes.get(noteId)
          if (oldNote) {
            // Create new note with updated ID and properties
            // Store content WITHOUT frontmatter, and frontmatter separately
            const newNote: Note = {
              ...oldNote,
              id: newId,
              title,
              path: finalNewPath,
              name: `${title}.md`,
              content: contentToUse,
              frontmatter: updatedFrontmatter,
            }

            // Remove old note and add new one
            deleteNote(noteId)
            addNote(newNote)

            // CRITICAL: Update editingNoteId immediately to prevent component unmount
            // If we don't do this, notes.get(noteId) returns undefined and the editor unmounts
            const currentEditingNoteId = useVaultStore.getState().editingNoteId
            if (currentEditingNoteId === noteId) {
              console.log(`Immediately updating editingNoteId: ${noteId} → ${newId}`)
              setEditingNoteId(newId)
            }

            // CRITICAL: Transfer card position from old ID to new ID to prevent notes disappearing from whiteboard
            // When a note is renamed, its ID changes (path-based), but its whiteboard position should be preserved
            const { whiteboards, setWhiteboards } = useVaultStore.getState()
            const activeWhiteboard = whiteboards.find(w => w.id === useVaultStore.getState().activeWhiteboardId)
            if (activeWhiteboard) {
              const cardIndex = activeWhiteboard.cards.findIndex(c => c.id === noteId)
              if (cardIndex >= 0) {
                // Found card with old ID, update it to use new ID
                const oldCardPosition = activeWhiteboard.cards[cardIndex]
                const newCardPosition = {
                  ...oldCardPosition,
                  id: newId,
                }

                // Update in store
                const updatedWhiteboards = whiteboards.map(w => {
                  if (w.id === activeWhiteboard.id) {
                    const updatedCards = [...w.cards]
                    updatedCards[cardIndex] = newCardPosition
                    return { ...w, cards: updatedCards }
                  }
                  return w
                })
                setWhiteboards(updatedWhiteboards)

                // Persist to file system
                window.electronAPI.updateCardPosition(newCardPosition).catch((error: Error) => {
                  console.error('Error saving card position after rename:', error)
                })

                console.log(`Transferred card position: ${noteId} → ${newId}`)
              }
            }
          }

          // Update local state (content only, no frontmatter)
          setContent(contentToUse)

          // Update file tree in real-time
          updateFileInTree(oldPath, finalNewPath, `${title}.md`)

          // Rebuild graph and backlinks to reflect the new title
          setTimeout(() => {
            recomputeBacklinks()
            rebuildGraph()
          }, 100)

          // Clear the counter and pending rename after a delay
          // Use shorter delay when immediate mode (user is closing)
          setTimeout(() => {
            activeRenameCount--
            console.log(`Rename completed (active count: ${activeRenameCount})`)
            pendingRename = null

            // Notify that rename is complete
            if (activeRenameCount === 0 && onRenameComplete) {
              onRenameComplete()
            }

            resolve()
          }, immediate ? 100 : 1000)
        }
      } catch (error) {
        console.error('Error renaming file:', error)
        activeRenameCount--
        pendingRename = null
        resolve()
      }
      }

      // Execute immediately or with debounce
      if (immediate) {
        executeRename()
      } else {
        renameTimeoutRef.current = setTimeout(executeRename, 500)
      }
    })
  }

  const handleMenuClick = () => {
    if (menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect()
      setMenuPosition({
        x: rect.right - 180, // Align menu to right edge of button
        y: rect.bottom + 4,
      })
      setShowMenu(!showMenu)
    }
  }

  const handleDelete = async () => {
    if (!note) return

    const confirmed = await confirm({
      message: `Are you sure you want to delete "${note.title}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true
    })

    if (!confirmed) {
      return
    }

    try {
      // Delete from filesystem
      await window.electronAPI.deleteFile(note.path)

      // Remove from store
      deleteNote(note.id)

      // Close the editor
      onClose()
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  const handleMoveToFolder = async (folderPath: string) => {
    if (!note || !vaultPath) return

    try {
      // Save current changes before moving
      await handleAutoSave()

      // Move the file
      const newPath = await window.electronAPI.moveFile(note.path, folderPath)

      // Compute new note ID based on new path
      const newId = newPath
        .replace(vaultPath, '')
        .replace(/^[\\\/]/, '')
        .replace(/\.md$/, '')
        .replace(/\\/g, '/')

      // Get fresh state from store
      const { notes, deleteNote, addNote, setEditingNoteId, setFiles } = useVaultStore.getState()
      const oldNote = notes.get(noteId)

      if (oldNote) {
        // Create new note with updated ID and path
        const newNote: Note = {
          ...oldNote,
          id: newId,
          path: newPath,
        }

        // Remove old note and add new one
        deleteNote(noteId)
        addNote(newNote)

        // Update editingNoteId if this note is being edited
        const currentEditingNoteId = useVaultStore.getState().editingNoteId
        if (currentEditingNoteId === noteId) {
          setEditingNoteId(newId)
        }

        // Refresh the file tree
        const updatedFiles = await window.electronAPI.readVault(vaultPath)
        setFiles(updatedFiles)

        // Rebuild graph and backlinks
        setTimeout(() => {
          recomputeBacklinks()
          rebuildGraph()
        }, 100)
      }
    } catch (error) {
      console.error('Error moving note to folder:', error)
      alert('Failed to move note to folder')
    }
  }

  const handleClose = async () => {
    // Check if title has changed and trigger rename if needed
    if (note && title !== note.title && vaultPath) {
      await handleTitleBlur(true) // Pass true for immediate execution
    }

    // Save before closing if there are unsaved changes
    if (note && content !== note.content) {
      handleAutoSave().then(() => onClose())
    } else {
      onClose()
    }
  }

  // Use last known note during vault reloads to prevent editor from disappearing
  const activeNote = note || lastKnownNoteRef.current

  // Show loading state if note is not available yet and we're still retrying
  if (!activeNote) {
    if (noteLoadAttempts < 10) {
      return (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '16px',
              padding: '40px',
              textAlign: 'center',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.15)',
            }}
          >
            <p style={{ fontSize: '16px', color: '#4a5568', margin: 0 }}>Loading note...</p>
          </div>
        </div>
      )
    }
    return null
  }

  // Get backlinks and forward links
  // Always use fresh note data if available, as cached data may have stale links
  const backlinks = (note?.backlinks || activeNote.backlinks) || []
  const forwardLinks = (note?.links || activeNote.links) || []

  return (
    <div
      className="note-editor-backdrop"
      style={{
        position: 'fixed',
        top: isFullScreen ? '60px' : 0,
        left: isFullScreen ? '324px' : 0,
        right: 0,
        bottom: 0,
        backgroundColor: isFullScreen ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.75)',
        backdropFilter: isFullScreen ? 'blur(4px)' : 'blur(8px)',
        WebkitBackdropFilter: isFullScreen ? 'blur(4px)' : 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.3s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isFullScreen) {
          handleClose()
        }
      }}
    >
      <div
        className="note-editor-modal"
        style={{
          background: isFullScreen ? 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)' : 'transparent',
          borderRadius: isFullScreen ? '0' : '24px',
          width: isFullScreen ? '100%' : '92%',
          maxWidth: isFullScreen ? 'none' : '1400px',
          height: isFullScreen ? '100%' : '88%',
          display: 'flex',
          flexDirection: 'row',
          boxShadow: isFullScreen ? 'none' : '0 32px 64px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(102, 126, 234, 0.05)',
          border: 'none',
          animation: 'slideUp 0.3s ease-out',
          padding: isFullScreen ? '0' : '40px',
        }}
      >
        {/* Main Editor Area - Floating Page */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div
            style={{
              padding: '24px 32px',
              borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => handleTitleBlur()}
                placeholder="Note title"
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#1a1a1a',
                  border: '1px solid transparent',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  backgroundColor: 'transparent',
                  outline: 'none',
                  flex: 1,
                  maxWidth: '500px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#667eea'
                  e.currentTarget.style.backgroundColor = 'rgba(102, 126, 234, 0.1)'
                }}
                onBlurCapture={(e) => {
                  e.currentTarget.style.borderColor = 'transparent'
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              />
              {isSaving && (
                <span style={{ fontSize: '13px', color: '#718096', fontWeight: 500 }}>Saving...</span>
              )}
              {!isSaving && lastSaved && (
                <span style={{ fontSize: '13px', color: '#667eea', fontWeight: 500 }}>
                  Saved {lastSaved.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                ref={menuButtonRef}
                onClick={handleMenuClick}
                title="More options"
                style={{
                  background: 'rgba(102, 126, 234, 0.1)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  color: '#4a5568',
                  borderRadius: '8px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(102, 126, 234, 0.2)'
                  e.currentTarget.style.color = '#667eea'
                  e.currentTarget.style.transform = 'scale(1.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'
                  e.currentTarget.style.color = '#4a5568'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              <button
                onClick={() => setIsFullScreen(!isFullScreen)}
                title={isFullScreen ? 'Exit Full Screen' : 'Enter Full Screen'}
                style={{
                  background: 'rgba(102, 126, 234, 0.1)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  color: '#4a5568',
                  borderRadius: '8px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(102, 126, 234, 0.2)'
                  e.currentTarget.style.color = '#667eea'
                  e.currentTarget.style.transform = 'scale(1.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'
                  e.currentTarget.style.color = '#4a5568'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <Maximize2 size={16} />
              </button>
              <button
                onClick={handleClose}
                style={{
                  background: 'rgba(102, 126, 234, 0.1)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  color: '#4a5568',
                  borderRadius: '8px',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  e.currentTarget.style.color = 'white'
                  e.currentTarget.style.transform = 'scale(1.05)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'
                  e.currentTarget.style.color = '#4a5568'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* WYSIWYG Editor */}
          <div
            ref={editorContainerRef}
            className="editor-floating-page"
            style={{
              flex: 1,
              overflow: 'auto',
              backgroundColor: '#fefefe',
              padding: '32px 48px',
              backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #fefefe 100%)',
            }}
          />
        </div>

        {/* Right Sidebar - Links Panel */}
        <div
          className="editor-links-sidebar"
          style={{
            width: '300px',
            marginLeft: '12px',
            display: 'flex',
            flexDirection: 'column',
            background: '#ffffff',
            borderRadius: '20px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden',
          }}
        >
          <div style={{
            padding: '24px 20px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
            background: 'linear-gradient(180deg, #ffffff 0%, #fafbfc 100%)',
          }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1a1a1a', letterSpacing: '0.3px' }}>Links</h3>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {/* Local Graph */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '11px', fontWeight: 700, margin: '0 0 12px 0', color: '#718096', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Local Graph
              </h4>
              <div style={{
                width: '100%',
                height: '200px',
                background: '#ffffff',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}>
                <LocalGraphVisualization noteId={noteId} />
              </div>
            </div>

            {/* Backlinks */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ fontSize: '11px', fontWeight: 700, margin: '0 0 12px 0', color: '#718096', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Backlinks ({backlinks.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {backlinks.length > 0 ? (
                  backlinks.map((backlinkId) => {
                    const backlinkNote = notes.get(backlinkId)
                    return (
                      <div
                        key={backlinkId}
                        onClick={() => {
                          setEditingNoteId(backlinkId)
                          setSelectedNoteId(backlinkId)
                        }}
                        style={{
                          padding: '8px 10px',
                          background: '#ffffff',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#4a5568',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(102, 126, 234, 0.1)'
                          e.currentTarget.style.borderColor = '#667eea'
                          e.currentTarget.style.color = '#667eea'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#ffffff'
                          e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)'
                          e.currentTarget.style.color = '#4a5568'
                        }}
                      >
                        {backlinkNote?.title || backlinkId}
                      </div>
                    )
                  })
                ) : (
                  <div style={{ fontSize: '12px', color: '#a0aec0', textAlign: 'center', padding: '12px' }}>
                    No backlinks
                  </div>
                )}
              </div>
            </div>

            {/* Forward Links */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, margin: '0 0 12px 0', color: '#718096', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Forward Links ({forwardLinks.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {forwardLinks.length > 0 ? (
                  forwardLinks.map((link, index) => {
                    // Find the target note for this link
                    const normalizedLink = link.replace(/\.md$/, '').replace(/\\/g, '/')
                    let targetNote = notes.get(normalizedLink)

                    // Try finding by name (case-insensitive)
                    if (!targetNote) {
                      const linkName = normalizedLink.toLowerCase()
                      for (const note of notes.values()) {
                        if (note.name.toLowerCase() === linkName || note.title.toLowerCase() === linkName) {
                          targetNote = note
                          break
                        }
                      }
                    }

                    return (
                      <div
                        key={`${link}-${index}`}
                        onClick={() => {
                          if (targetNote) {
                            setEditingNoteId(targetNote.id)
                            setSelectedNoteId(targetNote.id)
                          }
                        }}
                        style={{
                          padding: '8px 10px',
                          background: '#ffffff',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          borderRadius: '6px',
                          cursor: targetNote ? 'pointer' : 'default',
                          fontSize: '13px',
                          color: targetNote ? '#4a5568' : '#a0aec0',
                          opacity: targetNote ? 1 : 0.6,
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (targetNote) {
                            e.currentTarget.style.background = 'rgba(240, 147, 251, 0.1)'
                            e.currentTarget.style.borderColor = '#f093fb'
                            e.currentTarget.style.color = '#f093fb'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (targetNote) {
                            e.currentTarget.style.background = '#ffffff'
                            e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.08)'
                            e.currentTarget.style.color = '#4a5568'
                          }
                        }}
                      >
                        {targetNote ? targetNote.title : link}
                        {!targetNote && ' (not found)'}
                      </div>
                    )
                  })
                ) : (
                  <div style={{ fontSize: '12px', color: '#a0aec0', textAlign: 'center', padding: '12px' }}>
                    No forward links
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {showMenu && (
        <ContextMenu
          x={menuPosition.x}
          y={menuPosition.y}
          items={[
            {
              label: 'Move to Folder',
              icon: <Folder size={16} />,
              onClick: () => {
                setShowMenu(false)
                setShowFolderSelectModal(true)
              },
            },
            {
              label: 'Delete',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: handleDelete,
            },
          ]}
          onClose={() => setShowMenu(false)}
        />
      )}
      {showFolderSelectModal && (
        <FolderSelectModal
          onSelectFolder={handleMoveToFolder}
          onClose={() => setShowFolderSelectModal(false)}
        />
      )}
    </div>
  )
}
