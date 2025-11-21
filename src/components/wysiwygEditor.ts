import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { StateEffect, StateField, Range } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import { SyntaxNode } from '@lezer/common'
import katex from 'katex'

// Callback for handling wikilink clicks
let wikilinkClickHandler: ((link: string) => void) | null = null

export function setWikilinkClickHandler(handler: (link: string) => void) {
  wikilinkClickHandler = handler
}

// Callback for handling image paste
let imagePasteHandler: ((imageBlob: Blob) => Promise<string>) | null = null

export function setImagePasteHandler(handler: (imageBlob: Blob) => Promise<string>) {
  imagePasteHandler = handler
}

// Store vault path for image resolution
let vaultPath: string | null = null

export function setVaultPath(path: string | null) {
  vaultPath = path
}

// Effect to toggle WYSIWYG mode
const toggleWYSIWYG = StateEffect.define<boolean>()

// State field to track if WYSIWYG is enabled
const wysiwygEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleWYSIWYG)) return effect.value
    }
    return value
  },
})

// Create decorations to hide markdown syntax
function createWYSIWYGDecorations(view: EditorView): DecorationSet {
  const { state } = view
  if (!state.field(wysiwygEnabled)) return Decoration.none

  const decorations: Range<Decoration>[] = []
  const cursorPos = state.selection.main.head

  // Ensure syntax tree is fully parsed before creating decorations
  // This prevents the first H1 title from not rendering on initial load
  ensureSyntaxTree(state, state.doc.length, 1000)

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node: SyntaxNode) => {
        const nodeType = node.type.name

        // Handle different markdown elements
        switch (nodeType) {
          // Headers
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            const text = state.doc.sliceString(node.from, node.to)
            const match = text.match(/^(#+)\s/)
            if (match) {
              const syntaxEnd = node.from + match[1].length + 1
              // Show markdown if cursor is anywhere within the heading
              const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
              if (isCursorInElement) return

              // Hide the # symbols
              decorations.push(
                Decoration.replace({}).range(node.from, syntaxEnd)
              )
              // Style the heading (only if there's content after the #)
              const level = match[1].length
              if (syntaxEnd < node.to) {
                decorations.push(
                  Decoration.mark({
                    class: `cm-heading cm-heading-${level}`,
                  }).range(syntaxEnd, node.to)
                )
              }
            }
            break
          }

          // Bold
          case 'StrongEmphasis': {
            const text = state.doc.sliceString(node.from, node.to)
            if (text.startsWith('**') && text.endsWith('**')) {
              // Show markdown if cursor is anywhere within the bold text
              const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
              if (isCursorInElement) return

              // Hide opening **
              decorations.push(Decoration.replace({}).range(node.from, node.from + 2))
              // Hide closing **
              decorations.push(Decoration.replace({}).range(node.to - 2, node.to))
              // Style the content
              decorations.push(
                Decoration.mark({ class: 'cm-strong' }).range(node.from + 2, node.to - 2)
              )
            }
            break
          }

          // Italic
          case 'Emphasis': {
            const text = state.doc.sliceString(node.from, node.to)
            if (text.startsWith('*') && text.endsWith('*') && !text.startsWith('**')) {
              // Show markdown if cursor is anywhere within the italic text
              const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
              if (isCursorInElement) return

              // Hide opening *
              decorations.push(Decoration.replace({}).range(node.from, node.from + 1))
              // Hide closing *
              decorations.push(Decoration.replace({}).range(node.to - 1, node.to))
              // Style the content
              decorations.push(
                Decoration.mark({ class: 'cm-em' }).range(node.from + 1, node.to - 1)
              )
            } else if (text.startsWith('_') && text.endsWith('_')) {
              // Show markdown if cursor is anywhere within the italic text
              const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
              if (isCursorInElement) return

              // Hide opening _
              decorations.push(Decoration.replace({}).range(node.from, node.from + 1))
              // Hide closing _
              decorations.push(Decoration.replace({}).range(node.to - 1, node.to))
              // Style the content
              decorations.push(
                Decoration.mark({ class: 'cm-em' }).range(node.from + 1, node.to - 1)
              )
            }
            break
          }

          // Inline code
          case 'InlineCode': {
            const text = state.doc.sliceString(node.from, node.to)
            if (text.startsWith('`') && text.endsWith('`')) {
              // Show markdown if cursor is anywhere within the inline code
              const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
              if (isCursorInElement) return

              // Hide opening `
              decorations.push(Decoration.replace({}).range(node.from, node.from + 1))
              // Hide closing `
              decorations.push(Decoration.replace({}).range(node.to - 1, node.to))
              // Style the content
              decorations.push(
                Decoration.mark({ class: 'cm-inline-code' }).range(node.from + 1, node.to - 1)
              )
            }
            break
          }

          // Links
          case 'Link': {
            // Only show markdown if cursor is within this link element
            const isCursorInElement = cursorPos >= node.from && cursorPos <= node.to
            if (isCursorInElement) return

            // Find the link text and URL parts
            let textStart = -1
            let textEnd = -1
            let urlStart = -1
            let urlEnd = -1

            node.node.cursor().iterate((child) => {
              if (child.name === 'LinkLabel') {
                textStart = child.from + 1 // Skip [
                textEnd = child.to - 1 // Skip ]
              } else if (child.name === 'URL') {
                urlStart = child.from - 1 // Include (
                urlEnd = child.to + 1 // Include )
              }
            })

            if (textStart >= 0 && urlStart >= 0) {
              // Hide the [ before link text
              decorations.push(Decoration.replace({}).range(node.from, textStart))
              // Hide the ]( and URL and )
              decorations.push(Decoration.replace({}).range(textEnd, urlEnd))
              // Style the link text
              decorations.push(
                Decoration.mark({ class: 'cm-link' }).range(textStart, textEnd)
              )
            }
            break
          }

          // List markers
          case 'ListItem': {
            const text = state.doc.sliceString(node.from, node.to)
            const match = text.match(/^(\s*)([-*+]|\d+\.)\s/)
            if (match) {
              const markerEnd = node.from + match[0].length
              // Only show markdown if cursor is within the marker
              const isCursorInMarker = cursorPos >= node.from + match[1].length && cursorPos < markerEnd
              if (isCursorInMarker) return

              // Replace marker with a styled bullet
              decorations.push(
                Decoration.replace({
                  widget: new ListMarkerWidget(match[2]),
                }).range(node.from + match[1].length, markerEnd)
              )
            }
            break
          }

          // Blockquotes
          case 'Blockquote': {
            const lines = state.doc.sliceString(node.from, node.to).split('\n')
            let currentPos = node.from
            for (const line of lines) {
              const match = line.match(/^>\s?/)
              if (match) {
                // Only show markdown if cursor is within the > marker on this line
                const isCursorInMarker = cursorPos >= currentPos && cursorPos < currentPos + match[0].length
                if (!isCursorInMarker) {
                  // Hide the > marker
                  decorations.push(
                    Decoration.replace({}).range(currentPos, currentPos + match[0].length)
                  )
                  // Style the blockquote content
                  decorations.push(
                    Decoration.mark({ class: 'cm-blockquote' }).range(
                      currentPos + match[0].length,
                      currentPos + line.length
                    )
                  )
                }
              }
              currentPos += line.length + 1 // +1 for newline
            }
            break
          }
        }
      },
    })
  }

  // Handle wikilinks [[link]] or [[link|alias]]
  // Wikilinks are not part of standard markdown, so we need to handle them separately
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const docText = state.doc.toString()
  let wikilinkMatch

  while ((wikilinkMatch = wikilinkRegex.exec(docText)) !== null) {
    const linkStart = wikilinkMatch.index
    const linkEnd = linkStart + wikilinkMatch[0].length
    const linkContent = wikilinkMatch[1]

    // Check if this is an image (starts with !)
    const precedingChar = linkStart > 0 ? docText[linkStart - 1] : ''
    if (precedingChar === '!') {
      // This is an Obsidian image: ![[image.png]]
      // Handle it in the image processing below
      continue
    }

    // Only show markdown if cursor is within the [[ or ]] markers
    const isCursorInSyntax =
      (cursorPos >= linkStart && cursorPos < linkStart + 2) ||
      (cursorPos > linkEnd - 2 && cursorPos <= linkEnd)
    if (isCursorInSyntax) continue

    // Parse link content (handle aliases: [[link|alias]])
    let linkText = linkContent
    let displayText = linkContent

    if (linkContent.includes('|')) {
      const parts = linkContent.split('|')
      linkText = parts[0].trim()
      displayText = parts[1].trim()
    }

    // Remove heading anchor if present (link#heading)
    if (linkText.includes('#')) {
      linkText = linkText.split('#')[0].trim()
    }

    // Replace the entire wikilink with a clickable widget
    decorations.push(
      Decoration.replace({
        widget: new WikilinkWidget(linkText, displayText),
      }).range(linkStart, linkEnd)
    )
  }

  // Handle images: ![alt](url) and ![[image.png]]
  // Standard markdown images
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let markdownImageMatch

  while ((markdownImageMatch = markdownImageRegex.exec(docText)) !== null) {
    const imageStart = markdownImageMatch.index
    const imageEnd = imageStart + markdownImageMatch[0].length
    const altText = markdownImageMatch[1]
    const imageUrl = markdownImageMatch[2]

    // Only show markdown if cursor is within the image syntax
    const isCursorInSyntax =
      (cursorPos >= imageStart && cursorPos < imageStart + 2) || // In ![
      (cursorPos > imageEnd - 1 && cursorPos <= imageEnd) // In )
    if (isCursorInSyntax) continue

    // Replace the entire markdown image with an image widget
    decorations.push(
      Decoration.replace({
        widget: new ImageWidget(imageUrl, altText),
      }).range(imageStart, imageEnd)
    )
  }

  // Obsidian-style images: ![[image.png]]
  const obsidianImageRegex = /!\[\[([^\]]+)\]\]/g
  let obsidianImageMatch

  while ((obsidianImageMatch = obsidianImageRegex.exec(docText)) !== null) {
    const imageStart = obsidianImageMatch.index
    const imageEnd = imageStart + obsidianImageMatch[0].length
    const imagePath = obsidianImageMatch[1]

    // Only show markdown if cursor is within the ![[ or ]] markers
    const isCursorInSyntax =
      (cursorPos >= imageStart && cursorPos < imageStart + 3) || // In ![[
      (cursorPos > imageEnd - 2 && cursorPos <= imageEnd) // In ]]
    if (isCursorInSyntax) continue

    // Replace the entire Obsidian image with an image widget
    decorations.push(
      Decoration.replace({
        widget: new ImageWidget(imagePath, ''),
      }).range(imageStart, imageEnd)
    )
  }

  // Handle block math equations: $$...$$
  // Process block math first to avoid conflicts with inline math
  const blockMathRegex = /\$\$([^\$]+?)\$\$/g
  let blockMathMatch

  while ((blockMathMatch = blockMathRegex.exec(docText)) !== null) {
    const mathStart = blockMathMatch.index
    const mathEnd = mathStart + blockMathMatch[0].length
    const mathContent = blockMathMatch[1].trim()

    // Show markdown if cursor is anywhere within the block math
    const isCursorInElement = cursorPos >= mathStart && cursorPos <= mathEnd
    if (isCursorInElement) continue

    // Replace the entire block math with a math widget
    decorations.push(
      Decoration.replace({
        widget: new MathWidget(mathContent, true),
      }).range(mathStart, mathEnd)
    )
  }

  // Handle inline math equations: $...$
  // Use a more careful regex to avoid matching block math
  const inlineMathRegex = /(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g
  let inlineMathMatch

  while ((inlineMathMatch = inlineMathRegex.exec(docText)) !== null) {
    const mathStart = inlineMathMatch.index
    const mathEnd = mathStart + inlineMathMatch[0].length
    const mathContent = inlineMathMatch[1].trim()

    // Show markdown if cursor is anywhere within the inline math
    const isCursorInElement = cursorPos >= mathStart && cursorPos <= mathEnd
    if (isCursorInElement) continue

    // Replace the entire inline math with a math widget
    decorations.push(
      Decoration.replace({
        widget: new MathWidget(mathContent, false),
      }).range(mathStart, mathEnd)
    )
  }

  return Decoration.set(decorations.sort((a, b) => a.from - b.from))
}

