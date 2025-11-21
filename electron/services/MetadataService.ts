import fs from 'fs/promises'
import path from 'path'
import { getAtomicFileStorage } from './AtomicFileStorage'
import { DataValidator } from './DataValidator'

export interface CardPosition {
  id: string
  x: number
  y: number
  width: number
  height: number
  whiteboardId: string
}

export interface ArrowPoint {
  x: number
  y: number
}

export interface Arrow {
  id: string
  sourceNoteId: string
  targetNoteId: string
  sourceType?: 'note' | 'textBox' | 'pdf' | 'highlight'
  targetType?: 'note' | 'textBox' | 'pdf' | 'highlight'
  sourceSide?: 'top' | 'right' | 'bottom' | 'left'
  targetSide?: 'top' | 'right' | 'bottom' | 'left'
  sourcePoint: ArrowPoint
  targetPoint: ArrowPoint
  controlPoint: ArrowPoint
  whiteboardId: string
}

export interface CardGroup {
  id: string
  whiteboardId: string
  name: string
  cardIds: string[]
  stickyNoteIds?: string[]
  textBoxIds?: string[]
  pdfCardIds?: string[]
  highlightCardIds?: string[]
  color: string
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
  createdAt: Date
  modifiedAt: Date
}

export interface StickyNote {
  id: string
  whiteboardId: string
  text: string
  color: string
  x: number
  y: number
  width: number
  height: number
  createdAt: Date
  modifiedAt: Date
}

export interface TextBox {
  id: string
  whiteboardId: string
  text: string
  x: number
  y: number
  width: number
  height: number
  createdAt: Date
  modifiedAt: Date
}

export interface PdfHighlight {
  id: string
  text: string
  color: string
  pageNumber: number
  rects: any[] // Serialized DOMRect data
  textDivIndices: number[]
}

export interface PdfCard {
  id: string
  whiteboardId: string
  pdfPath: string
  fileName: string
  title: string
  x: number
  y: number
  width: number
  height: number
  thumbnailPath: string
  pageCount: number
  fileSize: number
  currentPage?: number
  lastReadPage?: number
  lastScrollPosition?: number
  lastReadAt?: Date
  highlights?: PdfHighlight[]
  createdAt: Date
  modifiedAt: Date
}

export interface HighlightCard {
  id: string
  whiteboardId: string
  sourcePdfCardId: string
  highlightedText: string
  pageNumber: number
  color: string
  x: number
  y: number
  width: number
  height: number
  createdAt: Date
  modifiedAt: Date
  scrollPosition?: number
  boundingRect?: {
    left: number
    top: number
    width: number
    height: number
  }
}

export interface Whiteboard {
  id: string
  name: string
  cards: CardPosition[]
  arrows: Arrow[]
  groups: CardGroup[]
  stickyNotes: StickyNote[]
  textBoxes: TextBox[]
  pdfCards: PdfCard[]
  highlightCards: HighlightCard[]
  createdAt: Date
  modifiedAt: Date
}

export interface WhiteboardIndex {
  version: string
  activeWhiteboardId: string | null
  whiteboards: string[] // Array of whiteboard IDs
}

// Legacy format for migration
export interface LegacyWhiteboardMetadata {
  version: string
  whiteboards: Whiteboard[]
  activeWhiteboardId: string | null
}

// Current format that the frontend expects
export interface WhiteboardMetadata {
  version: string
  whiteboards: Whiteboard[]
  activeWhiteboardId: string | null
}

