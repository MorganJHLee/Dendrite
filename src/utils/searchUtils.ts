import type { Note, CardPosition, StickyNote, TextBox, PdfCard, HighlightCard, CardGroup } from '../types'

export interface SearchResult {
  id: string
  type: 'note' | 'stickyNote' | 'textBox' | 'pdfCard' | 'highlightCard' | 'group'
  title: string
  snippet?: string
  matchedIn: string // 'title', 'content', 'text', etc.
}

/**
 * Extract plain text content from markdown, removing formatting
 */
function extractPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
    .replace(/[#*_~`]/g, '') // Remove markdown formatting
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim()
}

/**
 * Create a snippet from text around the matched query with highlighted matches
 */
function createSnippet(text: string, query: string, maxLength: number = 100): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)

  if (matchIndex === -1) return text.substring(0, maxLength)

  // Get context around the match
  const start = Math.max(0, matchIndex - 30)
  const end = Math.min(text.length, matchIndex + query.length + 70)

  let snippet = text.substring(start, end)

  // Highlight all occurrences of the query in the snippet
  const snippetLower = snippet.toLowerCase()
  let highlightedSnippet = ''
  let lastIndex = 0
  let index = snippetLower.indexOf(lowerQuery)

  while (index !== -1) {
    // Add text before match
    highlightedSnippet += snippet.substring(lastIndex, index)
    // Add highlighted match wrapped in special markers
    highlightedSnippet += '<<HIGHLIGHT>>' + snippet.substring(index, index + query.length) + '<</HIGHLIGHT>>'
    lastIndex = index + query.length
    index = snippetLower.indexOf(lowerQuery, lastIndex)
  }

  // Add remaining text
  highlightedSnippet += snippet.substring(lastIndex)

  if (start > 0) highlightedSnippet = '...' + highlightedSnippet
  if (end < text.length) highlightedSnippet = highlightedSnippet + '...'

  return highlightedSnippet
}

/**
 * Highlight query matches in text
 */
function highlightText(text: string, query: string): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let highlightedText = ''
  let lastIndex = 0
  let index = lowerText.indexOf(lowerQuery)

  while (index !== -1) {
    highlightedText += text.substring(lastIndex, index)
    highlightedText += '<<HIGHLIGHT>>' + text.substring(index, index + query.length) + '<</HIGHLIGHT>>'
    lastIndex = index + query.length
    index = lowerText.indexOf(lowerQuery, lastIndex)
  }

  highlightedText += text.substring(lastIndex)
  return highlightedText
}

/**
 * Search through note cards
 */
function searchNotes(
  notes: Map<string, Note>,
  cardPositions: Map<string, CardPosition>,
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  cardPositions.forEach((cardPos, noteId) => {
    if (cardPos.whiteboardId !== whiteboardId) return

    const note = notes.get(noteId)
    if (!note) return

    const title = note.name.replace(/\.md$/, '')
    const content = extractPlainText(note.content)

    // Check title match
    if (title.toLowerCase().includes(lowerQuery)) {
      results.push({
        id: noteId,
        type: 'note',
        title: highlightText(title, query),
        snippet: content.substring(0, 100),
        matchedIn: 'title'
      })
      return
    }

    // Check content match
    if (content.toLowerCase().includes(lowerQuery)) {
      results.push({
        id: noteId,
        type: 'note',
        title,
        snippet: createSnippet(content, query),
        matchedIn: 'content'
      })
    }
  })

  return results
}

/**
 * Search through sticky notes
 */
function searchStickyNotes(
  stickyNotes: StickyNote[],
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  stickyNotes.forEach(sticky => {
    if (sticky.whiteboardId !== whiteboardId) return
    if (!sticky.text.toLowerCase().includes(lowerQuery)) return

    results.push({
      id: sticky.id,
      type: 'stickyNote',
      title: 'Sticky Note',
      snippet: createSnippet(sticky.text, query, 80),
      matchedIn: 'text'
    })
  })

  return results
}

/**
 * Search through text boxes
 */
function searchTextBoxes(
  textBoxes: TextBox[],
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  textBoxes.forEach(textBox => {
    if (textBox.whiteboardId !== whiteboardId) return
    if (!textBox.text.toLowerCase().includes(lowerQuery)) return

    results.push({
      id: textBox.id,
      type: 'textBox',
      title: 'Text Box',
      snippet: createSnippet(textBox.text, query, 80),
      matchedIn: 'text'
    })
  })

  return results
}

/**
 * Search through PDF cards
 */
function searchPdfCards(
  pdfCards: PdfCard[],
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  pdfCards.forEach(pdf => {
    if (pdf.whiteboardId !== whiteboardId) return

    const title = pdf.title || pdf.fileName
    const fileName = pdf.fileName

    if (title.toLowerCase().includes(lowerQuery) ||
        fileName.toLowerCase().includes(lowerQuery)) {
      results.push({
        id: pdf.id,
        type: 'pdfCard',
        title: highlightText(title, query),
        snippet: `PDF: ${highlightText(fileName, query)}`,
        matchedIn: 'title'
      })
    }
  })

  return results
}

/**
 * Search through highlight cards
 */
function searchHighlightCards(
  highlightCards: HighlightCard[],
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  highlightCards.forEach(highlight => {
    if (highlight.whiteboardId !== whiteboardId) return
    if (!highlight.highlightedText.toLowerCase().includes(lowerQuery)) return

    results.push({
      id: highlight.id,
      type: 'highlightCard',
      title: `Highlight (Page ${highlight.pageNumber})`,
      snippet: createSnippet(highlight.highlightedText, query, 80),
      matchedIn: 'text'
    })
  })

  return results
}

/**
 * Search through groups
 */
function searchGroups(
  groups: CardGroup[],
  query: string,
  whiteboardId: string
): SearchResult[] {
  const results: SearchResult[] = []
  const lowerQuery = query.toLowerCase()

  groups.forEach(group => {
    if (group.whiteboardId !== whiteboardId) return
    if (!group.name.toLowerCase().includes(lowerQuery)) return

    const itemCount =
      (group.cardIds?.length || 0) +
      (group.stickyNoteIds?.length || 0) +
      (group.textBoxIds?.length || 0) +
      (group.pdfCardIds?.length || 0) +
      (group.highlightCardIds?.length || 0)

    results.push({
      id: group.id,
      type: 'group',
      title: highlightText(group.name, query),
      snippet: `Group with ${itemCount} items`,
      matchedIn: 'name'
    })
  })

  return results
}

/**
 * Main search function that searches all element types in the current whiteboard
 */
export function searchWhiteboard(
  query: string,
  whiteboardId: string,
  data: {
    notes: Map<string, Note>
    cardPositions: Map<string, CardPosition>
    stickyNotes: StickyNote[]
    textBoxes: TextBox[]
    pdfCards: PdfCard[]
    highlightCards: HighlightCard[]
    groups: CardGroup[]
  }
): SearchResult[] {
  if (!query || query.trim().length === 0) return []

  const trimmedQuery = query.trim()

  const results: SearchResult[] = [
    ...searchNotes(data.notes, data.cardPositions, trimmedQuery, whiteboardId),
    ...searchStickyNotes(data.stickyNotes, trimmedQuery, whiteboardId),
    ...searchTextBoxes(data.textBoxes, trimmedQuery, whiteboardId),
    ...searchPdfCards(data.pdfCards, trimmedQuery, whiteboardId),
    ...searchHighlightCards(data.highlightCards, trimmedQuery, whiteboardId),
    ...searchGroups(data.groups, trimmedQuery, whiteboardId)
  ]

  return results
}