// Widget for list markers
class ListMarkerWidget extends WidgetType {
  constructor(public marker: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-list-marker'
    span.textContent = this.marker + ' '
    return span
  }

  eq(other: ListMarkerWidget) {
    return this.marker === other.marker
  }

  get estimatedHeight() {
    return -1
  }

  ignoreEvent() {
    return true
  }
}

// Widget for wikilinks
class WikilinkWidget extends WidgetType {
  constructor(public linkText: string, public displayText: string) {
    super()
  }

  toDOM() {
    const link = document.createElement('a')
    link.className = 'cm-wikilink'
    link.textContent = this.displayText
    link.href = '#'
    link.onclick = (e) => {
      e.preventDefault()
      if (wikilinkClickHandler) {
        wikilinkClickHandler(this.linkText)
      }
    }
    return link
  }

  eq(other: WikilinkWidget) {
    return this.linkText === other.linkText && this.displayText === other.displayText
  }

  get estimatedHeight() {
    return -1
  }

  ignoreEvent(event: Event) {
    return event.type !== 'click'
  }
}

// Widget for images
class ImageWidget extends WidgetType {
  constructor(public imagePath: string, public altText: string) {
    super()
  }

  toDOM() {
    const container = document.createElement('span')
    container.className = 'cm-image-container'

    const img = document.createElement('img')
    img.className = 'cm-image'
    img.alt = this.altText

    // Handle different path types
    // If it's a URL (http/https), use it directly
    if (this.imagePath.startsWith('http://') || this.imagePath.startsWith('https://')) {
      img.src = this.imagePath
    } else if (this.imagePath.startsWith('data:')) {
      // If it's already a data URL, use it directly
      img.src = this.imagePath
    } else {
      // For local paths, resolve relative to vault and load via API
      const imagePath = this.imagePath.replace(/^\//, '') // Remove leading slash if present

      if (vaultPath) {
        // Try common locations for images
        const possiblePaths = [
          `${vaultPath}/.attachments/${imagePath}`,
          `${vaultPath}/${imagePath}`,
          `${vaultPath}/attachments/${imagePath}`,
          `${vaultPath}/assets/${imagePath}`,
        ]

        // Function to try loading from a path
        const tryLoadImage = async (pathIndex: number) => {
          if (pathIndex >= possiblePaths.length) {
            // All paths failed, show error
            img.style.display = 'none'
            const errorMsg = document.createElement('span')
            errorMsg.className = 'cm-image-error'
            errorMsg.textContent = `[Image not found: ${this.imagePath}]`
            container.appendChild(errorMsg)
            return
          }

          try {
            const fullPath = possiblePaths[pathIndex]
            const dataUrl = await window.electronAPI.readImageFile(fullPath)
            img.src = dataUrl
          } catch (error) {
            // Try next path
            tryLoadImage(pathIndex + 1)
          }
        }

        // Start trying from first path
        tryLoadImage(0)
      } else {
        // No vault path available
        const errorMsg = document.createElement('span')
        errorMsg.className = 'cm-image-error'
        errorMsg.textContent = `[Image not found: ${this.imagePath}]`
        container.appendChild(errorMsg)
      }
    }

    container.appendChild(img)
    return container
  }

  eq(other: ImageWidget) {
    return this.imagePath === other.imagePath && this.altText === other.altText
  }

  get estimatedHeight() {
    return -1
  }

  ignoreEvent() {
    return true
  }
}

// Widget for math equations
class MathWidget extends WidgetType {
  constructor(public mathContent: string, public isBlock: boolean) {
    super()
  }