export class MetadataService {
  private vaultPath: string
  private whiteboardsDir: string
  private indexFilePath: string
  private legacyMetadataFilePath: string
  private storage = getAtomicFileStorage()

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
    this.whiteboardsDir = path.join(vaultPath, '.whiteboards')
    this.indexFilePath = path.join(this.whiteboardsDir, 'index.json')
    this.legacyMetadataFilePath = path.join(vaultPath, '.whiteboard-metadata.json')
  }

  /**
   * Ensure the whiteboards directory exists
   */
  private async ensureWhiteboardsDir(): Promise<void> {
    try {
      await fs.mkdir(this.whiteboardsDir, { recursive: true })
    } catch (error) {
      // Directory already exists or cannot be created
      console.error('Error creating whiteboards directory:', error)
    }
  }

  /**
   * Migrate from legacy single-file format to new multi-file format
   */
  private async migrateFromLegacyFormat(): Promise<void> {
    try {
      // Check if legacy file exists
      const legacyContent = await fs.readFile(this.legacyMetadataFilePath, 'utf-8')

      // Check if content is empty or only whitespace
      if (!legacyContent || legacyContent.trim().length === 0) {
        console.error('Legacy metadata file is empty, skipping migration')
        return
      }

      // Try to parse JSON with better error handling
      let legacyData: LegacyWhiteboardMetadata
      try {
        legacyData = JSON.parse(legacyContent)
      } catch (parseError) {
        console.error('Error parsing legacy metadata file:', parseError)
        console.error(`File content length: ${legacyContent.length} characters`)

        // Move the corrupted file to backup (if it still exists)
        try {
          // Check if file still exists before moving (avoid race condition)
          await fs.access(this.legacyMetadataFilePath)
          const backupPath = this.legacyMetadataFilePath + `.corrupted.${Date.now()}.bak`
          await fs.rename(this.legacyMetadataFilePath, backupPath)
          console.log(`Moved corrupted legacy file to: ${backupPath}`)
        } catch (backupError: any) {
          // If file doesn't exist, it was likely already moved by another process
          if (backupError.code !== 'ENOENT') {
            console.error('Failed to move corrupted file:', backupError)
          }
        }

        return
      }

      console.log('Migrating from legacy whiteboard format...')

      // Ensure whiteboards directory exists
      await this.ensureWhiteboardsDir()

      // Save each whiteboard to its own file
      for (const whiteboard of legacyData.whiteboards) {
        await this.saveWhiteboard(whiteboard)
      }

      // Create index file
      const index: WhiteboardIndex = {
        version: '2.0',
        activeWhiteboardId: legacyData.activeWhiteboardId,
        whiteboards: legacyData.whiteboards.map(w => w.id)
      }
      await fs.writeFile(this.indexFilePath, JSON.stringify(index, null, 2), 'utf-8')

      // Rename legacy file to backup
      const backupPath = this.legacyMetadataFilePath + '.backup'
      await fs.rename(this.legacyMetadataFilePath, backupPath)

      console.log('Migration completed successfully. Legacy file backed up to:', backupPath)
    } catch (error) {
      // Legacy file doesn't exist, no migration needed
    }
  }

  /**
   * Load index file
   */
  private async loadIndex(): Promise<WhiteboardIndex> {
    try {
      const content = await fs.readFile(this.indexFilePath, 'utf-8')

      // Check if content is empty or only whitespace
      if (!content || content.trim().length === 0) {
        console.error('Error loading index: File is empty')
        throw new Error('Index file is empty')
      }

      // Try to parse JSON with better error handling
      try {
        return JSON.parse(content)
      } catch (parseError) {
        console.error('Error parsing index file:', parseError)
        console.error(`File content length: ${content.length} characters`)
        console.error(`File content preview: ${content.substring(0, 100)}...`)

        // Move the corrupted file to backup (if it still exists)
        try {
          // Check if file still exists before moving (avoid race condition)
          await fs.access(this.indexFilePath)
          const backupPath = this.indexFilePath + `.corrupted.${Date.now()}.bak`
          await fs.rename(this.indexFilePath, backupPath)
          console.log(`Moved corrupted index file to: ${backupPath}`)
        } catch (backupError: any) {
          // If file doesn't exist, it was likely already moved by another process
          if (backupError.code !== 'ENOENT') {
            console.error('Failed to move corrupted file:', backupError)
          }
        }

        throw parseError
      }
    } catch (error) {
      // Index doesn't exist or is corrupted, check for migration
      await this.migrateFromLegacyFormat()

      // Try loading index again after migration
      try {
        const content = await fs.readFile(this.indexFilePath, 'utf-8')

        // Check if content is empty or only whitespace
        if (!content || content.trim().length === 0) {
          console.error('Error loading index after migration: File is empty')
          // Create default index
          return {
            version: '2.0',
            activeWhiteboardId: 'default',
            whiteboards: ['default']
          }
        }

        return JSON.parse(content)
      } catch (error) {
        // Still no index, create default
        return {
          version: '2.0',
          activeWhiteboardId: 'default',
          whiteboards: ['default']
        }
      }
    }
  }

  /**
   * Save index file
   */
  private async saveIndex(index: WhiteboardIndex): Promise<void> {
    await this.ensureWhiteboardsDir()
    await this.storage.writeJSON(this.indexFilePath, index)
  }

  /**
   * Load a single whiteboard from file
   */
  private async loadWhiteboard(whiteboardId: string): Promise<Whiteboard | null> {
    try {
      const whiteboardPath = path.join(this.whiteboardsDir, `${whiteboardId}.json`)
      const content = await fs.readFile(whiteboardPath, 'utf-8')

      // Check if content is empty or only whitespace
      if (!content || content.trim().length === 0) {
        console.error(`Error loading whiteboard ${whiteboardId}: File is empty`)

        // Move the empty file to backup (if it still exists)
        try {
          // Check if file still exists before moving (avoid race condition)
          await fs.access(whiteboardPath)
          const backupPath = whiteboardPath + `.corrupted.${Date.now()}.bak`
          await fs.rename(whiteboardPath, backupPath)
          console.log(`Moved empty whiteboard file to: ${backupPath}`)
        } catch (backupError: any) {
          // If file doesn't exist, it was likely already moved by another process
          if (backupError.code !== 'ENOENT') {
            console.error('Failed to move corrupted file:', backupError)
          }
        }

        return null
      }

      // Try to parse JSON with better error handling
      let whiteboard
      try {
        whiteboard = JSON.parse(content)
      } catch (parseError) {
        console.error(`Error loading whiteboard ${whiteboardId}:`, parseError)
        console.error(`File content length: ${content.length} characters`)
        console.error(`File content preview: ${content.substring(0, 100)}...`)

        // Move the corrupted file to backup (if it still exists)
        try {
          // Check if file still exists before moving (avoid race condition)
          await fs.access(whiteboardPath)
          const backupPath = whiteboardPath + `.corrupted.${Date.now()}.bak`
          await fs.rename(whiteboardPath, backupPath)
          console.log(`Moved corrupted whiteboard file to: ${backupPath}`)
        } catch (backupError: any) {
          // If file doesn't exist, it was likely already moved by another process
          if (backupError.code !== 'ENOENT') {
            console.error('Failed to move corrupted file:', backupError)
          }
        }

        return null
      }

      // Ensure groups array exists for backwards compatibility
      if (!Array.isArray(whiteboard.groups)) {
        whiteboard.groups = []
      }

      // Ensure stickyNotes array exists for backwards compatibility
      if (!Array.isArray(whiteboard.stickyNotes)) {
        whiteboard.stickyNotes = []
      }

      // Ensure textBoxes array exists for backwards compatibility
      if (!Array.isArray(whiteboard.textBoxes)) {
        whiteboard.textBoxes = []
      }

      // Ensure pdfCards array exists for backwards compatibility
      if (!Array.isArray(whiteboard.pdfCards)) {
        whiteboard.pdfCards = []
      }

      // Ensure highlightCards array exists for backwards compatibility
      if (!Array.isArray(whiteboard.highlightCards)) {
        whiteboard.highlightCards = []
      }

      // Ensure arrows array exists for backwards compatibility
      if (!Array.isArray(whiteboard.arrows)) {
        whiteboard.arrows = []
      }

      // Migrate old arrow format to new format
      // Old format: { from, to, fromSide, toSide }
      // New format: { sourceNoteId, targetNoteId, sourceSide, targetSide }
      whiteboard.arrows = whiteboard.arrows.map((arrow: any) => {
        // If arrow has old format fields, migrate them
        if (arrow.from || arrow.to) {
          return {
            ...arrow,
            sourceNoteId: arrow.sourceNoteId || arrow.from,
            targetNoteId: arrow.targetNoteId || arrow.to,
            sourceSide: arrow.sourceSide || arrow.fromSide,
            targetSide: arrow.targetSide || arrow.toSide,
            // Remove old fields
            from: undefined,
            to: undefined,
            fromSide: undefined,
            toSide: undefined,
          }
        }
        return arrow
      })

      return whiteboard
    } catch (error: any) {
      // If file doesn't exist, that's expected when creating a new whiteboard
      if (error.code === 'ENOENT') {
        return null  // Don't log error, this is normal
      }
      // Log other unexpected errors
      console.error(`Error loading whiteboard ${whiteboardId}:`, error)
      return null
    }
  }

  /**
   * Save a single whiteboard to file
   */
  private async saveWhiteboard(whiteboard: Whiteboard): Promise<void> {
    await this.ensureWhiteboardsDir()

    // Convert to validator format and validate
    const whiteboardToValidate = {
      id: whiteboard.id,
      name: whiteboard.name,
      cards: whiteboard.cards.map(c => ({
        id: c.id,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        groupId: whiteboard.groups.find(g => g.cardIds.includes(c.id))?.id,
      })),
      arrows: whiteboard.arrows.map(a => ({
        id: a.id,
        sourceNoteId: a.sourceNoteId,
        targetNoteId: a.targetNoteId,
        sourceType: a.sourceType,
        targetType: a.targetType,
        sourceSide: a.sourceSide,
        targetSide: a.targetSide,
      })),
      groups: whiteboard.groups.map(g => ({
        id: g.id,
        name: g.name,
        x: g.x || 0,
        y: g.y || 0,
        width: g.width || 400,   // Default to 400 if missing
        height: g.height || 300, // Default to 300 if missing
        color: g.color,
        memberCards: g.cardIds,
      })),
      stickyNotes: whiteboard.stickyNotes || [],
      textBoxes: whiteboard.textBoxes || [],
      pdfCards: whiteboard.pdfCards || [],
      highlightCards: whiteboard.highlightCards || [],
    }

    // Validate before saving
    const validationResult = DataValidator.validateWhiteboard(whiteboardToValidate)
    if (!validationResult.valid) {
      console.warn(`Whiteboard ${whiteboard.id} validation warnings:`, validationResult.errors)
      // Sanitize the data to fix issues
      const sanitized = DataValidator.sanitizeWhiteboard(whiteboardToValidate)

      // Convert back to original format
      whiteboard.cards = sanitized.cards.map(c => ({
        id: c.id,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        whiteboardId: whiteboard.id,
      }))

      whiteboard.groups = sanitized.groups.map(g => ({
        id: g.id,
        whiteboardId: whiteboard.id,
        name: g.name,
        cardIds: g.memberCards,
        color: g.color,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        collapsed: whiteboard.groups.find(og => og.id === g.id)?.collapsed,
        createdAt: whiteboard.groups.find(og => og.id === g.id)?.createdAt || new Date(),
        modifiedAt: new Date(),
      }))

      // Apply sanitized arrows (remove dangling arrows)
      whiteboard.arrows = sanitized.arrows.map(a => {
        const originalArrow = whiteboard.arrows.find(oa => oa.id === a.id)!
        return {
          ...originalArrow,
          id: a.id,
          sourceNoteId: a.sourceNoteId,
          targetNoteId: a.targetNoteId,
          sourceType: originalArrow.sourceType,
          targetType: originalArrow.targetType,
          sourceSide: a.sourceSide,
          targetSide: a.targetSide,
        }
      })
    }

    const whiteboardPath = path.join(this.whiteboardsDir, `${whiteboard.id}.json`)
    await this.storage.writeJSON(whiteboardPath, whiteboard)
  }

  /**
   * Load metadata from files (combines index + all whiteboards)
   * This maintains compatibility with the frontend
   */
  async loadMetadata(): Promise<WhiteboardMetadata> {
    try {
      const index = await this.loadIndex()

      // Load all whiteboards
      const whiteboards: Whiteboard[] = []
      for (const whiteboardId of index.whiteboards) {
        const whiteboard = await this.loadWhiteboard(whiteboardId)
        if (whiteboard) {
          whiteboards.push(whiteboard)
        }
      }

      // If no whiteboards loaded, create default
      if (whiteboards.length === 0) {
        const defaultWhiteboard = this.createDefaultWhiteboard()
        whiteboards.push(defaultWhiteboard)
        await this.saveWhiteboard(defaultWhiteboard)
        index.whiteboards = ['default']
        index.activeWhiteboardId = 'default'
        await this.saveIndex(index)
      }

      return {
        version: index.version,
        whiteboards,
        activeWhiteboardId: index.activeWhiteboardId
      }
    } catch (error) {
      console.error('Error loading metadata:', error)
      // Return default metadata
      return this.createDefaultMetadata()
    }
  }

  /**
   * Save metadata to files (splits into index + individual whiteboards)
   * This maintains compatibility with the frontend
   */
  async saveMetadata(metadata: WhiteboardMetadata): Promise<void> {
    try {
      await this.ensureWhiteboardsDir()

      // Save each whiteboard to its own file
      for (const whiteboard of metadata.whiteboards) {
        await this.saveWhiteboard(whiteboard)
      }

      // Save index
      const index: WhiteboardIndex = {
        version: metadata.version,
        activeWhiteboardId: metadata.activeWhiteboardId,
        whiteboards: metadata.whiteboards.map(w => w.id)
      }
      await this.saveIndex(index)
    } catch (error) {
      console.error('Error saving metadata:', error)
      throw error
    }
  }

  /**
   * Update card position
   *
   * REFACTORED: Now operates on individual whiteboards to prevent race conditions
   */
  async updateCardPosition(cardPosition: CardPosition): Promise<void> {
    // Load index to get list of all whiteboards
    const index = await this.loadIndex()

    // Remove card from all other whiteboards (a card should only be on one whiteboard)
    const removalPromises = index.whiteboards
      .filter(wbId => wbId !== cardPosition.whiteboardId)
      .map(async (wbId) => {
        const wb = await this.loadWhiteboard(wbId)
        if (wb && wb.cards.some(c => c.id === cardPosition.id)) {
          wb.cards = wb.cards.filter(c => c.id !== cardPosition.id)
          wb.modifiedAt = new Date()
          await this.saveWhiteboard(wb)
        }
      })

    await Promise.all(removalPromises)

    // Load or create the target whiteboard
    let whiteboard = await this.loadWhiteboard(cardPosition.whiteboardId)

    if (!whiteboard) {
      whiteboard = {
        id: cardPosition.whiteboardId,
        name: cardPosition.whiteboardId,
        cards: [],
        arrows: [],
        groups: [],
        stickyNotes: [],
        textBoxes: [],
        pdfCards: [],
        highlightCards: [],
        createdAt: new Date(),
        modifiedAt: new Date(),
      }

      // Add to index
      if (!index.whiteboards.includes(cardPosition.whiteboardId)) {
        index.whiteboards.push(cardPosition.whiteboardId)
        await this.saveIndex(index)
      }
    }

    // Ensure arrays exist (for backwards compatibility)
    if (!Array.isArray(whiteboard.cards)) {
      whiteboard.cards = []
    }
    if (!Array.isArray(whiteboard.arrows)) {
      whiteboard.arrows = []
    }
    if (!Array.isArray(whiteboard.groups)) {
      whiteboard.groups = []
    }
    if (!Array.isArray(whiteboard.stickyNotes)) {
      whiteboard.stickyNotes = []
    }
    if (!Array.isArray(whiteboard.textBoxes)) {
      whiteboard.textBoxes = []
    }
    if (!Array.isArray(whiteboard.pdfCards)) {
      whiteboard.pdfCards = []
    }
    if (!Array.isArray(whiteboard.highlightCards)) {
      whiteboard.highlightCards = []
    }

    // Update or add card position
    const cardIndex = whiteboard.cards.findIndex((c) => c.id === cardPosition.id)
    if (cardIndex >= 0) {
      whiteboard.cards[cardIndex] = cardPosition
    } else {
      whiteboard.cards.push(cardPosition)
    }

    // Update modifiedAt timestamp
    whiteboard.modifiedAt = new Date()

    // Save only this whiteboard (queued atomically)
    await this.saveWhiteboard(whiteboard)
  }

  /**
   * Remove a card from a specific whiteboard
   *
   * REFACTORED: Now operates on individual whiteboard to prevent race conditions
   */
  async removeCardFromWhiteboard(noteId: string, whiteboardId: string): Promise<void> {
    // Load only the specific whiteboard
    const whiteboard = await this.loadWhiteboard(whiteboardId)

    if (!whiteboard) {
      throw new Error(`Whiteboard ${whiteboardId} not found`)
    }

    // Ensure arrays exist (for backwards compatibility)
    if (!Array.isArray(whiteboard.cards)) {
      whiteboard.cards = []
    }
    if (!Array.isArray(whiteboard.arrows)) {
      whiteboard.arrows = []
    }
    if (!Array.isArray(whiteboard.groups)) {
      whiteboard.groups = []
    }
    if (!Array.isArray(whiteboard.stickyNotes)) {
      whiteboard.stickyNotes = []
    }
    if (!Array.isArray(whiteboard.textBoxes)) {
      whiteboard.textBoxes = []
    }
    if (!Array.isArray(whiteboard.pdfCards)) {
      whiteboard.pdfCards = []
    }
    if (!Array.isArray(whiteboard.highlightCards)) {
      whiteboard.highlightCards = []
    }

    // Remove the card
    whiteboard.cards = whiteboard.cards.filter((c) => c.id !== noteId)

    // Remove the card from any groups
    whiteboard.groups = whiteboard.groups.map((group) => ({
      ...group,
      cardIds: group.cardIds.filter((id) => id !== noteId),
    })).filter((group) => group.cardIds.length > 0) // Remove empty groups

    // Remove any arrows connected to this note
    whiteboard.arrows = whiteboard.arrows.filter(
      (arrow) => arrow.sourceNoteId !== noteId && arrow.targetNoteId !== noteId
    )

    // Update modifiedAt timestamp
    whiteboard.modifiedAt = new Date()

    // Save only this whiteboard (queued atomically)
    await this.saveWhiteboard(whiteboard)
  }

  /**
   * Get card positions for a whiteboard
   */
  async getCardPositions(whiteboardId: string): Promise<CardPosition[]> {
    const metadata = await this.loadMetadata()
    const whiteboard = metadata.whiteboards.find((w) => w.id === whiteboardId)
    return whiteboard?.cards || []
  }

  /**
   * Create a default whiteboard
   */
  private createDefaultWhiteboard(): Whiteboard {
    return {
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
    }
  }

  /**
   * Create default metadata
   */
  private createDefaultMetadata(): WhiteboardMetadata {
    return {
      version: '2.0',
      whiteboards: [this.createDefaultWhiteboard()],
      activeWhiteboardId: 'default',
    }
  }
}
