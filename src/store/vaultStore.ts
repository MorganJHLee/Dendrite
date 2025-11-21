import { create } from 'zustand'
import type { Note, VaultFile, Graph, Whiteboard, CardPosition, CardGroup, StickyNote, TextBox, Arrow, PdfCard, HighlightCard } from '../types'

interface VaultState {
  // Vault path and metadata
  vaultPath: string | null
  setVaultPath: (path: string | null) => void

  // Files and notes
  files: VaultFile[]
  notes: Map<string, Note>
  setFiles: (files: VaultFile[]) => void
  setNotes: (notes: Map<string, Note>) => void
  addNote: (note: Note) => void
  updateNote: (id: string, updates: Partial<Note>) => void
  updateFileInTree: (oldPath: string, newPath: string, newName: string) => void
  deleteNote: (id: string) => void

  // Current selection
  selectedNoteId: string | null
  setSelectedNoteId: (id: string | null) => void

  // Multi-select
  selectedNoteIds: Set<string>
  setSelectedNoteIds: (ids: Set<string>) => void
  toggleNoteSelection: (id: string) => void
  clearSelection: () => void

  // Editing state
  editingNoteId: string | null
  setEditingNoteId: (id: string | null) => void

  // Whiteboards
  whiteboards: Whiteboard[]
  activeWhiteboardId: string | null
  setWhiteboards: (whiteboards: Whiteboard[]) => void
  setActiveWhiteboard: (id: string) => void
  addWhiteboard: (whiteboard: Whiteboard) => void
  deleteWhiteboard: (id: string) => void
  updateCardPosition: (cardPosition: CardPosition) => void

  // Groups
  addGroup: (group: CardGroup) => void
  updateGroup: (id: string, updates: Partial<CardGroup>) => void
  deleteGroup: (id: string) => void
  addCardsToGroup: (groupId: string, cardIds: string[]) => void
  removeCardsFromGroup: (groupId: string, cardIds: string[]) => void
  addStickyNotesToGroup: (groupId: string, stickyNoteIds: string[]) => void
  removeStickyNotesFromGroup: (groupId: string, stickyNoteIds: string[]) => void

  // Sticky Notes
  addStickyNote: (note: StickyNote) => void
  updateStickyNote: (id: string, updates: Partial<StickyNote>) => void
  deleteStickyNote: (id: string) => void

  // Text Boxes
  addTextBox: (textBox: TextBox) => void
  updateTextBox: (id: string, updates: Partial<TextBox>) => void
  deleteTextBox: (id: string) => void
  addTextBoxesToGroup: (groupId: string, textBoxIds: string[]) => void
  removeTextBoxesFromGroup: (groupId: string, textBoxIds: string[]) => void

  // PDF Cards
  addPdfCard: (pdfCard: PdfCard) => void
  updatePdfCard: (id: string, updates: Partial<PdfCard>) => void
  deletePdfCard: (id: string) => void

  // Highlight Cards
  addHighlightCard: (highlightCard: HighlightCard) => void
  updateHighlightCard: (id: string, updates: Partial<HighlightCard>) => void
  deleteHighlightCard: (id: string) => void
  addHighlightCardsToGroup: (groupId: string, highlightCardIds: string[]) => void
  removeHighlightCardsFromGroup: (groupId: string, highlightCardIds: string[]) => void

  // Arrows
  addArrow: (arrow: Arrow) => void
  updateArrow: (id: string, updates: Partial<Arrow>) => void
  deleteArrow: (id: string) => void

  // Graph
  graph: Graph | null
  setGraph: (graph: Graph) => void

  // Loading state
  isLoading: boolean
  setIsLoading: (isLoading: boolean) => void
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  setVaultPath: (path) => set({ vaultPath: path }),