  toDOM() {
    const container = document.createElement(this.isBlock ? 'div' : 'span')
    container.className = this.isBlock ? 'cm-math-block' : 'cm-math-inline'

    try {
      // Render the LaTeX using KaTeX
      katex.render(this.mathContent, container, {
        displayMode: this.isBlock,
        throwOnError: false,
        output: 'html',
      })
    } catch (error) {
      // If rendering fails, show error message
      container.className = 'cm-math-error'
      container.textContent = `[Math Error: ${error instanceof Error ? error.message : 'Invalid LaTeX'}]`
    }

    return container
  }

  eq(other: MathWidget) {
    return this.mathContent === other.mathContent && this.isBlock === other.isBlock
  }

  get estimatedHeight() {
    return -1
  }

  ignoreEvent() {
    return true
  }
}

// ViewPlugin to manage WYSIWYG decorations
const wysiwygPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private hasInitialUpdate = false

    constructor(_view: EditorView) {
      // Start with empty decorations - the first update will populate them
      // This ensures the syntax tree and viewport are fully ready
      this.decorations = Decoration.none
    }

    update(update: ViewUpdate) {
      // Force initial decoration creation on first update
      if (!this.hasInitialUpdate) {
        this.hasInitialUpdate = true
        this.decorations = createWYSIWYGDecorations(update.view)
        return
      }

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.state.field(wysiwygEnabled) !== update.startState.field(wysiwygEnabled)
      ) {
        this.decorations = createWYSIWYGDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

// Base theme for WYSIWYG styling
const wysiwygTheme = EditorView.baseTheme({
  '&': {
    fontSize: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  '.cm-content': {
    padding: '20px',
    lineHeight: '1.6',
    color: '#1f2937',
  },
  '.cm-line': {
    padding: '2px 0',
    color: '#1f2937',
  },

  // Headings
  '.cm-heading': {
    fontWeight: 'bold',
    lineHeight: '1.3',
    color: '#111827',
  },
  '.cm-heading-1': {
    fontSize: '2em',
    borderBottom: '1px solid #e0e0e0',
    paddingBottom: '0.3em',
    marginTop: '0.67em',
    marginBottom: '0.67em',
  },
  '.cm-heading-2': {
    fontSize: '1.5em',
    borderBottom: '1px solid #e0e0e0',
    paddingBottom: '0.3em',
    marginTop: '0.83em',
    marginBottom: '0.83em',
  },
  '.cm-heading-3': {
    fontSize: '1.25em',
    marginTop: '1em',
    marginBottom: '1em',
  },
  '.cm-heading-4': {
    fontSize: '1em',
    marginTop: '1.33em',
    marginBottom: '1.33em',
  },
  '.cm-heading-5': {
    fontSize: '0.875em',
    marginTop: '1.67em',
    marginBottom: '1.67em',
  },
  '.cm-heading-6': {
    fontSize: '0.85em',
    color: '#4b5563',
    marginTop: '2.33em',
    marginBottom: '2.33em',
  },

  // Text formatting
  '.cm-strong': {
    fontWeight: 'bold',
    color: '#111827',
  },
  '.cm-em': {
    fontStyle: 'italic',
    color: '#1f2937',
  },
  '.cm-inline-code': {
    fontFamily: 'monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    padding: '2px 4px',
    borderRadius: '3px',
    fontSize: '0.9em',
    color: '#1f2937',
  },

  // Links
  '.cm-link': {
    color: '#0366d6',
    textDecoration: 'underline',
    cursor: 'pointer',
  },

  // Wikilinks
  '.cm-wikilink': {
    color: '#667eea',
    textDecoration: 'none',
    cursor: 'pointer',
    fontWeight: '500',
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'rgba(102, 126, 234, 0.1)',
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: 'rgba(102, 126, 234, 0.2)',
      textDecoration: 'underline',
    },
  },

  // Lists
  '.cm-list-marker': {
    color: '#4b5563',
    fontWeight: 'bold',
    marginRight: '0.5em',
  },

  // Blockquotes
  '.cm-blockquote': {
    color: '#4b5563',
    borderLeft: '4px solid #ddd',
    paddingLeft: '1em',
    fontStyle: 'italic',
  },

  // Images
  '.cm-image-container': {
    display: 'inline-block',
    maxWidth: '100%',
    margin: '8px 0',
    lineHeight: '0',
  },
  '.cm-image': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    display: 'block',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  '.cm-image-error': {
    color: '#ef4444',
    fontSize: '0.875em',
    fontStyle: 'italic',
    padding: '4px 8px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '4px',
    display: 'inline-block',
  },

  // Math equations
  '.cm-math-inline': {
    display: 'inline',
    padding: '2px 4px',
    margin: '0 2px',
  },
  '.cm-math-block': {
    display: 'block',
    padding: '12px',
    margin: '12px 0',
    textAlign: 'center',
    overflow: 'auto',
  },
  '.cm-math-error': {
    color: '#ef4444',
    fontSize: '0.875em',
    fontStyle: 'italic',
    padding: '4px 8px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: '4px',
    display: 'inline-block',
  },

  // Cursor
  '.cm-cursor': {
    borderLeftColor: '#000',
  },

  // Selection
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#d7d4f0 !important',
  },

  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#d7d4f0 !important',
  },
})

