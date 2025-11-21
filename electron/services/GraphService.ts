import path from 'path'
import { FileSystemService } from './FileSystemService'
import { MarkdownParser, ParsedNote } from './MarkdownParser'

export interface Note {
  id: string
  path: string
  name: string
  title: string
  content: string
  frontmatter: Record<string, any>
  links: string[]
  backlinks: string[]
  tags: string[]
  createdAt: Date
  modifiedAt: Date
}

export interface GraphNode {
  id: string
  label: string
  data: Note
}

export interface GraphEdge {
  source: string
  target: string
  type: 'link' | 'backlink'
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export class GraphService {
  private fileSystemService: FileSystemService
  private markdownParser: MarkdownParser
  private notes: Map<string, Note>
  private vaultPath: string

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
    this.fileSystemService = new FileSystemService()
    this.markdownParser = new MarkdownParser()
    this.notes = new Map()
  }

  /**
   * Build the complete graph from all markdown files in the vault
   */
  async buildGraph(): Promise<Graph> {
    // 1. Get all markdown files
    const markdownFiles = await this.fileSystemService.getAllMarkdownFiles(this.vaultPath)

    // 2. Parse all files and create notes
    this.notes.clear()
    const parsePromises = markdownFiles.map((filePath) => this.parseNote(filePath))
    await Promise.all(parsePromises)

    // 3. Compute backlinks
    this.computeBacklinks()

    // 4. Build graph structure
    return this.buildGraphStructure()
  }

  /**
   * Parse a single note from a file
   */
  private async parseNote(filePath: string): Promise<void> {
    try {
      const content = await this.fileSystemService.readFile(filePath)
      const parsed = this.markdownParser.parse(content, filePath)
      const stats = await this.getFileStats(filePath)

      const id = MarkdownParser.getNoteId(filePath, this.vaultPath)

      const note: Note = {
        id,
        path: filePath,
        name: path.basename(filePath, '.md'),
        title: parsed.title,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        links: parsed.links,
        backlinks: [],
        tags: parsed.tags,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      }

      this.notes.set(id, note)
    } catch (error) {
      console.error('Error parsing note:', filePath, error)
    }
  }

  /**
   * Get file statistics
   */
  private async getFileStats(filePath: string): Promise<{ birthtime: Date; mtime: Date }> {
    const fs = await import('fs/promises')
    const stats = await fs.stat(filePath)
    return {
      birthtime: stats.birthtime,
      mtime: stats.mtime,
    }
  }

  /**
   * Compute backlinks for all notes
   * A backlink from note B to note A means note B links to note A
   */
  private computeBacklinks(): void {
    // Reset all backlinks
    for (const note of this.notes.values()) {
      note.backlinks = []
    }

    // For each note, add backlink to its linked notes
    for (const note of this.notes.values()) {
      for (const link of note.links) {
        // Find the target note
        const targetNote = this.findNoteByLink(link)
        if (targetNote && targetNote.id !== note.id) {
          targetNote.backlinks.push(note.id)
        }
      }
    }
  }

  /**
   * Find a note by wikilink
   * This handles various link formats and tries to find a match
   */
  private findNoteByLink(link: string): Note | undefined {
    // Normalize link (remove .md if present)
    const normalizedLink = link.replace(/\.md$/, '').replace(/\\/g, '/')

    // Try exact match first
    let targetNote = this.notes.get(normalizedLink)
    if (targetNote) return targetNote

    // Try finding by name (case-insensitive)
    const linkName = path.basename(normalizedLink).toLowerCase()
    for (const note of this.notes.values()) {
      if (note.name.toLowerCase() === linkName) {
        return note
      }
    }

    // Try finding by title (case-insensitive)
    for (const note of this.notes.values()) {
      if (note.title.toLowerCase() === linkName) {
        return note
      }
    }

    return undefined
  }

  /**
   * Build graph structure from notes
   */
  private buildGraphStructure(): Graph {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const edgeSet = new Set<string>() // To avoid duplicate edges

    for (const note of this.notes.values()) {
      // Add node
      nodes.push({
        id: note.id,
        label: note.title,
        data: note,
      })

      // Add edges for links
      for (const link of note.links) {
        const targetNote = this.findNoteByLink(link)
        if (targetNote && targetNote.id !== note.id) {
          const edgeKey = `${note.id}->${targetNote.id}`
          if (!edgeSet.has(edgeKey)) {
            edges.push({
              source: note.id,
              target: targetNote.id,
              type: 'link',
            })
            edgeSet.add(edgeKey)
          }
        }
      }
    }

    return { nodes, edges }
  }

  /**
   * Get a specific note by ID
   */
  getNote(id: string): Note | undefined {
    return this.notes.get(id)
  }

  /**
   * Get all notes
   */
  getAllNotes(): Note[] {
    return Array.from(this.notes.values())
  }

  /**
   * Get local graph for a specific note (note + connected notes)
   */
  getLocalGraph(noteId: string, depth: number = 1): Graph {
    const note = this.notes.get(noteId)
    if (!note) {
      return { nodes: [], edges: [] }
    }

    const connectedNoteIds = new Set<string>([noteId])
    const nodesToProcess = [noteId]

    // BFS to find connected notes up to specified depth
    for (let i = 0; i < depth; i++) {
      const currentLevel = [...nodesToProcess]
      nodesToProcess.length = 0

      for (const id of currentLevel) {
        const currentNote = this.notes.get(id)
        if (!currentNote) continue

        // Add linked notes
        for (const link of currentNote.links) {
          const targetNote = this.findNoteByLink(link)
          if (targetNote && !connectedNoteIds.has(targetNote.id)) {
            connectedNoteIds.add(targetNote.id)
            nodesToProcess.push(targetNote.id)
          }
        }

        // Add backlinked notes
        for (const backlinkId of currentNote.backlinks) {
          if (!connectedNoteIds.has(backlinkId)) {
            connectedNoteIds.add(backlinkId)
            nodesToProcess.push(backlinkId)
          }
        }
      }
    }

    // Build subgraph
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const edgeSet = new Set<string>()

    for (const id of connectedNoteIds) {
      const note = this.notes.get(id)
      if (!note) continue

      nodes.push({
        id: note.id,
        label: note.title,
        data: note,
      })

      // Add edges only between connected notes
      for (const link of note.links) {
        const targetNote = this.findNoteByLink(link)
        if (targetNote && connectedNoteIds.has(targetNote.id)) {
          const edgeKey = `${note.id}->${targetNote.id}`
          if (!edgeSet.has(edgeKey)) {
            edges.push({
              source: note.id,
              target: targetNote.id,
              type: 'link',
            })
            edgeSet.add(edgeKey)
          }
        }
      }
    }

    return { nodes, edges }
  }
}