  files: [],
  notes: new Map(),
  setFiles: (files) => set({ files }),
  setNotes: (notes) => set({ notes }),
  addNote: (note) => {
    const notes = new Map(get().notes)
    notes.set(note.id, note)
    set({ notes })
  },
  updateNote: (id, updates) => {
    const notes = new Map(get().notes)
    const existing = notes.get(id)
    if (existing) {
      notes.set(id, { ...existing, ...updates })
      set({ notes })
    }
  },
  updateFileInTree: (oldPath: string, newPath: string, newName: string) => {
    const updateRecursive = (files: VaultFile[]): VaultFile[] => {
      return files.map((file) => {
        if (file.type === 'file' && file.path === oldPath) {
          // Update this file
          return { ...file, path: newPath, name: newName }
        } else if (file.type === 'directory' && file.children) {
          // Recursively update children
          return { ...file, children: updateRecursive(file.children) }
        }
        return file
      })
    }
    const updatedFiles = updateRecursive(get().files)
    set({ files: updatedFiles })
  },
  deleteNote: (id) => {
    const notes = new Map(get().notes)
    notes.delete(id)
    set({ notes })
  },

  selectedNoteId: null,
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),

  selectedNoteIds: new Set<string>(),
  setSelectedNoteIds: (ids) => set({ selectedNoteIds: ids }),
  toggleNoteSelection: (id) => {
    const { selectedNoteIds } = get()
    const newSelection = new Set(selectedNoteIds)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    set({ selectedNoteIds: newSelection })
  },
  clearSelection: () => set({ selectedNoteIds: new Set<string>(), selectedNoteId: null }),

  editingNoteId: null,
  setEditingNoteId: (id) => set({ editingNoteId: id }),

  whiteboards: [],
  activeWhiteboardId: null,
  setWhiteboards: (whiteboards) => set({ whiteboards }),
  setActiveWhiteboard: (id) => set({ activeWhiteboardId: id }),
  addWhiteboard: (whiteboard) => {
    const whiteboards = [...get().whiteboards, whiteboard]
    set({ whiteboards })
  },
  deleteWhiteboard: (id) => {
    const { whiteboards, activeWhiteboardId } = get()
    const filtered = whiteboards.filter((w) => w.id !== id)

    // If we deleted the active whiteboard, switch to the first available one
    let newActiveId = activeWhiteboardId
    if (activeWhiteboardId === id && filtered.length > 0) {
      newActiveId = filtered[0].id
    }

    set({ whiteboards: filtered, activeWhiteboardId: newActiveId })
  },
  updateCardPosition: (cardPosition) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === cardPosition.whiteboardId) {
        const cardIndex = w.cards.findIndex((c) => c.id === cardPosition.id)
        const newCards = [...w.cards]
        if (cardIndex >= 0) {
          newCards[cardIndex] = cardPosition
        } else {
          newCards.push(cardPosition)
        }
        return { ...w, cards: newCards }
      }
      return w
    })
    set({ whiteboards })
  },

  addGroup: (group) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === group.whiteboardId) {
        return { ...w, groups: [...w.groups, group] }
      }
      return w
    })
    set({ whiteboards })
  },

  updateGroup: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === id)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        newGroups[groupIndex] = { ...newGroups[groupIndex], ...updates }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  deleteGroup: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = w.groups.filter((g) => g.id !== id)
      if (filtered.length !== w.groups.length) {
        return { ...w, groups: filtered }
      }
      return w
    })
    set({ whiteboards })
  },

  addCardsToGroup: (groupId, cardIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const existingCardIds = new Set(newGroups[groupIndex].cardIds)
        cardIds.forEach((id) => existingCardIds.add(id))
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          cardIds: Array.from(existingCardIds),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  removeCardsFromGroup: (groupId, cardIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const cardIdsToRemove = new Set(cardIds)
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          cardIds: newGroups[groupIndex].cardIds.filter((id) => !cardIdsToRemove.has(id)),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  addStickyNotesToGroup: (groupId, stickyNoteIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const existingStickyNoteIds = new Set(newGroups[groupIndex].stickyNoteIds || [])
        stickyNoteIds.forEach((id) => existingStickyNoteIds.add(id))
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          stickyNoteIds: Array.from(existingStickyNoteIds),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  removeStickyNotesFromGroup: (groupId, stickyNoteIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const stickyNoteIdsToRemove = new Set(stickyNoteIds)
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          stickyNoteIds: (newGroups[groupIndex].stickyNoteIds || []).filter((id) => !stickyNoteIdsToRemove.has(id)),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  addStickyNote: (note) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === note.whiteboardId) {
        return { ...w, stickyNotes: [...w.stickyNotes, note] }
      }
      return w
    })
    set({ whiteboards })
  },

  updateStickyNote: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const noteIndex = w.stickyNotes.findIndex((n) => n.id === id)
      if (noteIndex >= 0) {
        const newStickyNotes = [...w.stickyNotes]
        newStickyNotes[noteIndex] = { ...newStickyNotes[noteIndex], ...updates }
        return { ...w, stickyNotes: newStickyNotes }
      }
      return w
    })
    set({ whiteboards })
  },

  deleteStickyNote: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = w.stickyNotes.filter((n) => n.id !== id)
      if (filtered.length !== w.stickyNotes.length) {
        // Also remove arrows connected to this sticky note
        const filteredArrows = (w.arrows || []).filter(
          (arrow) => arrow.sourceNoteId !== id && arrow.targetNoteId !== id
        )
        return { ...w, stickyNotes: filtered, arrows: filteredArrows }
      }
      return w
    })
    set({ whiteboards })
  },

  addTextBox: (textBox) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === textBox.whiteboardId) {
        return { ...w, textBoxes: [...(w.textBoxes || []), textBox] }
      }
      return w
    })
    set({ whiteboards })
  },

  updateTextBox: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const textBoxIndex = (w.textBoxes || []).findIndex((tb) => tb.id === id)
      if (textBoxIndex >= 0) {
        const newTextBoxes = [...(w.textBoxes || [])]
        newTextBoxes[textBoxIndex] = { ...newTextBoxes[textBoxIndex], ...updates }
        return { ...w, textBoxes: newTextBoxes }
      }
      return w
    })
    set({ whiteboards })
  },

  deleteTextBox: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = (w.textBoxes || []).filter((tb) => tb.id !== id)
      if (filtered.length !== (w.textBoxes || []).length) {
        // Also remove arrows connected to this text box
        const filteredArrows = (w.arrows || []).filter(
          (arrow) => arrow.sourceNoteId !== id && arrow.targetNoteId !== id
        )
        return { ...w, textBoxes: filtered, arrows: filteredArrows }
      }
      return w
    })
    set({ whiteboards })
  },

  addTextBoxesToGroup: (groupId, textBoxIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const existingTextBoxIds = new Set(newGroups[groupIndex].textBoxIds || [])
        textBoxIds.forEach((id) => existingTextBoxIds.add(id))
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          textBoxIds: Array.from(existingTextBoxIds),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  removeTextBoxesFromGroup: (groupId, textBoxIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const textBoxIdsToRemove = new Set(textBoxIds)
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          textBoxIds: (newGroups[groupIndex].textBoxIds || []).filter((id) => !textBoxIdsToRemove.has(id)),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  addPdfCard: (pdfCard) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === pdfCard.whiteboardId) {
        return { ...w, pdfCards: [...(w.pdfCards || []), pdfCard] }
      }
      return w
    })
    set({ whiteboards })
  },

  updatePdfCard: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const pdfCardIndex = (w.pdfCards || []).findIndex((pc) => pc.id === id)
      if (pdfCardIndex >= 0) {
        const newPdfCards = [...(w.pdfCards || [])]
        newPdfCards[pdfCardIndex] = { ...newPdfCards[pdfCardIndex], ...updates }
        return { ...w, pdfCards: newPdfCards }
      }
      return w
    })
    set({ whiteboards })
  },

  deletePdfCard: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = (w.pdfCards || []).filter((pc) => pc.id !== id)
      if (filtered.length !== (w.pdfCards || []).length) {
        // Also remove arrows connected to this PDF card
        const filteredArrows = (w.arrows || []).filter(
          (arrow) => arrow.sourceNoteId !== id && arrow.targetNoteId !== id
        )
        return { ...w, pdfCards: filtered, arrows: filteredArrows }
      }
      return w
    })
    set({ whiteboards })
  },

  addHighlightCard: (highlightCard) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === highlightCard.whiteboardId) {
        return { ...w, highlightCards: [...(w.highlightCards || []), highlightCard] }
      }
      return w
    })
    set({ whiteboards })
  },

  updateHighlightCard: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const highlightCardIndex = (w.highlightCards || []).findIndex((hc) => hc.id === id)
      if (highlightCardIndex >= 0) {
        const newHighlightCards = [...(w.highlightCards || [])]
        newHighlightCards[highlightCardIndex] = { ...newHighlightCards[highlightCardIndex], ...updates }
        return { ...w, highlightCards: newHighlightCards }
      }
      return w
    })
    set({ whiteboards })
  },

  deleteHighlightCard: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = (w.highlightCards || []).filter((hc) => hc.id !== id)
      if (filtered.length !== (w.highlightCards || []).length) {
        // Also remove arrows connected to this highlight card
        const filteredArrows = (w.arrows || []).filter(
          (arrow) => arrow.sourceNoteId !== id && arrow.targetNoteId !== id
        )
        return { ...w, highlightCards: filtered, arrows: filteredArrows }
      }
      return w
    })
    set({ whiteboards })
  },

  addHighlightCardsToGroup: (groupId, highlightCardIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const existingHighlightCardIds = new Set(newGroups[groupIndex].highlightCardIds || [])
        highlightCardIds.forEach((id) => existingHighlightCardIds.add(id))
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          highlightCardIds: Array.from(existingHighlightCardIds),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  removeHighlightCardsFromGroup: (groupId, highlightCardIds) => {
    const whiteboards = get().whiteboards.map((w) => {
      const groupIndex = w.groups.findIndex((g) => g.id === groupId)
      if (groupIndex >= 0) {
        const newGroups = [...w.groups]
        const highlightCardIdsToRemove = new Set(highlightCardIds)
        newGroups[groupIndex] = {
          ...newGroups[groupIndex],
          highlightCardIds: (newGroups[groupIndex].highlightCardIds || []).filter((id) => !highlightCardIdsToRemove.has(id)),
        }
        return { ...w, groups: newGroups }
      }
      return w
    })
    set({ whiteboards })
  },

  addArrow: (arrow) => {
    const whiteboards = get().whiteboards.map((w) => {
      if (w.id === arrow.whiteboardId) {
        return { ...w, arrows: [...w.arrows, arrow] }
      }
      return w
    })
    set({ whiteboards })
  },

  updateArrow: (id, updates) => {
    const whiteboards = get().whiteboards.map((w) => {
      const arrowIndex = w.arrows.findIndex((a) => a.id === id)
      if (arrowIndex >= 0) {
        const newArrows = [...w.arrows]
        newArrows[arrowIndex] = { ...newArrows[arrowIndex], ...updates }
        return { ...w, arrows: newArrows }
      }
      return w
    })
    set({ whiteboards })
  },

  deleteArrow: (id) => {
    const whiteboards = get().whiteboards.map((w) => {
      const filtered = w.arrows.filter((a) => a.id !== id)
      if (filtered.length !== w.arrows.length) {
        return { ...w, arrows: filtered }
      }
      return w
    })
    set({ whiteboards })
  },

  graph: null,
  setGraph: (graph) => set({ graph }),

  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
}))
