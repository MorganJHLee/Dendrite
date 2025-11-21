import { useRef, useState, useEffect } from 'react'
import { Plus, StickyNote as StickyNoteIcon, FileText, Search, X } from 'lucide-react'
import './WhiteboardCanvas.css'
import { useVaultStore } from '../store/vaultStore'
import Canvas, { type CanvasRef } from './Canvas'
import AddPdfModal from './AddPdfModal'

function WhiteboardCanvas() {
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<CanvasRef>(null)
  const { notes, vaultPath, setEditingNoteId, activeWhiteboardId, addStickyNote } = useVaultStore()
  const [showAddPdfModal, setShowAddPdfModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [showSearchResults, setShowSearchResults] = useState(false)

  // Listen for sidebar note selection
  useEffect(() => {
    const handleSidebarNoteSelected = (event: Event) => {
      const customEvent = event as CustomEvent
      const { noteId } = customEvent.detail
      if (noteId && canvasRef.current) {
        // We only want to navigate, not toggle search or anything else
        canvasRef.current.navigateToElement(noteId, 'note')
      }
    }

    window.addEventListener('sidebar-note-selected', handleSidebarNoteSelected)

    return () => {
      window.removeEventListener('sidebar-note-selected', handleSidebarNoteSelected)
    }
  }, [])

  const handleAddNote = async () => {
    if (!vaultPath || !activeWhiteboardId) return

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
      await window.electronAPI.createFile(filePath, content)

      // Compute the note ID (same logic as in vault loading)
      const noteId = filePath
        .replace(vaultPath, '')
        .replace(/^[\\\/]/, '')
        .replace(/\.md$/, '')
        .replace(/\\/g, '/')

      // Wait for the note to be loaded into the store, then add it to whiteboard and open it
      // The file watcher will trigger a vault reload which adds the note
      let retries = 0
      const maxRetries = 20 // 2 seconds max (20 * 100ms)
      const checkInterval = setInterval(async () => {
        const loadedNote = useVaultStore.getState().notes.get(noteId)
        if (loadedNote) {
          clearInterval(checkInterval)

          // Add the new note to the active whiteboard
          // Position it in the center of the canvas
          const newCardPosition = {
            id: noteId,
            x: 300,
            y: 150,
            width: 280,
            height: 200,
            whiteboardId: activeWhiteboardId,
          }

          try {
            // Persist to backend
            await window.electronAPI.updateCardPosition(newCardPosition)
            // Update frontend store immediately to avoid race condition with file watcher
            useVaultStore.getState().updateCardPosition(newCardPosition)
          } catch (error) {
            console.error('Error adding new note to whiteboard:', error)
          }

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
    }
  }

  const handleAddStickyNote = async () => {
    if (!activeWhiteboardId) return

    // Create a new sticky note with default values
    const newStickyNote = {
      id: `sticky-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      whiteboardId: activeWhiteboardId,
      text: '',
      color: '#fef08a', // Default yellow color
      x: 400,
      y: 200,
      width: 200,
      height: 200,
      createdAt: new Date(),
      modifiedAt: new Date(),
    }

    try {
      // Add to store
      addStickyNote(newStickyNote)

      // Save to backend
      const { whiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      await window.electronAPI.saveMetadata({
        version: '2.0',
        whiteboards,
        activeWhiteboardId: currentActiveWhiteboardId,
      })
    } catch (error) {
      console.error('Error creating sticky note:', error)
    }
  }

  const handleAddPdf = () => {
    if (!activeWhiteboardId) return
    setShowAddPdfModal(true)
  }

  const handleSearchResults = (results: any[]) => {
    setSearchResults(results)
    setShowSearchResults(results.length > 0)
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setSearchQuery(query)

    if (query.trim().length === 0) {
      setShowSearchResults(false)
      canvasRef.current?.handleSearch('')
      return
    }

    canvasRef.current?.handleSearch(query)
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setShowSearchResults(false)
    canvasRef.current?.handleSearch('')
  }

  const handleResultClick = (result: any) => {
    canvasRef.current?.navigateToElement(result.id, result.type)
    setShowSearchResults(false)
  }

  const getElementTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      note: 'Note',
      stickyNote: 'Sticky Note',
      textBox: 'Text Box',
      pdfCard: 'PDF',
      highlightCard: 'Highlight',
      group: 'Group'
    }
    return labels[type] || type
  }

  const renderHighlightedText = (text: string) => {
    if (!text) return null

    // Split by highlight markers
    const highlightStart = '<<HIGHLIGHT>>'
    const highlightEnd = '<</HIGHLIGHT>>'
    const parts: React.ReactNode[] = []
    let currentText = text
    let key = 0

    while (currentText.length > 0) {
      const startIdx = currentText.indexOf(highlightStart)

      if (startIdx === -1) {
        // No more highlights, add remaining text
        if (currentText.length > 0) {
          parts.push(currentText)
        }
        break
      }

      // Add text before highlight
      if (startIdx > 0) {
        parts.push(currentText.substring(0, startIdx))
      }

      // Find end of highlight
      const endIdx = currentText.indexOf(highlightEnd, startIdx + highlightStart.length)

      if (endIdx === -1) {
        // No closing tag, treat rest as normal text
        parts.push(currentText.substring(startIdx))
        break
      }

      // Add highlighted text
      const highlightedText = currentText.substring(startIdx + highlightStart.length, endIdx)
      parts.push(
        <span key={key++} className="search-highlight">
          {highlightedText}
        </span>
      )

      // Continue with remaining text
      currentText = currentText.substring(endIdx + highlightEnd.length)
    }

    return <>{parts}</>
  }

  return (
    <div className="whiteboard-canvas">
      <div className="canvas-toolbar">
        <button className="btn-sm" onClick={handleAddNote}>
          <Plus size={16} style={{ marginRight: '6px' }} /> Add Note
        </button>
        <button className="btn-sm" onClick={handleAddStickyNote}>
          <StickyNoteIcon size={16} style={{ marginRight: '6px' }} /> Add Sticky Note
        </button>
        <button className="btn-sm" onClick={handleAddPdf}>
          <FileText size={16} style={{ marginRight: '6px' }} /> Add PDF
        </button>
        <div className="toolbar-spacer" />
        <div className="search-wrapper">
          <div className="search-container">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search in whiteboard..."
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => {
                if (searchQuery.trim().length > 0 && searchResults.length > 0) {
                  setShowSearchResults(true)
                }
              }}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              className="search-input"
            />
            {searchQuery.length > 0 && (
              <button className="search-clear-btn" onClick={handleClearSearch}>
                <X size={14} />
              </button>
            )}
          </div>
          {showSearchResults && (
            <div className="search-results-dropdown">
              {searchResults.map((result, index) => (
                <div
                  key={`${result.type}-${result.id}-${index}`}
                  className="search-result-item"
                  onClick={() => handleResultClick(result)}
                >
                  <div className="search-result-header">
                    <span className="search-result-type">{getElementTypeLabel(result.type)}</span>
                    <span className="search-result-title">{renderHighlightedText(result.title)}</span>
                  </div>
                  {result.snippet && (
                    <div className="search-result-snippet">{renderHighlightedText(result.snippet)}</div>
                  )}
                  <div className="search-result-matched">
                    Matched in: {result.matchedIn}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="canvas-info">
          {notes.size} {notes.size === 1 ? 'note' : 'notes'}
        </div>
      </div>

      <div className="canvas-area" ref={canvasContainerRef}>
        {notes.size === 0 ? (
          <div className="canvas-empty">
            <p>No notes in this vault</p>
            <p className="hint">Click "Add Note" or create a markdown file to get started</p>
          </div>
        ) : (
          <Canvas ref={canvasRef} containerRef={canvasContainerRef} onSearchResults={handleSearchResults} />
        )}
      </div>

      {showAddPdfModal && activeWhiteboardId && (
        <AddPdfModal
          whiteboardId={activeWhiteboardId}
          onClose={() => setShowAddPdfModal(false)}
        />
      )}
    </div>
  )
}

export default WhiteboardCanvas