// Extension to handle paste events for images
const imagePasteExtension = EditorView.domEventHandlers({
  paste: (event, view) => {
    if (!imagePasteHandler) return false

    const clipboardData = event.clipboardData
    if (!clipboardData) return false

    // Check if clipboard contains image
    const items = Array.from(clipboardData.items)
    const imageItem = items.find(item => item.type.startsWith('image/'))

    if (!imageItem) return false

    event.preventDefault()

    // Get image blob
    const imageBlob = imageItem.getAsFile()
    if (!imageBlob) return true

    // Handle the async operation without making the function async
    ;(async () => {
      try {
        // Call the handler to save the image and get the filename
        const filename = await imagePasteHandler(imageBlob)

        // Insert markdown syntax at cursor position
        const cursorPos = view.state.selection.main.head
        const imageMarkdown = `![[${filename}]]\n`

        view.dispatch({
          changes: {
            from: cursorPos,
            to: cursorPos,
            insert: imageMarkdown,
          },
          selection: {
            anchor: cursorPos + imageMarkdown.length,
          },
        })
      } catch (error) {
        console.error('Error pasting image:', error)
        alert('Failed to paste image: ' + (error instanceof Error ? error.message : 'Unknown error'))
      }
    })()

    return true
  },
})

// Export the extensions needed for WYSIWYG editing
export function createWYSIWYGExtensions() {
  return [
    markdown(),
    wysiwygEnabled,
    wysiwygPlugin,
    wysiwygTheme,
    imagePasteExtension,
    EditorView.lineWrapping,
  ]
}

// Export the toggle effect
export { toggleWYSIWYG }
