// Core data types

export interface Note {
  id: string
  path: string
  name: string
  title: string
  content: string
  frontmatter: Record<string, any>
  links: string[] // outgoing links (wikilinks)
  backlinks: string[] // incoming links
  tags: string[]
  createdAt: Date
  modifiedAt: Date
}

export interface VaultFile {
  path: string
  name: string
  type: 'file' | 'directory'
  children?: VaultFile[]
}

export interface CardPosition {
  id: string // note id
  x: number
  y: number
  width: number
  height: number
  whiteboardId: string
}

export interface ArrowPoint {
  x: number // relative position (0-1) on card edge for start/end, or absolute for control
  y: number
}

export interface Arrow {
  id: string
  sourceNoteId: string
  targetNoteId: string
  sourceType?: 'note' | 'textBox' | 'pdf' | 'highlight' // type of source element (defaults to 'note' for backwards compatibility)
  targetType?: 'note' | 'textBox' | 'pdf' | 'highlight' // type of target element (defaults to 'note' for backwards compatibility)
  sourcePoint: ArrowPoint // relative to source card (0-1 range for edges)
  targetPoint: ArrowPoint // relative to target card (0-1 range for edges)
  controlPoint: ArrowPoint // absolute canvas position for middle control
  whiteboardId: string
  isManual?: boolean // true for manually created arrows, undefined/false for auto-generated from links

  // New styling options (optional for backwards compatibility)
  sourceSide?: 'top' | 'right' | 'bottom' | 'left' // preferred connection side
  targetSide?: 'top' | 'right' | 'bottom' | 'left' // preferred connection side
  style?: {
    strokeColor?: string
    strokeWidth?: number
    opacity?: number
    curveType?: 'smooth' | 'straight' | 'step'
    arrowHeadType?: 'triangle' | 'circle' | 'diamond' | 'none'
    arrowHeadSize?: number
    dashEnabled?: boolean
    dashPattern?: number[]
  }
}

export interface CardGroup {
  id: string
  whiteboardId: string
  name: string // editable label
  cardIds: string[] // cards that belong to this group
  stickyNoteIds?: string[] // sticky notes that belong to this group (optional for backwards compatibility)
  textBoxIds?: string[] // text boxes that belong to this group (optional for backwards compatibility)
  pdfCardIds?: string[] // PDF cards that belong to this group (optional for backwards compatibility)
  highlightCardIds?: string[] // highlight cards that belong to this group (optional for backwards compatibility)
  color: string // background color (user-selectable)
  x: number // x position of group
  y: number // y position of group
  width: number // width of group
  height: number // height of group
  collapsed?: boolean // for future collapse feature
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
  rects: DOMRect[] // Can span multiple rectangles if text wraps
  textDivIndices: number[] // Indices of text divs in the text layer for this highlight
}

export interface PdfCard {
  id: string
  whiteboardId: string
  pdfPath: string // path to PDF file in .pdfs/ folder
  fileName: string // original file name
  title: string // display title
  x: number
  y: number
  width: number
  height: number
  thumbnailPath: string // path to thumbnail in .attachments/pdf-thumbnails/
  pageCount: number
  fileSize: number // in bytes
  createdAt: Date
  modifiedAt: Date
  lastReadPage?: number // last page number read (1-indexed)
  lastScrollPosition?: number // last vertical scroll position in pixels
  lastReadAt?: Date // timestamp of last read
  highlights?: PdfHighlight[] // stored highlights in the PDF
}

export interface HighlightCard {
  id: string
  whiteboardId: string
  sourcePdfCardId: string // reference to the source PDF card
  highlightedText: string // the text that was highlighted
  pageNumber: number // page number where highlight exists (1-indexed)
  color: string // highlight color
  x: number
  y: number
  width: number
  height: number
  createdAt: Date
  modifiedAt: Date
  // Position information for navigating back to the highlight
  scrollPosition?: number // vertical scroll position in the PDF reader
  boundingRect?: { // bounding box of the highlight in the page
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

export interface VaultMetadata {
  whiteboards: Whiteboard[]
  activeWhiteboardId: string | null
}
