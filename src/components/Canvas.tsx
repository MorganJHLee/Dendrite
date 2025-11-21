import React, { useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef } from 'react'
import { Edit, Trash2, X } from 'lucide-react'
import { Stage, Layer, Rect, Text, Group, Line, Circle, Image as KonvaImage } from 'react-konva'
import { useVaultStore } from '../store/vaultStore'
import type { Note, CardPosition, Arrow, CardGroup, StickyNote, TextBox, PdfCard, HighlightCard } from '../types'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'
import RenameModal from './RenameModal'
import GroupNameModal from './GroupNameModal'
import ColorPickerModal from './ColorPickerModal'
import StickyNoteEditorModal from './StickyNoteEditorModal'
import SmartArrow from './SmartArrow'
import ConnectionPoint from './ConnectionPoint'
import { ArrowStylePresets } from '../utils/arrowUtils'
import type { Rect as RectType } from '../utils/arrowUtils'
import { useConfirm } from '../hooks/useConfirm'
import { calculateAlignmentGuides, type AlignmentGuide } from '../utils/layoutUtils'
import { searchWhiteboard } from '../utils/searchUtils'
import { getAttachmentsFolderPath } from '../services/imageService'
import { PdfCardComponent } from './PdfCardComponent'
import { HighlightCardComponent } from './HighlightCardComponent'
import { PdfReaderModal } from './PdfReaderModal'
import { HighlightTextModal } from './HighlightTextModal'
import './Canvas.css'

interface NoteCardProps {
  note: Note
  position: CardPosition
  isSelected: boolean
  onSelect: (e: any) => void
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onResize: (width: number, height: number) => void
  onDoubleClick: () => void
  onContextMenu: (e: any) => void
  isSearchActive?: boolean
  isSearchMatched?: boolean
}

interface ContextMenuState {
  x: number
  y: number
  noteId: string
}

// Constants for resize behavior
const RESIZE_ZONE = 12 // pixels for resize detection (increased from 8 for better UX)

// Smart content extraction utilities
interface ContentBlock {
  type: 'paragraph' | 'callout' | 'list' | 'quote' | 'image'
  content: string
  metadata?: {
    calloutType?: string
    imagePath?: string
    imageAlt?: string
    listType?: 'bullet' | 'ordered'
  }
}

/**
 * Extract smart content from markdown, prioritizing meaningful content
 */
function extractSmartContent(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = []

  // Remove frontmatter (YAML at the beginning)
  let content = markdown.replace(/^---\n[\s\S]*?\n---\n/, '')

  const lines = content.split('\n')
  let i = 0

  while (i < lines.length && blocks.length < 10) {
    const line = lines[i].trim()

    // Skip empty lines
    if (!line) {
      i++
      continue
    }

    // Detect callouts: > [!note], > [!warning], etc.
    const calloutMatch = line.match(/^>\s*\[!(\w+)\](.*)/)
    if (calloutMatch) {
      const calloutType = calloutMatch[1].toLowerCase()
      let calloutContent = calloutMatch[2].trim()

      // Collect multi-line callout content
      i++
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const calloutLine = lines[i].trim().substring(1).trim()
        if (calloutLine) {
          calloutContent += ' ' + calloutLine
        }
        i++
      }

      blocks.push({
        type: 'callout',
        content: calloutContent,
        metadata: { calloutType }
      })
      continue
    }

    // Detect images: ![alt](path) or ![[path]]
    const markdownImageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/)
    const obsidianImageMatch = line.match(/!\[\[([^\]]+)\]\]/)

    if (markdownImageMatch) {
      blocks.push({
        type: 'image',
        content: '',
        metadata: {
          imageAlt: markdownImageMatch[1],
          imagePath: markdownImageMatch[2]
        }
      })
      i++
      continue
    }

    if (obsidianImageMatch) {
      let imagePath = obsidianImageMatch[1]
      // Handle Obsidian image with alias: ![[image.png|alt text]]
      const pipeIndex = imagePath.indexOf('|')
      let imageAlt = ''
      if (pipeIndex !== -1) {
        imageAlt = imagePath.substring(pipeIndex + 1)
        imagePath = imagePath.substring(0, pipeIndex)
      }

      blocks.push({
        type: 'image',
        content: '',
        metadata: {
          imageAlt,
          imagePath
        }
      })
      i++
      continue
    }

    // Detect block quotes
    if (line.startsWith('>')) {
      let quoteContent = line.substring(1).trim()

      // Collect multi-line quote
      i++
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const quoteLine = lines[i].trim().substring(1).trim()
        if (quoteLine) {
          quoteContent += ' ' + quoteLine
        }
        i++
      }

      blocks.push({
        type: 'quote',
        content: quoteContent
      })
      continue
    }

    // Detect lists
    const bulletMatch = line.match(/^[-*+]\s+(.+)/)
    const orderedMatch = line.match(/^\d+\.\s+(.+)/)

    if (bulletMatch || orderedMatch) {
      let listContent = bulletMatch ? bulletMatch[1] : orderedMatch![1]
      const listType = bulletMatch ? 'bullet' : 'ordered'

      // Collect multi-line list (up to 3 items for preview)
      i++
      let itemCount = 1
      while (i < lines.length && itemCount < 3) {
        const nextLine = lines[i].trim()
        const nextBullet = nextLine.match(/^[-*+]\s+(.+)/)
        const nextOrdered = nextLine.match(/^\d+\.\s+(.+)/)

        if ((listType === 'bullet' && nextBullet) || (listType === 'ordered' && nextOrdered)) {
          listContent += '\n' + (nextBullet ? nextBullet[1] : nextOrdered![1])
          itemCount++
          i++
        } else {
          break
        }
      }

      blocks.push({
        type: 'list',
        content: listContent,
        metadata: { listType }
      })
      continue
    }

    // Skip headers and code blocks for now, treat as regular paragraphs
    if (line.startsWith('#')) {
      i++
      continue
    }

    if (line.startsWith('```')) {
      // Skip code blocks
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        i++
      }
      i++ // Skip closing ```
      continue
    }

    // Regular paragraph - collect until empty line
    let paragraphContent = line
    i++

    while (i < lines.length) {
      const nextLine = lines[i].trim()

      // Stop at empty line, header, list, quote, or special syntax
      if (!nextLine || nextLine.startsWith('#') ||
          nextLine.startsWith('>') || nextLine.match(/^[-*+]\s/) ||
          nextLine.match(/^\d+\.\s/) || nextLine.startsWith('```') ||
          nextLine.match(/^!\[/)) {
        break
      }

      paragraphContent += ' ' + nextLine
      i++
    }

    // Add paragraph if it has meaningful content
    if (paragraphContent.length > 10) {
      blocks.push({
        type: 'paragraph',
        content: paragraphContent
      })
    }
  }

  return blocks
}

/**
 * Hook to load an image for Konva rendering
 */
function useLoadImage(imagePath: string | null, vaultPath: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!imagePath || !vaultPath) {
      setImage(null)
      return
    }

    const loadImageAsync = async () => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'

      try {
        let dataUrl: string

        if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
          // External URL - can load directly
          dataUrl = imagePath
        } else {
          // Local file - use Electron API to read as data URL
          let fullPath: string
          if (imagePath.startsWith('/')) {
            // Absolute path
            fullPath = imagePath
          } else {
            // Relative path - assume it's in attachments folder
            const attachmentsPath = getAttachmentsFolderPath(vaultPath)
            fullPath = `${attachmentsPath}/${imagePath}`
          }

          // Use Electron API to read image file as data URL
          dataUrl = await window.electronAPI.readImageFile(fullPath)
        }

        img.onload = () => {
          setImage(img)
        }

        img.onerror = () => {
          console.error('Failed to load image:', imagePath)
          setImage(null)
        }

        img.src = dataUrl
      } catch (error) {
        console.error('Failed to load image:', imagePath, error)
        setImage(null)
      }
    }

    loadImageAsync()

    return () => {
      setImage(null)
    }
  }, [imagePath, vaultPath])

  return image
}

/**
 * ImageThumbnail component for rendering image thumbnails in card preview
 */
interface ImageThumbnailProps {
  imagePath: string
  vaultPath: string | null
  x: number
  y: number
  maxWidth: number
  maxHeight: number
}

function ImageThumbnail({ imagePath, vaultPath, x, y, maxWidth, maxHeight }: ImageThumbnailProps) {
  const image = useLoadImage(imagePath, vaultPath)

  if (!image) {
    // Show placeholder while loading or if failed to load
    return (
      <Group>
        <Rect
          x={x}
          y={y}
          width={maxWidth}
          height={80}
          fill="rgba(240, 240, 240, 0.5)"
          stroke="rgba(200, 200, 200, 0.5)"
          strokeWidth={1}
          cornerRadius={4}
        />
        <Text
          x={x}
          y={y + 30}
          text="🖼️ Loading image..."
          fontSize={12}
          fill="rgba(100, 100, 100, 0.7)"
          width={maxWidth}
          align="center"
        />
      </Group>
    )
  }

  // Calculate dimensions to fit within maxWidth and maxHeight while preserving aspect ratio
  const aspectRatio = image.width / image.height
  let displayWidth = maxWidth
  let displayHeight = displayWidth / aspectRatio

  if (displayHeight > maxHeight) {
    displayHeight = maxHeight
    displayWidth = displayHeight * aspectRatio
  }

  return (
    <Group>
      {/* Image container with subtle border */}
      <Rect
        x={x}
        y={y}
        width={displayWidth}
        height={displayHeight}
        stroke="rgba(200, 200, 200, 0.3)"
        strokeWidth={1}
        cornerRadius={4}
      />
      {/* Actual image */}
      <KonvaImage
        x={x}
        y={y}
        image={image}
        width={displayWidth}
        height={displayHeight}
        cornerRadius={4}
      />
    </Group>
  )
}

function NoteCard({ note, position, isSelected, onSelect, onDragStart, onDragMove, onDragEnd, onResize, onDoubleClick, onContextMenu, isSearchActive, isSearchMatched }: NoteCardProps) {
  const vaultPath = useVaultStore((state: any) => state.vaultPath)
  const [isDragging, setIsDragging] = useState(false)
  const [resizeMode, setResizeMode] = useState<'none' | 'width' | 'height' | 'both'>('none')
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const groupRef = useRef<any>(null)

  // Calculate opacity based on search state
  const searchOpacity = isSearchActive && !isSearchMatched ? 0.25 : 1

  // Global mouse handlers for resize - tracks mouse even outside card boundaries
  useEffect(() => {
    if (resizeMode === 'none') return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const stage = groupRef.current?.getStage()
      if (!stage) return

      // Get mouse position relative to stage
      const rect = stage.container().getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const currentX = x / stage.scaleX() - stage.x() / stage.scaleX()
      const currentY = y / stage.scaleY() - stage.y() / stage.scaleY()

      const deltaX = currentX - resizeStart.x
      const deltaY = currentY - resizeStart.y

      let newWidth = position.width
      let newHeight = position.height

      if (resizeMode === 'width' || resizeMode === 'both') {
        newWidth = Math.max(200, Math.min(600, resizeStart.width + deltaX))
      }

      if (resizeMode === 'height' || resizeMode === 'both') {
        newHeight = Math.max(150, Math.min(600, resizeStart.height + deltaY))
      }

      // Only update if dimensions actually changed
      if (newWidth !== position.width || newHeight !== position.height) {
        onResize(newWidth, newHeight)
      }
    }

    const handleGlobalMouseUp = () => {
      setResizeMode('none')
      // Reset cursor to default
      const stage = groupRef.current?.getStage()
      const container = stage?.container()
      if (container) {
        container.style.cursor = 'default'
      }
    }

    // Attach global listeners
    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [resizeMode, resizeStart, position.width, position.height, onResize])

  // Memoized markdown content rendering using smart content extraction
  const markdownContent = useMemo(() => {
    const yStart = note.tags.length > 0 ? 76 : 58
    const availableHeight = position.height - (note.tags.length > 0 ? 96 : 78)
    const availableWidth = position.width - 40

    // Extract smart content blocks
    const contentBlocks = extractSmartContent(note.content)
    const elements: any[] = []
    let currentY = yStart

    // Helper function to render text with formatting preserved
    const renderFormattedText = (text: string, blockIndex: number, baseColor: string = "#5a6c7d"): any[] => {
      const textElements: any[] = []

      // Parse for bold, italic, and special syntax
      const segments: Array<{ text: string; style: 'normal' | 'bold' | 'italic' | 'bolditalic' | 'wikilink' | 'math' | 'code' }> = []
      let currentPos = 0

      // Combined regex for all formatting types
      const formatRegex = /(\*\*\*(.+?)\*\*\*)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_{3}(.+?)_{3})|(__(.+?)__)|(_(.+?)_)|(`(.+?)`)|(\[\[([^\]]+)\]\])|(\$([^\$\n]+?)\$)/g
      let match

      while ((match = formatRegex.exec(text)) !== null) {
        // Add normal text before match
        if (match.index > currentPos) {
          segments.push({ text: text.substring(currentPos, match.index), style: 'normal' })
        }

        // Add formatted text
        if (match[1]) { // ***bold italic***
          segments.push({ text: match[2], style: 'bolditalic' })
        } else if (match[3]) { // **bold**
          segments.push({ text: match[4], style: 'bold' })
        } else if (match[5]) { // *italic*
          segments.push({ text: match[6], style: 'italic' })
        } else if (match[7]) { // ___bold italic___
          segments.push({ text: match[8], style: 'bolditalic' })
        } else if (match[9]) { // __bold__
          segments.push({ text: match[10], style: 'bold' })
        } else if (match[11]) { // _italic_
          segments.push({ text: match[12], style: 'italic' })
        } else if (match[13]) { // `code`
          segments.push({ text: match[14], style: 'code' })
        } else if (match[15]) { // [[wikilink]]
          const linkContent = match[16]
          const displayText = linkContent.includes('|') ? linkContent.split('|')[1] : linkContent
          segments.push({ text: displayText, style: 'wikilink' })
        } else if (match[17]) { // $math$
          segments.push({ text: match[18], style: 'math' })
        }

        currentPos = match.index + match[0].length
      }

      // Add remaining text
      if (currentPos < text.length) {
        segments.push({ text: text.substring(currentPos), style: 'normal' })
      }

      // If no formatting found, add whole text as normal
      if (segments.length === 0) {
        segments.push({ text, style: 'normal' })
      }

      // Render segments as inline text elements
      let currentX = 20
      const fontSize = 13

      segments.forEach((segment, segIndex) => {
        let fill = baseColor
        let fontStyle = "normal"

        switch (segment.style) {
          case 'bold':
            fontStyle = "bold"
            break
          case 'italic':
            fontStyle = "italic"
            break
          case 'bolditalic':
            fontStyle = "bold italic"
            break
          case 'wikilink':
            fill = "rgba(102, 126, 234, 0.9)"
            fontStyle = "500"
            break
          case 'math':
            fill = "rgba(147, 51, 234, 0.9)"
            fontStyle = "500"
            break
          case 'code':
            fill = "rgba(220, 38, 38, 0.8)"
            fontStyle = "500"
            break
        }

        textElements.push(
          <Text
            key={`block-${blockIndex}-seg-${segIndex}`}
            x={currentX}
            y={currentY}
            text={segment.text}
            fontSize={fontSize}
            fontStyle={fontStyle}
            fontFamily={segment.style === 'code' ? 'Monaco, Consolas, monospace' : undefined}
            fill={fill}
            wrap="none"
          />
        )

        // Approximate width
        currentX += segment.text.length * (fontSize * 0.6)
      })

      return textElements
    }

    // Render each content block
    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]

      // Stop if we exceed available height
      if (currentY >= yStart + availableHeight) break

      switch (block.type) {
        case 'image': {
          // Image will be rendered separately below using ImageComponent
          elements.push(
            <ImageThumbnail
              key={`block-${i}`}
              imagePath={block.metadata?.imagePath || ''}
              vaultPath={vaultPath}
              x={20}
              y={currentY}
              maxWidth={availableWidth}
              maxHeight={Math.min(150, availableHeight - (currentY - yStart))}
            />
          )
          currentY += Math.min(150, availableHeight - (currentY - yStart)) + 8
          break
        }

        case 'callout': {
          const calloutType = block.metadata?.calloutType || 'note'

          // Callout colors based on type
          const calloutColors: { [key: string]: { bg: string; border: string; icon: string } } = {
            note: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.5)', icon: '📝' },
            warning: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.5)', icon: '⚠️' },
            tip: { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.5)', icon: '💡' },
            important: { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.5)', icon: '❗' },
            caution: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.5)', icon: '🔥' },
          }

          const colors = calloutColors[calloutType] || calloutColors.note

          // Callout background
          const calloutHeight = 50
          elements.push(
            <Rect
              key={`callout-bg-${i}`}
              x={20}
              y={currentY}
              width={availableWidth}
              height={calloutHeight}
              fill={colors.bg}
              stroke={colors.border}
              strokeWidth={2}
              cornerRadius={6}
            />
          )

          // Callout icon
          elements.push(
            <Text
              key={`callout-icon-${i}`}
              x={28}
              y={currentY + 15}
              text={colors.icon}
              fontSize={16}
            />
          )

          // Callout content
          elements.push(
            <Text
              key={`callout-text-${i}`}
              x={52}
              y={currentY + 15}
              text={block.content}
              fontSize={12}
              fill="#2d3748"
              width={availableWidth - 40}
              wrap="word"
              ellipsis={true}
              height={calloutHeight - 20}
            />
          )

          currentY += calloutHeight + 10
          break
        }

        case 'quote': {
          // Quote bar
          elements.push(
            <Rect
              key={`quote-bar-${i}`}
              x={20}
              y={currentY}
              width={3}
              height={40}
              fill="rgba(102, 126, 234, 0.5)"
              cornerRadius={2}
            />
          )

          // Quote text
          elements.push(
            <Text
              key={`quote-text-${i}`}
              x={32}
              y={currentY + 8}
              text={block.content}
              fontSize={13}
              fontStyle="italic"
              fill="rgba(90, 108, 125, 0.9)"
              width={availableWidth - 20}
              wrap="word"
              ellipsis={true}
              height={40}
            />
          )

          currentY += 48
          break
        }

        case 'list': {
          const listItems = block.content.split('\n')
          const bullet = block.metadata?.listType === 'bullet' ? '•' : '1.'

          listItems.forEach((item, idx) => {
            if (currentY >= yStart + availableHeight) return

            // Bullet/number
            elements.push(
              <Text
                key={`list-bullet-${i}-${idx}`}
                x={24}
                y={currentY}
                text={block.metadata?.listType === 'ordered' ? `${idx + 1}.` : bullet}
                fontSize={13}
                fill="#5a6c7d"
              />
            )

            // List item text with formatting
            const formatted = renderFormattedText(item, i * 100 + idx)
            formatted.forEach(el => {
              const newEl = React.cloneElement(el, { x: 40 })
              elements.push(newEl)
            })

            currentY += 21
          })

          currentY += 4 // Extra spacing after list
          break
        }

        case 'paragraph': {
          // Render paragraph with formatting preserved
          const formatted = renderFormattedText(block.content, i)
          elements.push(...formatted)
          currentY += 21

          // Wrap to next line if text is too long (simplified wrapping)
          const estimatedLines = Math.ceil(block.content.length / 40)
          if (estimatedLines > 1) {
            currentY += (estimatedLines - 1) * 21
          }

          currentY += 4 // Paragraph spacing
          break
        }
      }
    }

    return elements
  }, [note.content, note.tags.length, position.width, position.height, vaultPath])

  const handleResizeMouseDown = (e: any, mode: 'width' | 'height' | 'both') => {
    e.cancelBubble = true
    const stage = e.target.getStage()
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    setResizeMode(mode)
    setResizeStart({
      x: pos.x / stage.scaleX() - stage.x() / stage.scaleX(),
      y: pos.y / stage.scaleY() - stage.y() / stage.scaleY(),
      width: position.width,
      height: position.height
    })
  }

  const handleMouseMove = (e: any) => {
    // Only update cursor when not resizing (during resize, global handler manages everything)
    if (resizeMode !== 'none') return

    // Update cursor based on position
    const stage = e.target.getStage()
    const container = stage?.container()
    if (!container) return

    const pos = e.target.getRelativePointerPosition()
    if (!pos) return

    const atRight = pos.x >= position.width - RESIZE_ZONE && pos.x <= position.width
    const atBottom = pos.y >= position.height - RESIZE_ZONE && pos.y <= position.height

    if (atRight && atBottom) {
      container.style.cursor = 'nwse-resize'
    } else if (atRight) {
      container.style.cursor = 'ew-resize'
    } else if (atBottom) {
      container.style.cursor = 'ns-resize'
    } else {
      container.style.cursor = 'default'
    }
  }

  const handleMouseDown = (e: any) => {
    const pos = e.target.getRelativePointerPosition()
    if (!pos) return

    const atRight = pos.x >= position.width - RESIZE_ZONE && pos.x <= position.width
    const atBottom = pos.y >= position.height - RESIZE_ZONE && pos.y <= position.height

    if (atRight && atBottom) {
      handleResizeMouseDown(e, 'both')
    } else if (atRight) {
      handleResizeMouseDown(e, 'width')
    } else if (atBottom) {
      handleResizeMouseDown(e, 'height')
    }
  }

  return (
    <Group
      ref={groupRef}
      x={position.x}
      y={position.y}
      opacity={searchOpacity}
      draggable={resizeMode === 'none'}
      onDragStart={() => {
        setIsDragging(true)
        if (onDragStart) {
          onDragStart()
        }
      }}
      onDragMove={(e) => {
        if (onDragMove) {
          onDragMove(e.target.x(), e.target.y())
        }
      }}
      onDragEnd={(e) => {
        setIsDragging(false)
        onDragEnd(e.target.x(), e.target.y())
      }}
      onClick={(e) => onSelect(e)}
      onTap={(e) => onSelect(e)}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={(e) => {
        // Reset cursor when leaving card (only if not resizing)
        if (resizeMode === 'none') {
          const stage = e.target.getStage()
          const container = stage?.container()
          if (container) {
            container.style.cursor = 'default'
          }
        }
      }}
    >
      {/* Card background with elegant floating design */}
      {/* Primary shadow for depth */}
      <Rect
        width={position.width}
        height={position.height}
        fill="transparent"
        cornerRadius={16}
        shadowColor="rgba(0, 0, 0, 0.12)"
        shadowBlur={isDragging ? 40 : 24}
        shadowOpacity={1}
        shadowOffsetX={0}
        shadowOffsetY={isDragging ? 16 : 8}
      />

      {/* Secondary shadow for subtle elevation */}
      <Rect
        width={position.width}
        height={position.height}
        fill="transparent"
        cornerRadius={16}
        shadowColor="rgba(0, 0, 0, 0.08)"
        shadowBlur={isDragging ? 16 : 8}
        shadowOpacity={1}
        shadowOffsetX={0}
        shadowOffsetY={isDragging ? 6 : 2}
      />

      {/* Main card surface */}
      <Rect
        width={position.width}
        height={position.height}
        fill="#ffffff"
        stroke={isSelected ? 'rgba(102, 126, 234, 0.4)' : 'rgba(0, 0, 0, 0.12)'}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={16}
      />

      {/* Subtle selection glow effect */}
      {isSelected && (
        <Rect
          width={position.width}
          height={position.height}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: 0, y: position.height }}
          fillLinearGradientColorStops={[0, 'rgba(102, 126, 234, 0.03)', 1, 'rgba(102, 126, 234, 0.01)']}
          cornerRadius={16}
        />
      )}

      {/* Title - elegant typography */}
      <Text
        x={20}
        y={24}
        text={note.title}
        fontSize={17}
        fontStyle="600"
        fill="#1a1a2e"
        width={position.width - 40}
        ellipsis={true}
        letterSpacing={-0.3}
        lineHeight={1.4}
      />

      {/* Tags - subtle and refined */}
      {note.tags.length > 0 && (
        <Text
          x={20}
          y={52}
          text={note.tags.map((tag) => `#${tag}`).join(' ')}
          fontSize={11}
          fill="rgba(102, 126, 234, 0.8)"
          width={position.width - 40}
          ellipsis={true}
          fontStyle="500"
          letterSpacing={0.2}
        />
      )}

      {/* Content preview - rendered markdown with clipping */}
      <Group
        clipFunc={(ctx) => {
          // Clip content to the available area within the card
          const clipY = note.tags.length > 0 ? 76 : 58
          const clipHeight = position.height - (note.tags.length > 0 ? 96 : 78)
          ctx.rect(20, clipY, position.width - 40, clipHeight)
        }}
      >
        {markdownContent}
      </Group>
    </Group>
  )
}

interface CardGroupComponentProps {
  group: CardGroup
  cardPositions: Map<string, CardPosition>
  onDragStart?: () => void
  onDragMove?: (deltaX: number, deltaY: number) => void
  onDragEnd: (deltaX: number, deltaY: number) => void
  onResize: (x: number, y: number, width: number, height: number) => void
  onDoubleClick: () => void
  onContextMenu: (e: any) => void
  isSearchActive?: boolean
  isSearchMatched?: boolean
}

function CardGroupComponent({
  group,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResize,
  onDoubleClick,
  onContextMenu,
  isSearchActive,
  isSearchMatched,
}: CardGroupComponentProps) {
  const groupRef = useRef<any>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [resizeMode, setResizeMode] = useState<'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'>('none')
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, groupX: 0, groupY: 0, width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Calculate opacity based on search state
  const searchOpacity = isSearchActive && !isSearchMatched ? 0.25 : 1

  // Use explicit bounds from group properties
  const bounds = {
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
  }

  // Global mouse handlers for resize
  useEffect(() => {
    if (resizeMode === 'none') return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const stage = groupRef.current?.getStage()
      if (!stage) return

      const rect = stage.container().getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const currentX = x / stage.scaleX() - stage.x() / stage.scaleX()
      const currentY = y / stage.scaleY() - stage.y() / stage.scaleY()

      const deltaX = currentX - resizeStart.x
      const deltaY = currentY - resizeStart.y

      let newX = resizeStart.groupX
      let newY = resizeStart.groupY
      let newWidth = resizeStart.width
      let newHeight = resizeStart.height

      // Handle different resize directions
      if (resizeMode.includes('n')) {
        newY = resizeStart.groupY + deltaY
        newHeight = Math.max(200, resizeStart.height - deltaY)
      }
      if (resizeMode.includes('s')) {
        newHeight = Math.max(200, resizeStart.height + deltaY)
      }
      if (resizeMode.includes('w')) {
        newX = resizeStart.groupX + deltaX
        newWidth = Math.max(200, resizeStart.width - deltaX)
      }
      if (resizeMode.includes('e')) {
        newWidth = Math.max(200, resizeStart.width + deltaX)
      }

      onResize(newX, newY, newWidth, newHeight)
    }

    const handleGlobalMouseUp = () => {
      setResizeMode('none')
      const stage = groupRef.current?.getStage()
      const container = stage?.container()
      if (container) {
        container.style.cursor = 'default'
      }
    }

    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [resizeMode, resizeStart, onResize])

  // Detect resize handle hover
  const handleMouseMove = () => {
    if (resizeMode !== 'none' || isDragging) return

    const stage = groupRef.current?.getStage()
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const relX = x - bounds.x
    const relY = y - bounds.y

    // First check if mouse is actually within group bounds
    if (relX < 0 || relX > bounds.width || relY < 0 || relY > bounds.height) {
      // Mouse is outside the group, don't change cursor
      return
    }

    const RESIZE_ZONE = 12

    let cursor = 'default'

    // Check corners first (priority over edges)
    if (relX <= RESIZE_ZONE && relY <= RESIZE_ZONE) {
      cursor = 'nw-resize'
    } else if (relX >= bounds.width - RESIZE_ZONE && relY <= RESIZE_ZONE) {
      cursor = 'ne-resize'
    } else if (relX <= RESIZE_ZONE && relY >= bounds.height - RESIZE_ZONE) {
      cursor = 'sw-resize'
    } else if (relX >= bounds.width - RESIZE_ZONE && relY >= bounds.height - RESIZE_ZONE) {
      cursor = 'se-resize'
    }
    // Then check edges
    else if (relY <= RESIZE_ZONE) {
      cursor = 'n-resize'
    } else if (relY >= bounds.height - RESIZE_ZONE) {
      cursor = 's-resize'
    } else if (relX <= RESIZE_ZONE) {
      cursor = 'w-resize'
    } else if (relX >= bounds.width - RESIZE_ZONE) {
      cursor = 'e-resize'
    }
    // Interior of group - use default cursor
    // (group is still draggable but we don't need a special cursor for it)

    const container = stage.container()
    if (container) {
      container.style.cursor = cursor
    }
  }

  // Helper function to check if pointer is in resize zone
  const getResizeMode = (stage: any, pointer: { x: number; y: number }): typeof resizeMode => {
    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const relX = x - bounds.x
    const relY = y - bounds.y

    const RESIZE_ZONE = 12

    // Check if clicking on resize handle
    if (relX <= RESIZE_ZONE && relY <= RESIZE_ZONE) {
      return 'nw'
    } else if (relX >= bounds.width - RESIZE_ZONE && relY <= RESIZE_ZONE) {
      return 'ne'
    } else if (relX <= RESIZE_ZONE && relY >= bounds.height - RESIZE_ZONE) {
      return 'sw'
    } else if (relX >= bounds.width - RESIZE_ZONE && relY >= bounds.height - RESIZE_ZONE) {
      return 'se'
    } else if (relY <= RESIZE_ZONE) {
      return 'n'
    } else if (relY >= bounds.height - RESIZE_ZONE) {
      return 's'
    } else if (relX <= RESIZE_ZONE) {
      return 'w'
    } else if (relX >= bounds.width - RESIZE_ZONE) {
      return 'e'
    }

    return 'none'
  }

  const handleMouseDown = (e: any) => {
    const stage = groupRef.current?.getStage()
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const mode = getResizeMode(stage, pointer)

    if (mode !== 'none') {
      e.evt.stopPropagation()
      e.cancelBubble = true
      setResizeMode(mode)
      setResizeStart({
        x,
        y,
        groupX: bounds.x,
        groupY: bounds.y,
        width: bounds.width,
        height: bounds.height,
      })
      // Disable dragging when resizing
      groupRef.current?.draggable(false)
    }
  }

  const handleMouseUp = () => {
    if (resizeMode !== 'none') {
      setResizeMode('none')
      // Re-enable dragging
      groupRef.current?.draggable(true)
    }
  }

  const handleMouseLeave = () => {
    // Reset cursor to default when mouse leaves the group
    const stage = groupRef.current?.getStage()
    if (stage) {
      const container = stage.container()
      if (container) {
        container.style.cursor = 'default'
      }
    }
  }

  // Parse color with alpha for subtle background
  const getBackgroundColor = (color: string) => {
    if (color.startsWith('#')) {
      return color + '15' // Hex with ~8% opacity
    }
    return color
  }

  const getBorderColor = (color: string) => {
    if (color.startsWith('#')) {
      return color + '40' // Hex with ~25% opacity
    }
    return color
  }

  return (
    <Group
      ref={groupRef}
      x={bounds.x}
      y={bounds.y}
      opacity={searchOpacity}
      draggable
      onDragStart={(e) => {
        // Check if we're clicking on a resize zone
        const stage = groupRef.current?.getStage()
        if (stage) {
          const pointer = stage.getPointerPosition()
          if (pointer) {
            const mode = getResizeMode(stage, pointer)
            if (mode !== 'none') {
              // Prevent drag from starting if we're in a resize zone
              e.target.stopDrag()
              return
            }
          }
        }

        setIsDragging(true)
        setDragStart({ x: e.target.x(), y: e.target.y() })
        onDragStart?.()
      }}
      onDragMove={(e) => {
        if (dragStart) {
          const deltaX = e.target.x() - dragStart.x
          const deltaY = e.target.y() - dragStart.y
          onDragMove?.(deltaX, deltaY)
        }
      }}
      onDragEnd={(e) => {
        setIsDragging(false)
        if (dragStart) {
          const deltaX = e.target.x() - dragStart.x
          const deltaY = e.target.y() - dragStart.y
          onDragEnd(deltaX, deltaY)
          setDragStart(null)
          // Reset position to prevent drift
          e.target.position({ x: bounds.x, y: bounds.y })
        }
      }}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Group background with subtle styling */}
      <Rect
        x={0}
        y={0}
        width={bounds.width}
        height={bounds.height}
        fill={getBackgroundColor(group.color)}
        stroke={getBorderColor(group.color)}
        strokeWidth={2}
        cornerRadius={12}
        shadowColor="rgba(0, 0, 0, 0.05)"
        shadowBlur={8}
        shadowOpacity={0.3}
        shadowOffsetX={0}
        shadowOffsetY={2}
      />

      {/* Label background */}
      <Rect
        x={8}
        y={8}
        width={Math.min(bounds.width - 16, group.name.length * 8 + 20)}
        height={24}
        fill={group.color}
        opacity={0.15}
        cornerRadius={6}
      />

      {/* Group label */}
      <Text
        x={14}
        y={12}
        text={group.name || 'Untitled Group'}
        fontSize={13}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontStyle="600"
        fill={group.color}
        opacity={0.7}
      />
    </Group>
  )
}

interface StickyNoteComponentProps {
  note: StickyNote
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onResize: (x: number, y: number, width: number, height: number) => void
  onDoubleClick: () => void
  onContextMenu: (e: any) => void
  isSearchActive?: boolean
  isSearchMatched?: boolean
}

function StickyNoteComponent({
  note,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResize,
  onDoubleClick,
  onContextMenu,
  isSearchActive,
  isSearchMatched,
}: StickyNoteComponentProps) {
  const noteRef = useRef<any>(null)
  const [resizeMode, setResizeMode] = useState<'none' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'>('none')

  // Calculate opacity based on search state
  const searchOpacity = isSearchActive && !isSearchMatched ? 0.25 : 1
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, noteX: 0, noteY: 0, width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Helper function to parse text segments with special syntax (same as NoteCard)
  const parseTextSegments = (text: string): Array<{ text: string; type: 'normal' | 'wikilink' | 'math' }> => {
    const segments: Array<{ text: string; type: 'normal' | 'wikilink' | 'math' }> = []
    let lastIndex = 0

    // Combined regex to find wikilinks [[...]] and inline math $...$
    const combinedRegex = /(\[\[([^\]]+)\]\])|(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g
    let match

    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before the match as normal text
      if (match.index > lastIndex) {
        const normalText = text.substring(lastIndex, match.index)
        if (normalText) segments.push({ text: normalText, type: 'normal' })
      }

      // Add the matched special syntax
      if (match[1]) {
        // Wikilink [[...]]
        const linkContent = match[2]
        const displayText = linkContent.includes('|') ? linkContent.split('|')[1] : linkContent
        segments.push({ text: `[[${displayText}]]`, type: 'wikilink' })
      } else if (match[3]) {
        // Inline math $...$
        segments.push({ text: `$${match[3]}$`, type: 'math' })
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text as normal
    if (lastIndex < text.length) {
      const normalText = text.substring(lastIndex)
      if (normalText) segments.push({ text: normalText, type: 'normal' })
    }

    // If no special syntax found, return the whole text as normal
    if (segments.length === 0) {
      segments.push({ text, type: 'normal' })
    }

    return segments
  }

  // Global mouse handlers for resize
  useEffect(() => {
    if (resizeMode === 'none') return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const stage = noteRef.current?.getStage()
      if (!stage) return

      const rect = stage.container().getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const currentX = x / stage.scaleX() - stage.x() / stage.scaleX()
      const currentY = y / stage.scaleY() - stage.y() / stage.scaleY()

      const deltaX = currentX - resizeStart.x
      const deltaY = currentY - resizeStart.y

      let newX = resizeStart.noteX
      let newY = resizeStart.noteY
      let newWidth = resizeStart.width
      let newHeight = resizeStart.height

      // Handle different resize directions
      if (resizeMode.includes('n')) {
        newY = resizeStart.noteY + deltaY
        newHeight = Math.max(100, resizeStart.height - deltaY)
      }
      if (resizeMode.includes('s')) {
        newHeight = Math.max(100, resizeStart.height + deltaY)
      }
      if (resizeMode.includes('w')) {
        newX = resizeStart.noteX + deltaX
        newWidth = Math.max(150, resizeStart.width - deltaX)
      }
      if (resizeMode.includes('e')) {
        newWidth = Math.max(150, resizeStart.width + deltaX)
      }

      onResize(newX, newY, newWidth, newHeight)
    }

    const handleGlobalMouseUp = () => {
      setResizeMode('none')
      const stage = noteRef.current?.getStage()
      const container = stage?.container()
      if (container) {
        container.style.cursor = 'default'
      }
    }

    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [resizeMode, resizeStart, onResize])

  // Detect resize handle hover
  const handleMouseMove = () => {
    if (resizeMode !== 'none' || isDragging) return

    const stage = noteRef.current?.getStage()
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const relX = x - note.x
    const relY = y - note.y

    // First check if mouse is actually within note bounds
    if (relX < 0 || relX > note.width || relY < 0 || relY > note.height) {
      return
    }

    const RESIZE_ZONE = 12

    let cursor = 'default'

    // Check corners first (priority over edges)
    if (relX <= RESIZE_ZONE && relY <= RESIZE_ZONE) {
      cursor = 'nw-resize'
    } else if (relX >= note.width - RESIZE_ZONE && relY <= RESIZE_ZONE) {
      cursor = 'ne-resize'
    } else if (relX <= RESIZE_ZONE && relY >= note.height - RESIZE_ZONE) {
      cursor = 'sw-resize'
    } else if (relX >= note.width - RESIZE_ZONE && relY >= note.height - RESIZE_ZONE) {
      cursor = 'se-resize'
    }
    // Then check edges
    else if (relY <= RESIZE_ZONE) {
      cursor = 'n-resize'
    } else if (relY >= note.height - RESIZE_ZONE) {
      cursor = 's-resize'
    } else if (relX <= RESIZE_ZONE) {
      cursor = 'w-resize'
    } else if (relX >= note.width - RESIZE_ZONE) {
      cursor = 'e-resize'
    }

    const container = stage.container()
    if (container) {
      container.style.cursor = cursor
    }
  }

  // Helper function to check if pointer is in resize zone
  const getResizeMode = (stage: any, pointer: { x: number; y: number }): typeof resizeMode => {
    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const relX = x - note.x
    const relY = y - note.y

    const RESIZE_ZONE = 12

    // Check if clicking on resize handle
    if (relX <= RESIZE_ZONE && relY <= RESIZE_ZONE) {
      return 'nw'
    } else if (relX >= note.width - RESIZE_ZONE && relY <= RESIZE_ZONE) {
      return 'ne'
    } else if (relX <= RESIZE_ZONE && relY >= note.height - RESIZE_ZONE) {
      return 'sw'
    } else if (relX >= note.width - RESIZE_ZONE && relY >= note.height - RESIZE_ZONE) {
      return 'se'
    } else if (relY <= RESIZE_ZONE) {
      return 'n'
    } else if (relY >= note.height - RESIZE_ZONE) {
      return 's'
    } else if (relX <= RESIZE_ZONE) {
      return 'w'
    } else if (relX >= note.width - RESIZE_ZONE) {
      return 'e'
    }

    return 'none'
  }

  const handleMouseDown = (e: any) => {
    const stage = noteRef.current?.getStage()
    if (!stage) return

    const pointer = stage.getPointerPosition()
    if (!pointer) return

    const x = pointer.x / stage.scaleX() - stage.x() / stage.scaleX()
    const y = pointer.y / stage.scaleY() - stage.y() / stage.scaleY()

    const mode = getResizeMode(stage, pointer)

    if (mode !== 'none') {
      e.evt.stopPropagation()
      e.cancelBubble = true
      setResizeMode(mode)
      setResizeStart({
        x,
        y,
        noteX: note.x,
        noteY: note.y,
        width: note.width,
        height: note.height,
      })
      // Disable dragging when resizing
      noteRef.current?.draggable(false)
    }
  }

  const handleMouseUp = () => {
    if (resizeMode !== 'none') {
      setResizeMode('none')
      // Re-enable dragging
      noteRef.current?.draggable(true)
    }
  }

  const handleMouseLeave = () => {
    // Reset cursor to default when mouse leaves the note
    const stage = noteRef.current?.getStage()
    if (stage) {
      const container = stage.container()
      if (container) {
        container.style.cursor = 'default'
      }
    }
  }

  // Markdown content rendering with WYSIWYG support
  const markdownContent = useMemo(() => {
    const yStart = 12
    const availableHeight = note.height - 24
    const availableWidth = note.width - 24

    // If no text, show placeholder
    if (!note.text || note.text.trim().length === 0) {
      return (
        <Text
          key="placeholder"
          x={12}
          y={12}
          text="Double-click to edit"
          fontSize={14}
          fontFamily="'Segoe Print', 'Comic Sans MS', cursive, system-ui, -apple-system, sans-serif"
          fill="#2d3748"
          opacity={0.5}
        />
      )
    }

    // Parse content into lines and render with appropriate styling
    let content = note.text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/!\[.*?\]\(.+?\)/g, '') // Remove markdown images
      .replace(/!\[\[.*?\]\]/g, '') // Remove Obsidian images
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Extract link text from regular markdown links

    const lines = content.split('\n')
    const textElements: JSX.Element[] = []
    let currentY = yStart

    // Track total lines rendered to prevent overflow
    let linesRendered = 0
    const maxLines = Math.floor(availableHeight / 20) // Approximate max lines

    for (let index = 0; index < lines.length && linesRendered < maxLines; index++) {
      const line = lines[index]

      // Stop if we've exceeded available height
      if (currentY >= yStart + availableHeight) break

      // Check for headers
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/)
      if (headerMatch) {
        const level = headerMatch[1].length
        let text = headerMatch[2]

        // Strip formatting from header text
        text = text.replace(/\*\*(.+?)\*\*/g, '$1')
        text = text.replace(/__(.+?)__/g, '$1')
        text = text.replace(/\*(.+?)\*/g, '$1')
        text = text.replace(/_(.+?)_/g, '$1')
        text = text.replace(/`(.+?)`/g, '$1')

        const fontSize = Math.max(16 - level, 13)
        const lineHeight = fontSize + 4

        // Only render if it fits
        if (currentY + lineHeight <= yStart + availableHeight) {
          textElements.push(
            <Text
              key={`line-${index}`}
              x={12}
              y={currentY}
              text={text}
              fontSize={fontSize}
              fontStyle="bold"
              fontFamily="'Segoe Print', 'Comic Sans MS', cursive, system-ui, -apple-system, sans-serif"
              fill="#2d3748"
              width={availableWidth}
              ellipsis={true}
            />
          )
          currentY += lineHeight
          linesRendered++
        }
      } else if (line.trim()) {
        // Regular text - parse for special syntax
        let displayText = line

        // Strip basic formatting
        displayText = displayText.replace(/\*\*(.+?)\*\*/g, '$1')
        displayText = displayText.replace(/__(.+?)__/g, '$1')
        displayText = displayText.replace(/\*(.+?)\*/g, '$1')
        displayText = displayText.replace(/_(.+?)_/g, '$1')
        displayText = displayText.replace(/`(.+?)`/g, '$1')

        // Parse text into segments (normal, wikilinks, math)
        const segments = parseTextSegments(displayText)

        // Render each segment inline
        let currentX = 12
        const fontSize = 13
        const lineHeight = 19

        // Only render if it fits
        if (currentY + lineHeight <= yStart + availableHeight) {
          segments.forEach((segment, segIndex) => {
            let fill = "#2d3748"
            let fontStyle = "normal"

            if (segment.type === 'wikilink') {
              fill = "rgba(102, 126, 234, 0.9)" // Blue for wikilinks
              fontStyle = "500"
            } else if (segment.type === 'math') {
              fill = "rgba(147, 51, 234, 0.9)" // Purple for math
              fontStyle = "500"
            }

            textElements.push(
              <Text
                key={`line-${index}-seg-${segIndex}`}
                x={currentX}
                y={currentY}
                text={segment.text}
                fontSize={fontSize}
                fontStyle={fontStyle}
                fontFamily="'Segoe Print', 'Comic Sans MS', cursive, system-ui, -apple-system, sans-serif"
                fill={fill}
                wrap="none"
              />
            )

            // Approximate text width for next segment
            currentX += segment.text.length * (fontSize * 0.6)
          })

          currentY += lineHeight
          linesRendered++
        }
      } else {
        // Empty line - add small spacing
        currentY += 8
      }
    }

    return textElements
  }, [note.text, note.width, note.height, parseTextSegments])

  return (
    <Group
      ref={noteRef}
      x={note.x}
      y={note.y}
      opacity={searchOpacity}
      draggable
      onDragStart={(e) => {
        // Check if we're clicking on a resize zone
        const stage = noteRef.current?.getStage()
        if (stage) {
          const pointer = stage.getPointerPosition()
          if (pointer) {
            const mode = getResizeMode(stage, pointer)
            if (mode !== 'none') {
              // Prevent drag from starting if we're in a resize zone
              e.target.stopDrag()
              return
            }
          }
        }

        setIsDragging(true)
        onDragStart?.()
      }}
      onDragMove={(e) => {
        const newX = e.target.x()
        const newY = e.target.y()
        onDragMove?.(newX, newY)
      }}
      onDragEnd={(e) => {
        setIsDragging(false)
        const newX = e.target.x()
        const newY = e.target.y()
        onDragEnd(newX, newY)
      }}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Sticky note background with paper-like texture */}
      <Rect
        x={0}
        y={0}
        width={note.width}
        height={note.height}
        fill={note.color}
        stroke="#00000020"
        strokeWidth={1}
        cornerRadius={2}
        shadowColor="rgba(0, 0, 0, 0.15)"
        shadowBlur={8}
        shadowOpacity={0.5}
        shadowOffsetX={2}
        shadowOffsetY={3}
      />

      {/* Markdown content */}
      {markdownContent}
    </Group>
  )
}

interface TextBoxComponentProps {
  textBox: TextBox
  isSelected?: boolean
  isDrawingArrow?: boolean
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onClick: () => void
  onDoubleClick: () => void
  onContextMenu: (e: any) => void
  onConnectionDrop?: () => void
  isSearchActive?: boolean
  isSearchMatched?: boolean
}

function TextBoxComponent({
  textBox,
  isSelected,
  isDrawingArrow,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
  onDoubleClick,
  onContextMenu,
  onConnectionDrop,
  isSearchActive,
  isSearchMatched,
}: TextBoxComponentProps) {
  const boxRef = useRef<any>(null)

  // Calculate opacity based on search state
  const searchOpacity = isSearchActive && !isSearchMatched ? 0.25 : 1

  return (
    <Group
      ref={boxRef}
      x={textBox.x}
      y={textBox.y}
      opacity={searchOpacity}
      draggable
      onDragStart={() => {
        onDragStart?.()
      }}
      onDragMove={(e) => {
        const newX = e.target.x()
        const newY = e.target.y()
        onDragMove?.(newX, newY)
      }}
      onDragEnd={(e) => {
        const newX = e.target.x()
        const newY = e.target.y()
        onDragEnd(newX, newY)
      }}
      onClick={onClick}
      onTap={onClick}
      onDblClick={onDoubleClick}
      onDblTap={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseUp={(e) => {
        if (isDrawingArrow && onConnectionDrop) {
          e.cancelBubble = true
          onConnectionDrop()
        }
      }}
      onTouchEnd={(e) => {
        if (isDrawingArrow && onConnectionDrop) {
          e.cancelBubble = true
          onConnectionDrop()
        }
      }}
    >
      {/* Text box background */}
      <Rect
        x={0}
        y={0}
        width={textBox.width}
        height={textBox.height}
        fill="white"
        stroke={isSelected ? "#8b5cf6" : "#d1d5db"}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
        shadowColor="rgba(0, 0, 0, 0.1)"
        shadowBlur={4}
        shadowOpacity={0.5}
        shadowOffsetX={1}
        shadowOffsetY={2}
      />

      {/* Text content - centered, single line */}
      <Text
        x={0}
        y={(textBox.height - 14) / 2}
        text={textBox.text || 'Double-click to edit'}
        fontSize={14}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={textBox.text ? '#1f2937' : '#9ca3af'}
        width={textBox.width}
        align="center"
        verticalAlign="middle"
        ellipsis={false}
        wrap="none"
      />
    </Group>
  )
}

interface CanvasProps {
  containerRef: React.RefObject<HTMLDivElement>
  onSearchResults?: (results: any[]) => void
}

export interface CanvasRef {
  handleSearch: (query: string) => void
  navigateToElement: (elementId: string, elementType: string) => void
  getSearchResults: () => any[]
}

const Canvas = forwardRef<CanvasRef, CanvasProps>(({ containerRef, onSearchResults }, ref) => {
  const { notes, selectedNoteId, setSelectedNoteId, setEditingNoteId, activeWhiteboardId, whiteboards, updateCardPosition, deleteNote, vaultPath, updateFileInTree, selectedNoteIds, setSelectedNoteIds, toggleNoteSelection, clearSelection, addGroup, updateGroup, deleteGroup, updateStickyNote, deleteStickyNote, addTextBox, updateTextBox, deleteTextBox, updatePdfCard, deletePdfCard, updateHighlightCard, deleteHighlightCard, addArrow, deleteArrow } =
    useVaultStore()
  const { confirm } = useConfirm()
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [cardPositions, setCardPositions] = useState<Map<string, CardPosition>>(new Map())
  const [arrows, setArrows] = useState<Map<string, Arrow>>(new Map())
  const [groups, setGroups] = useState<CardGroup[]>([])
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([])
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([])
  const [pdfCards, setPdfCards] = useState<PdfCard[]>([])
  const [highlightCards, setHighlightCards] = useState<HighlightCard[]>([])
  const [selectedArrow, setSelectedArrow] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameModal, setRenameModal] = useState<{ noteId: string; currentName: string; path: string } | null>(null)
  const [dragPositions, setDragPositions] = useState<Map<string, CardPosition>>(new Map())
  const [groupNameModal, setGroupNameModal] = useState<{ type: 'create' | 'edit'; groupId?: string; currentName?: string } | null>(null)
  const [colorPickerModal, setColorPickerModal] = useState<{ groupId: string; currentColor: string } | null>(null)
  const [stickyNoteEditorModal, setStickyNoteEditorModal] = useState<{ stickyNoteId: string; currentText: string } | null>(null)
  const [stickyNoteColorPickerModal, setStickyNoteColorPickerModal] = useState<{ stickyNoteId: string; currentColor: string } | null>(null)
  const stageRef = useRef<any>(null)
  const saveTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const groupDragInitialStickyNotes = useRef<Map<string, { x: number; y: number }>>(new Map())
  const groupDragInitialTextBoxes = useRef<Map<string, { x: number; y: number }>>(new Map())
  const groupDragInitialPdfCards = useRef<Map<string, { x: number; y: number }>>(new Map())
  const groupDragInitialHighlightCards = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Box selection state
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [isSelectingBox, setIsSelectingBox] = useState(false)
  const [boxStartPos, setBoxStartPos] = useState<{ x: number; y: number } | null>(null)

  // Multi-card drag state
  const [multiDragOffsets, setMultiDragOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())

  // Manual connection state
  const [isDrawingArrow, setIsDrawingArrow] = useState(false)
  const [drawingArrow, setDrawingArrow] = useState<{
    sourceNoteId: string
    sourceType: 'note' | 'textBox' | 'pdf' | 'highlight'
    sourcePoint: { x: number; y: number; side: 'top' | 'right' | 'bottom' | 'left' }
    currentPoint: { x: number; y: number }
  } | null>(null)
  const [hideAutoArrows, setHideAutoArrows] = useState(false)
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null)
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null)
  const [_selectedPdfId, setSelectedPdfId] = useState<string | null>(null)
  const [pdfReaderCardId, setPdfReaderCardId] = useState<string | null>(null)
  const [pdfNavigationTarget, setPdfNavigationTarget] = useState<{ page: number; scrollPosition?: number } | null>(null)
  const [highlightTextModal, setHighlightTextModal] = useState<HighlightCard | null>(null)

  // Alignment guides state
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])
  const snapEnabled = true // Always enabled for now

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searchMatchedIds, setSearchMatchedIds] = useState<Set<string>>(new Set())

  // Search handler
  const handleSearch = (query: string) => {
    setSearchQuery(query)

    if (!query || query.trim().length === 0) {
      setSearchResults([])
      setSearchMatchedIds(new Set())
      onSearchResults?.([])
      return
    }

    if (!activeWhiteboardId) {
      setSearchResults([])
      setSearchMatchedIds(new Set())
      onSearchResults?.([])
      return
    }

    const results = searchWhiteboard(query, activeWhiteboardId, {
      notes,
      cardPositions,
      stickyNotes,
      textBoxes,
      pdfCards,
      highlightCards,
      groups
    })

    setSearchResults(results)
    setSearchMatchedIds(new Set(results.map(r => r.id)))
    onSearchResults?.(results)
  }

  // Navigate to element by ID and type
  const navigateToElement = (elementId: string, elementType: string) => {
    let targetX = 0
    let targetY = 0
    let found = false

    // Find element position based on type
    if (elementType === 'note') {
      const pos = cardPositions.get(elementId)
      if (pos) {
        targetX = pos.x + pos.width / 2
        targetY = pos.y + pos.height / 2
        found = true
      }
    } else if (elementType === 'stickyNote') {
      const sticky = stickyNotes.find(s => s.id === elementId)
      if (sticky) {
        targetX = sticky.x + sticky.width / 2
        targetY = sticky.y + sticky.height / 2
        found = true
      }
    } else if (elementType === 'textBox') {
      const textBox = textBoxes.find(tb => tb.id === elementId)
      if (textBox) {
        targetX = textBox.x + textBox.width / 2
        targetY = textBox.y + textBox.height / 2
        found = true
      }
    } else if (elementType === 'pdfCard') {
      const pdf = pdfCards.find(p => p.id === elementId)
      if (pdf) {
        targetX = pdf.x + pdf.width / 2
        targetY = pdf.y + pdf.height / 2
        found = true
      }
    } else if (elementType === 'highlightCard') {
      const highlight = highlightCards.find(h => h.id === elementId)
      if (highlight) {
        targetX = highlight.x + highlight.width / 2
        targetY = highlight.y + highlight.height / 2
        found = true
      }
    } else if (elementType === 'group') {
      const group = groups.find(g => g.id === elementId)
      if (group) {
        targetX = group.x + group.width / 2
        targetY = group.y + group.height / 2
        found = true
      }
    }

    if (found && stageRef.current) {
      const stage = stageRef.current
      const stageWidth = stage.width()
      const stageHeight = stage.height()

      // Center the element on the screen
      const newX = stageWidth / 2 - targetX * scale
      const newY = stageHeight / 2 - targetY * scale

      // Animate to the new position
      stage.to({
        x: newX,
        y: newY,
        duration: 0.3,
      })

      setPosition({ x: newX, y: newY })
    }
  }

  // Get current search results
  const getSearchResults = () => searchResults

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    handleSearch,
    navigateToElement,
    getSearchResults
  }))

  // Cleanup pending save timeouts on unmount
  useEffect(() => {
    return () => {
      saveTimeoutRef.current.forEach(timeout => clearTimeout(timeout))
      saveTimeoutRef.current.clear()
    }
  }, [])

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [containerRef])

  // Initialize card positions for notes
  useEffect(() => {
    const positions = new Map<string, CardPosition>()

    // Only load cards that are explicitly part of the active whiteboard
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard) {
      activeWhiteboard.cards.forEach(card => {
        // Only add the card if the note still exists in the vault
        if (notes.has(card.id)) {
          positions.set(card.id, card)
        }
      })
    }

    setCardPositions(positions)
  }, [notes, activeWhiteboardId, whiteboards])

  // Initialize groups from active whiteboard with migration for old groups
  useEffect(() => {
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard && activeWhiteboard.groups) {
      // Migrate old groups that don't have position/size properties
      const migratedGroups = activeWhiteboard.groups.map(group => {
        // Check if group already has position/size
        if (group.x !== undefined && group.y !== undefined && group.width !== undefined && group.height !== undefined) {
          return group
        }

        // Calculate bounds from cards for old groups
        const cards = group.cardIds
          .map(id => cardPositions.get(id))
          .filter(Boolean) as CardPosition[]

        let x = 0, y = 0, width = 400, height = 300

        if (cards.length > 0) {
          const padding = 30
          const minX = Math.min(...cards.map(c => c.x))
          const minY = Math.min(...cards.map(c => c.y))
          const maxX = Math.max(...cards.map(c => c.x + c.width))
          const maxY = Math.max(...cards.map(c => c.y + c.height))

          x = minX - padding
          y = minY - padding - 30 // Extra space for label
          width = maxX - minX + padding * 2
          height = maxY - minY + padding * 2 + 30 // Extra space for label
        }

        return {
          ...group,
          x,
          y,
          width,
          height
        }
      })

      setGroups(migratedGroups)

      // Save migrated groups if any were updated
      const needsMigration = migratedGroups.some((_, index) => {
        const original = activeWhiteboard.groups[index]
        return original.x === undefined || original.y === undefined || original.width === undefined || original.height === undefined
      })

      if (needsMigration) {
        // Update store and save to backend
        migratedGroups.forEach(group => {
          if (activeWhiteboard.groups.find(g => g.id === group.id && (g.x === undefined || g.y === undefined))) {
            updateGroup(group.id, { x: group.x, y: group.y, width: group.width, height: group.height })
          }
        })

        // Save to backend after a short delay to batch updates
        setTimeout(async () => {
          try {
            // FIXED: Get fresh state from store to avoid stale closure state
            const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
            await window.electronAPI.saveMetadata({
              version: '2.0',
              whiteboards: currentWhiteboards,
              activeWhiteboardId: currentActiveWhiteboardId,
            })
          } catch (error) {
            console.error('Error saving migrated groups:', error)
          }
        }, 100)
      }
    } else {
      setGroups([])
    }
  }, [activeWhiteboardId, whiteboards, cardPositions, updateGroup])

  // Initialize sticky notes from active whiteboard
  useEffect(() => {
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard && activeWhiteboard.stickyNotes) {
      setStickyNotes(activeWhiteboard.stickyNotes)
    } else {
      setStickyNotes([])
    }
  }, [activeWhiteboardId, whiteboards])

  // Initialize text boxes from active whiteboard
  useEffect(() => {
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard && activeWhiteboard.textBoxes) {
      setTextBoxes(activeWhiteboard.textBoxes)
    } else {
      setTextBoxes([])
    }
  }, [activeWhiteboardId, whiteboards])

  // Initialize PDF cards from active whiteboard
  useEffect(() => {
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard && activeWhiteboard.pdfCards) {
      setPdfCards(activeWhiteboard.pdfCards)
    } else {
      setPdfCards([])
    }
  }, [activeWhiteboardId, whiteboards])

  // Initialize highlight cards from active whiteboard
  useEffect(() => {
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    if (activeWhiteboard && activeWhiteboard.highlightCards) {
      setHighlightCards(activeWhiteboard.highlightCards)
    } else {
      setHighlightCards([])
    }
  }, [activeWhiteboardId, whiteboards])

  // Initialize arrows from whiteboard or create from note links
  useEffect(() => {
    const arrowMap = new Map<string, Arrow>()

    // Load saved arrows from active whiteboard
    const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
    const savedArrows = activeWhiteboard?.arrows || []

    savedArrows.forEach(arrow => {
      arrowMap.set(arrow.id, arrow)
    })

    // Generate arrows from note links (only for cards on the active whiteboard)
    cardPositions.forEach((sourcePos, noteId) => {
      const note = notes.get(noteId)
      if (!note) return

      note.links.forEach(link => {
        // Find target note
        const targetNote = Array.from(notes.values()).find(
          n => n.title === link || n.name === link || n.id === link
        )
        if (!targetNote) return

        const targetPos = cardPositions.get(targetNote.id)
        if (!targetPos) return // Only create arrows if target is also on this whiteboard

        // Check if arrow already exists
        const arrowId = `${note.id}-${targetNote.id}`
        if (arrowMap.has(arrowId)) return

        // Calculate default control point (middle of line with perpendicular offset)
        const sx = sourcePos.x + sourcePos.width / 2
        const sy = sourcePos.y + sourcePos.height / 2
        const tx = targetPos.x + targetPos.width / 2
        const ty = targetPos.y + targetPos.height / 2

        const dx = tx - sx
        const dy = ty - sy
        const distance = Math.sqrt(dx * dx + dy * dy)
        const offset = Math.min(distance * 0.3, 100)
        const perpX = -dy / distance
        const perpY = dx / distance

        // Calculate default edge positions based on direction between cards
        // Source point: direction from source toward target
        const sourceRelX = 0.5 + (dx / distance) * 0.5
        const sourceRelY = 0.5 + (dy / distance) * 0.5

        // Target point: direction from target toward source (opposite)
        const targetRelX = 0.5 - (dx / distance) * 0.5
        const targetRelY = 0.5 - (dy / distance) * 0.5

        // Create default arrow
        arrowMap.set(arrowId, {
          id: arrowId,
          sourceNoteId: note.id,
          targetNoteId: targetNote.id,
          sourcePoint: { x: sourceRelX, y: sourceRelY }, // direction toward target
          targetPoint: { x: targetRelX, y: targetRelY }, // direction toward source
          controlPoint: {
            x: sx + dx * 0.5 + perpX * offset,
            y: sy + dy * 0.5 + perpY * offset
          },
          whiteboardId: activeWhiteboardId || 'default'
        })
      })
    })

    setArrows(arrowMap)
  }, [notes, cardPositions, activeWhiteboardId, whiteboards])

  // NOTE: Removed auto-add behavior - notes are now added explicitly via drag-and-drop
  // Users can drag notes from the sidebar to the whiteboard to add them

  // Handle drag-and-drop from sidebar
  useEffect(() => {
    const container = containerRef.current
    const stage = stageRef.current
    if (!container || !stage || !activeWhiteboardId) return

    // Get the actual canvas element from Konva Stage
    const canvas = stage.container().querySelector('canvas')
    if (!canvas) return

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()

      const noteId = e.dataTransfer!.getData('noteId')
      if (!noteId) {
        console.log('No noteId in dataTransfer')
        return
      }

      console.log('Dropping noteId:', noteId)
      console.log('Available notes:', Array.from(notes.keys()))

      // Check if note exists
      const note = notes.get(noteId)
      if (!note) {
        console.log('Note not found in notes Map')
        return
      }

      // Check if note is already on the active whiteboard
      const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
      const existingCard = activeWhiteboard?.cards.find(card => card.id === noteId)
      if (existingCard) {
        // Navigate to the existing note instead of adding a duplicate
        setSelectedNoteId(noteId)

        // Center the view on the existing note
        const cardCenterX = existingCard.x + existingCard.width / 2
        const cardCenterY = existingCard.y + existingCard.height / 2
        const viewportCenterX = dimensions.width / 2
        const viewportCenterY = dimensions.height / 2

        setPosition({
          x: viewportCenterX - cardCenterX * scale,
          y: viewportCenterY - cardCenterY * scale
        })

        return
      }

      // Calculate drop position with proper coordinate transformation
      const containerRect = container.getBoundingClientRect()
      const screenX = e.clientX - containerRect.left
      const screenY = e.clientY - containerRect.top

      // Convert screen coordinates to canvas coordinates
      // Account for zoom (scale) and pan (position)
      const canvasX = screenX / scale - position.x / scale
      const canvasY = screenY / scale - position.y / scale

      // Center the card at drop position
      const x = Math.max(0, canvasX - 140) // 140 = card width / 2
      const y = Math.max(0, canvasY - 100) // 100 = card height / 2

      // Create card position
      const newCardPosition = {
        id: noteId,
        x,
        y,
        width: 280,
        height: 200,
        whiteboardId: activeWhiteboardId,
      }

      try {
        // Persist to backend
        await window.electronAPI.updateCardPosition(newCardPosition)
        // Update frontend store immediately
        updateCardPosition(newCardPosition)
      } catch (error) {
        console.error('Error adding note to whiteboard:', error)
      }
    }

    // Attach listeners to both container and canvas to ensure events are captured
    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    canvas.addEventListener('dragover', handleDragOver)
    canvas.addEventListener('drop', handleDrop)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
      canvas.removeEventListener('dragover', handleDragOver)
      canvas.removeEventListener('drop', handleDrop)
    }
  }, [containerRef, stageRef, activeWhiteboardId, notes, whiteboards, scale, position, updateCardPosition, setSelectedNoteId, setPosition, dimensions])

  const handleCardDragStart = (noteId: string) => {
    const draggedCardPos = cardPositions.get(noteId)
    if (!draggedCardPos) return

    // If this card is part of a multi-selection, calculate offsets for all selected cards
    const isPartOfMultiSelect = selectedNoteIds.has(noteId)
    if (isPartOfMultiSelect && selectedNoteIds.size > 1) {
      const offsets = new Map<string, { x: number; y: number }>()

      selectedNoteIds.forEach(selectedId => {
        const selectedPos = cardPositions.get(selectedId)
        if (selectedPos) {
          offsets.set(selectedId, {
            x: selectedPos.x - draggedCardPos.x,
            y: selectedPos.y - draggedCardPos.y
          })
        }
      })

      setMultiDragOffsets(offsets)
    } else {
      setMultiDragOffsets(new Map())
    }
  }

  const handleCardDragMove = (noteId: string, x: number, y: number) => {
    const position = cardPositions.get(noteId)
    if (!position) return

    let snappedX = x
    let snappedY = y
    let guides: AlignmentGuide[] = []

    // Calculate alignment guides and snapping for single card drag
    if (snapEnabled && multiDragOffsets.size <= 1) {
      const otherCards = Array.from(cardPositions.values())
        .filter(p => p.id !== noteId)
        .map(p => ({ ...p }))

      const draggingCard = {
        x,
        y,
        width: position.width,
        height: position.height,
      }

      const result = calculateAlignmentGuides(draggingCard, otherCards, new Set([noteId]))
      snappedX = result.snappedX
      snappedY = result.snappedY
      guides = result.guides
    }

    setAlignmentGuides(guides)

    const newDragPositions = new Map(dragPositions)

    // If dragging multiple cards, update all selected cards
    if (multiDragOffsets.size > 1) {
      multiDragOffsets.forEach((offset, selectedId) => {
        const selectedPos = cardPositions.get(selectedId)
        if (selectedPos) {
          const tempPosition = {
            ...selectedPos,
            x: snappedX + offset.x,
            y: snappedY + offset.y
          }
          newDragPositions.set(selectedId, tempPosition)
        }
      })
    } else {
      // Single card drag
      const tempPosition = { ...position, x: snappedX, y: snappedY }
      newDragPositions.set(noteId, tempPosition)
    }

    setDragPositions(newDragPositions)
  }

  const handleCardDragEnd = async (noteId: string, x: number, y: number) => {
    const position = cardPositions.get(noteId)
    if (!position) return

    const newCardPositions = new Map(cardPositions)
    const cardsToUpdate: CardPosition[] = []

    // If dragging multiple cards, update all selected cards
    if (multiDragOffsets.size > 1) {
      multiDragOffsets.forEach((offset, selectedId) => {
        const selectedPos = cardPositions.get(selectedId)
        if (selectedPos) {
          const newPosition = {
            ...selectedPos,
            x: x + offset.x,
            y: y + offset.y
          }
          newCardPositions.set(selectedId, newPosition)
          cardsToUpdate.push(newPosition)
          updateCardPosition(newPosition)
        }
      })
    } else {
      // Single card drag
      let adjustedX = x
      let adjustedY = y

      // Check for overlaps and adjust position (only for single card)
      const minDistance = 20 // Minimum distance between cards
      for (const [otherId, otherPos] of cardPositions) {
        if (otherId === noteId) continue

        // Calculate overlap
        const overlapX =
          x < otherPos.x + otherPos.width + minDistance &&
          x + position.width + minDistance > otherPos.x
        const overlapY =
          y < otherPos.y + otherPos.height + minDistance &&
          y + position.height + minDistance > otherPos.y

        if (overlapX && overlapY) {
          // Calculate the direction to push the card
          const centerX = x + position.width / 2
          const centerY = y + position.height / 2
          const otherCenterX = otherPos.x + otherPos.width / 2
          const otherCenterY = otherPos.y + otherPos.height / 2

          const dx = centerX - otherCenterX
          const dy = centerY - otherCenterY
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance > 0) {
            // Push the card away from the overlapping card
            const pushDistance =
              (position.width + otherPos.width) / 2 + minDistance
            adjustedX = otherCenterX + (dx / distance) * pushDistance - position.width / 2
            adjustedY = otherCenterY + (dy / distance) * pushDistance - position.height / 2
          }
        }
      }

      const newPosition = { ...position, x: adjustedX, y: adjustedY }
      newCardPositions.set(noteId, newPosition)
      cardsToUpdate.push(newPosition)
      updateCardPosition(newPosition)
    }

    // Clear temporary drag positions and alignment guides
    setDragPositions(new Map())
    setMultiDragOffsets(new Map())
    setAlignmentGuides([])

    // Update card positions
    setCardPositions(newCardPositions)

    // Update group memberships to include any cards dropped into groups
    // Pass the new positions to avoid using stale state
    updateAllGroupMemberships(newCardPositions)

    // Persist all updated cards to file system
    try {
      await Promise.all([
        ...cardsToUpdate.map(pos => window.electronAPI.updateCardPosition(pos)),
        saveGroupsToBackend() // Save groups in case membership changed
      ])
    } catch (error) {
      console.error('Error saving card positions:', error)
    }
  }

  const handleGroupDragStart = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return

    // Store initial positions of sticky notes in this group
    const groupStickyNoteIds = group.stickyNoteIds || []
    const initialStickyPositions = new Map<string, { x: number; y: number }>()

    groupStickyNoteIds.forEach(stickyNoteId => {
      const stickyNote = stickyNotes.find(n => n.id === stickyNoteId)
      if (stickyNote) {
        initialStickyPositions.set(stickyNoteId, { x: stickyNote.x, y: stickyNote.y })
      }
    })

    groupDragInitialStickyNotes.current = initialStickyPositions

    // Store initial positions of text boxes in this group
    const groupTextBoxIds = group.textBoxIds || []
    const initialTextBoxPositions = new Map<string, { x: number; y: number }>()

    groupTextBoxIds.forEach(textBoxId => {
      const textBox = textBoxes.find(tb => tb.id === textBoxId)
      if (textBox) {
        initialTextBoxPositions.set(textBoxId, { x: textBox.x, y: textBox.y })
      }
    })

    groupDragInitialTextBoxes.current = initialTextBoxPositions

    // Store initial positions of PDF cards in this group
    const groupPdfCardIds = group.pdfCardIds || []
    const initialPdfCardPositions = new Map<string, { x: number; y: number }>()

    groupPdfCardIds.forEach(pdfCardId => {
      const pdfCard = pdfCards.find(pc => pc.id === pdfCardId)
      if (pdfCard) {
        initialPdfCardPositions.set(pdfCardId, { x: pdfCard.x, y: pdfCard.y })
      }
    })

    groupDragInitialPdfCards.current = initialPdfCardPositions

    // Store initial positions of highlight cards in this group
    const groupHighlightCardIds = group.highlightCardIds || []
    const initialHighlightCardPositions = new Map<string, { x: number; y: number }>()

    groupHighlightCardIds.forEach(highlightCardId => {
      const highlightCard = highlightCards.find(hc => hc.id === highlightCardId)
      if (highlightCard) {
        initialHighlightCardPositions.set(highlightCardId, { x: highlightCard.x, y: highlightCard.y })
      }
    })

    groupDragInitialHighlightCards.current = initialHighlightCardPositions
  }

  const handleGroupDragMove = (groupId: string, deltaX: number, deltaY: number) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return

    const newDragPositions = new Map(dragPositions)

    // Move all cards in the group
    group.cardIds.forEach(cardId => {
      const cardPos = cardPositions.get(cardId)
      if (cardPos) {
        const tempPosition = {
          ...cardPos,
          x: cardPos.x + deltaX,
          y: cardPos.y + deltaY
        }
        newDragPositions.set(cardId, tempPosition)
      }
    })

    // Move all sticky notes in the group using their initial positions
    const groupStickyNoteIds = group.stickyNoteIds || []
    if (groupStickyNoteIds.length > 0) {
      setStickyNotes(prev =>
        prev.map(n => {
          if (groupStickyNoteIds.includes(n.id)) {
            const initialPos = groupDragInitialStickyNotes.current.get(n.id)
            if (initialPos) {
              return {
                ...n,
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY
              }
            }
          }
          return n
        })
      )
    }

    // Move all text boxes in the group using their initial positions
    const groupTextBoxIds = group.textBoxIds || []
    if (groupTextBoxIds.length > 0) {
      setTextBoxes(prev =>
        prev.map(tb => {
          if (groupTextBoxIds.includes(tb.id)) {
            const initialPos = groupDragInitialTextBoxes.current.get(tb.id)
            if (initialPos) {
              return {
                ...tb,
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY
              }
            }
          }
          return tb
        })
      )
    }

    // Move all PDF cards in the group using their initial positions
    const pdfCardIdsInGroup = Array.from(groupDragInitialPdfCards.current.keys())
    if (pdfCardIdsInGroup.length > 0) {
      setPdfCards(prev =>
        prev.map(pc => {
          if (pdfCardIdsInGroup.includes(pc.id)) {
            const initialPos = groupDragInitialPdfCards.current.get(pc.id)
            if (initialPos) {
              return {
                ...pc,
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY
              }
            }
          }
          return pc
        })
      )
    }

    // Move all highlight cards in the group using their initial positions
    const highlightCardIdsInGroup = Array.from(groupDragInitialHighlightCards.current.keys())
    if (highlightCardIdsInGroup.length > 0) {
      setHighlightCards(prev =>
        prev.map(hc => {
          if (highlightCardIdsInGroup.includes(hc.id)) {
            const initialPos = groupDragInitialHighlightCards.current.get(hc.id)
            if (initialPos) {
              return {
                ...hc,
                x: initialPos.x + deltaX,
                y: initialPos.y + deltaY
              }
            }
          }
          return hc
        })
      )
    }

    setDragPositions(newDragPositions)
  }

  const handleGroupDragEnd = async (groupId: string, deltaX: number, deltaY: number) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return

    const newCardPositions = new Map(cardPositions)
    const cardsToUpdate: CardPosition[] = []

    // Update all cards in the group
    group.cardIds.forEach(cardId => {
      const cardPos = cardPositions.get(cardId)
      if (cardPos) {
        const newPosition = {
          ...cardPos,
          x: cardPos.x + deltaX,
          y: cardPos.y + deltaY
        }
        newCardPositions.set(cardId, newPosition)
        cardsToUpdate.push(newPosition)
        updateCardPosition(newPosition)
      }
    })

    // Update all sticky notes in the group using their initial positions
    const groupStickyNoteIds = group.stickyNoteIds || []
    groupStickyNoteIds.forEach(stickyNoteId => {
      const initialPos = groupDragInitialStickyNotes.current.get(stickyNoteId)
      if (initialPos) {
        updateStickyNote(stickyNoteId, {
          x: initialPos.x + deltaX,
          y: initialPos.y + deltaY,
          modifiedAt: new Date()
        })
      }
    })

    // Update all text boxes in the group using their initial positions
    const groupTextBoxIds = group.textBoxIds || []
    groupTextBoxIds.forEach(textBoxId => {
      const initialPos = groupDragInitialTextBoxes.current.get(textBoxId)
      if (initialPos) {
        updateTextBox(textBoxId, {
          x: initialPos.x + deltaX,
          y: initialPos.y + deltaY,
          modifiedAt: new Date()
        })
      }
    })

    // Update all PDF cards in the group using their initial positions
    const pdfCardIdsInGroup = Array.from(groupDragInitialPdfCards.current.keys())
    pdfCardIdsInGroup.forEach(pdfCardId => {
      const initialPos = groupDragInitialPdfCards.current.get(pdfCardId)
      if (initialPos) {
        updatePdfCard(pdfCardId, {
          x: initialPos.x + deltaX,
          y: initialPos.y + deltaY,
          modifiedAt: new Date()
        })
      }
    })

    // Update all highlight cards in the group using their initial positions
    const highlightCardIdsInGroup = Array.from(groupDragInitialHighlightCards.current.keys())
    highlightCardIdsInGroup.forEach(highlightCardId => {
      const initialPos = groupDragInitialHighlightCards.current.get(highlightCardId)
      if (initialPos) {
        updateHighlightCard(highlightCardId, {
          x: initialPos.x + deltaX,
          y: initialPos.y + deltaY,
          modifiedAt: new Date()
        })
      }
    })

    const newGroupX = group.x + deltaX
    const newGroupY = group.y + deltaY

    // Update group position
    updateGroup(groupId, {
      x: newGroupX,
      y: newGroupY,
      modifiedAt: new Date()
    })

    // Update card positions first
    setCardPositions(newCardPositions)

    // Update all group memberships based on new positions
    // This will add cards that are now under the group and remove cards that are no longer in any group
    // Pass the new positions to avoid using stale state
    updateAllGroupMemberships(newCardPositions)

    // Clear temporary drag positions and initial sticky note and text box positions
    setDragPositions(new Map())
    groupDragInitialStickyNotes.current.clear()
    groupDragInitialTextBoxes.current.clear()
    groupDragInitialPdfCards.current.clear()
    groupDragInitialHighlightCards.current.clear()

    // Persist all updated cards, sticky notes, and group to file system
    try {
      await Promise.all([
        ...cardsToUpdate.map(pos => window.electronAPI.updateCardPosition(pos)),
        saveGroupsToBackend(),
        saveStickyNotesToBackend()
      ])
    } catch (error) {
      console.error('Error saving card positions after group drag:', error)
    }
  }

  const handleCardResize = (noteId: string, width: number, height: number) => {
    const position = cardPositions.get(noteId)
    if (!position) return

    const newPosition = { ...position, width, height }
    setCardPositions(new Map(cardPositions.set(noteId, newPosition)))
    updateCardPosition(newPosition)

    // Debounce filesystem save to prevent excessive writes during resize
    const existingTimeout = saveTimeoutRef.current.get(noteId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(async () => {
      try {
        await window.electronAPI.updateCardPosition(newPosition)
        saveTimeoutRef.current.delete(noteId)
      } catch (error) {
        console.error('Error saving card position:', error)
      }
    }, 300) // Wait 300ms after last resize before saving

    saveTimeoutRef.current.set(noteId, timeout)
  }

  // Helper function to check if a card overlaps with a group
  const isCardInGroup = (cardPos: CardPosition, groupX: number, groupY: number, groupWidth: number, groupHeight: number): boolean => {
    // Check if card's center point is within the group bounds
    const cardCenterX = cardPos.x + cardPos.width / 2
    const cardCenterY = cardPos.y + cardPos.height / 2

    return (
      cardCenterX >= groupX &&
      cardCenterX <= groupX + groupWidth &&
      cardCenterY >= groupY &&
      cardCenterY <= groupY + groupHeight
    )
  }

  // Update group membership based on spatial position
  const updateGroupMembership = (
    groupId: string,
    groupX: number,
    groupY: number,
    groupWidth: number,
    groupHeight: number,
    positionsToUse?: Map<string, CardPosition>
  ) => {
    if (!activeWhiteboardId) return

    // Use provided positions or fall back to current state
    const positions = positionsToUse || cardPositions

    // Find all cards that should be in this group
    const newCardIds: string[] = []
    positions.forEach((cardPos, cardId) => {
      if (cardPos.whiteboardId === activeWhiteboardId && isCardInGroup(cardPos, groupX, groupY, groupWidth, groupHeight)) {
        newCardIds.push(cardId)
      }
    })

    // Find all sticky notes that should be in this group
    const newStickyNoteIds: string[] = []
    stickyNotes.forEach((stickyNote) => {
      if (stickyNote.whiteboardId === activeWhiteboardId && isStickyNoteInGroup(stickyNote, groupX, groupY, groupWidth, groupHeight)) {
        newStickyNoteIds.push(stickyNote.id)
      }
    })

    // Find all text boxes that should be in this group
    const newTextBoxIds: string[] = []
    textBoxes.forEach((textBox) => {
      if (textBox.whiteboardId === activeWhiteboardId && isTextBoxInGroup(textBox, groupX, groupY, groupWidth, groupHeight)) {
        newTextBoxIds.push(textBox.id)
      }
    })

    // Find all PDF cards that should be in this group
    const newPdfCardIds: string[] = []
    pdfCards.forEach((pdfCard) => {
      if (pdfCard.whiteboardId === activeWhiteboardId && isPdfCardInGroup(pdfCard, groupX, groupY, groupWidth, groupHeight)) {
        newPdfCardIds.push(pdfCard.id)
      }
    })

    // Find all highlight cards that should be in this group
    const newHighlightCardIds: string[] = []
    highlightCards.forEach((highlightCard) => {
      if (highlightCard.whiteboardId === activeWhiteboardId && isHighlightCardInGroup(highlightCard, groupX, groupY, groupWidth, groupHeight)) {
        newHighlightCardIds.push(highlightCard.id)
      }
    })

    // Update the group with new membership
    updateGroup(groupId, {
      cardIds: newCardIds,
      stickyNoteIds: newStickyNoteIds,
      textBoxIds: newTextBoxIds,
      pdfCardIds: newPdfCardIds,
      highlightCardIds: newHighlightCardIds,
      modifiedAt: new Date()
    })
  }

  // Helper to check if sticky note is within group bounds
  const isStickyNoteInGroup = (stickyNote: StickyNote, groupX: number, groupY: number, groupWidth: number, groupHeight: number) => {
    // Check if sticky note is mostly within the group (center point is within group)
    const centerX = stickyNote.x + stickyNote.width / 2
    const centerY = stickyNote.y + stickyNote.height / 2

    return (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    )
  }

  // Helper to check if text box is within group bounds
  const isTextBoxInGroup = (textBox: TextBox, groupX: number, groupY: number, groupWidth: number, groupHeight: number) => {
    // Check if text box is mostly within the group (center point is within group)
    const centerX = textBox.x + textBox.width / 2
    const centerY = textBox.y + textBox.height / 2

    return (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    )
  }

  // Helper to check if PDF card is within group bounds
  const isPdfCardInGroup = (pdfCard: PdfCard, groupX: number, groupY: number, groupWidth: number, groupHeight: number) => {
    // Check if PDF card is mostly within the group (center point is within group)
    const centerX = pdfCard.x + pdfCard.width / 2
    const centerY = pdfCard.y + pdfCard.height / 2

    return (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    )
  }

  // Helper to check if highlight card is within group bounds
  const isHighlightCardInGroup = (highlightCard: HighlightCard, groupX: number, groupY: number, groupWidth: number, groupHeight: number) => {
    // Check if highlight card is mostly within the group (center point is within group)
    const centerX = highlightCard.x + highlightCard.width / 2
    const centerY = highlightCard.y + highlightCard.height / 2

    return (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    )
  }

  // Update all group memberships to reflect current card positions
  const updateAllGroupMemberships = (positionsToUse?: Map<string, CardPosition>) => {
    if (!activeWhiteboardId) return

    groups.forEach(group => {
      if (group.whiteboardId === activeWhiteboardId) {
        updateGroupMembership(group.id, group.x, group.y, group.width, group.height, positionsToUse)
      }
    })
  }

  const handleGroupResize = (groupId: string, x: number, y: number, width: number, height: number) => {
    // Update group bounds
    updateGroup(groupId, { x, y, width, height, modifiedAt: new Date() })

    // Update membership based on new bounds
    updateGroupMembership(groupId, x, y, width, height)

    // Debounce filesystem save
    const existingTimeout = saveTimeoutRef.current.get(groupId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(async () => {
      try {
        await saveGroupsToBackend()
        saveTimeoutRef.current.delete(groupId)
      } catch (error) {
        console.error('Error saving group:', error)
      }
    }, 300)

    saveTimeoutRef.current.set(groupId, timeout)
  }

  const handleWheel = (e: any) => {
    e.evt.preventDefault()

    const scaleBy = 1.1
    const stage = stageRef.current

    if (!stage) return

    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()

    if (!pointer) return

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy

    // Limit scale
    const limitedScale = Math.max(0.1, Math.min(3, newScale))

    setScale(limitedScale)
    setPosition({
      x: pointer.x - mousePointTo.x * limitedScale,
      y: pointer.y - mousePointTo.y * limitedScale,
    })
  }

  const handleStageDragEnd = (e: any) => {
    // Only allow stage dragging if we're clicking on the stage itself (not a card)
    if (e.target === e.target.getStage()) {
      setPosition({
        x: e.target.x(),
        y: e.target.y(),
      })
    }
  }

  const handleStageMouseDown = (e: any) => {
    // Only start box selection if right-clicking on stage (not on cards)
    if (e.target === e.target.getStage() && e.evt.button === 2) {
      e.evt.preventDefault() // Prevent context menu

      const stage = stageRef.current
      if (!stage) return

      const pos = stage.getPointerPosition()
      if (!pos) return

      // Convert to canvas coordinates
      const x = (pos.x - position.x) / scale
      const y = (pos.y - position.y) / scale

      setIsSelectingBox(true)
      setBoxStartPos({ x, y })
      setSelectionBox({ x, y, width: 0, height: 0 })

      // Clear selection if not holding Ctrl
      if (!e.evt.ctrlKey && !e.evt.metaKey) {
        clearSelection()
      }
    }
  }

  const handleStageMouseMove = () => {
    if (!isSelectingBox || !boxStartPos) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Convert to canvas coordinates
    const currentX = (pos.x - position.x) / scale
    const currentY = (pos.y - position.y) / scale

    // Calculate selection box dimensions
    const x = Math.min(boxStartPos.x, currentX)
    const y = Math.min(boxStartPos.y, currentY)
    const width = Math.abs(currentX - boxStartPos.x)
    const height = Math.abs(currentY - boxStartPos.y)

    setSelectionBox({ x, y, width, height })
  }

  const handleStageMouseUp = (e?: any) => {
    if (isSelectingBox && selectionBox) {
      if (selectionBox.width > 5 && selectionBox.height > 5) {
        // Select all cards within the selection box
        const newSelection = new Set(selectedNoteIds)

        cardPositions.forEach((cardPos, noteId) => {
          // Check if card intersects with selection box
          const cardRight = cardPos.x + cardPos.width
          const cardBottom = cardPos.y + cardPos.height
          const boxRight = selectionBox.x + selectionBox.width
          const boxBottom = selectionBox.y + selectionBox.height

          const intersects =
            cardPos.x < boxRight &&
            cardRight > selectionBox.x &&
            cardPos.y < boxBottom &&
            cardBottom > selectionBox.y

          if (intersects) {
            newSelection.add(noteId)
          }
        })

        setSelectedNoteIds(newSelection)
      } else if (boxStartPos && e) {
        // Right-click with minimal drag - show context menu for creating empty group
        const stage = stageRef.current
        if (stage && e.target === e.target.getStage()) {
          const rect = stage.container().getBoundingClientRect()
          setContextMenu({
            x: rect.left + e.evt.clientX,
            y: rect.top + e.evt.clientY,
            noteId: '__canvas__', // Special ID to indicate canvas context menu
          })
        }
      }
    }

    // Reset box selection state
    setIsSelectingBox(false)
    setBoxStartPos(null)
    setSelectionBox(null)
  }

  const handleStageClick = (e: any) => {
    // Deselect arrow and text box when clicking on canvas background
    if (e.target === e.target.getStage()) {
      setSelectedArrow(null)
      setSelectedTextBoxId(null)
      // If not dragging a box and not holding Ctrl, clear selection
      if (!isSelectingBox && !e.evt.ctrlKey && !e.evt.metaKey) {
        clearSelection()
      }
    }
  }

  const handleStageDoubleClick = async (e: any) => {
    // Create text box on canvas background double-click
    if (e.target === e.target.getStage() && activeWhiteboardId) {
      const stage = stageRef.current
      if (!stage) return

      const pos = stage.getPointerPosition()
      if (!pos) return

      // Convert to canvas coordinates
      const canvasX = (pos.x - position.x) / scale
      const canvasY = (pos.y - position.y) / scale

      const newTextBox: TextBox = {
        id: `textbox-${Date.now()}`,
        whiteboardId: activeWhiteboardId,
        text: '',
        x: canvasX - 60, // Center the text box
        y: canvasY - 20,
        width: 120, // Start with minimum width
        height: 40, // Fixed height for single line
        createdAt: new Date(),
        modifiedAt: new Date(),
      }

      addTextBox(newTextBox)
      await saveTextBoxesToBackend()

      // Start editing immediately
      setTimeout(() => {
        setEditingTextBoxId(newTextBox.id)
      }, 50) // Small delay to ensure state updates
    }
  }

  // Connection point handlers for manual arrow drawing
  const handleConnectionPointMouseDown = (noteId: string, side: 'top' | 'right' | 'bottom' | 'left', e: any) => {
    e.cancelBubble = true
    const position = cardPositions.get(noteId)
    if (!position) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Calculate connection point position based on side
    let pointX = position.x
    let pointY = position.y

    switch (side) {
      case 'top':
        pointX = position.x + position.width / 2
        pointY = position.y
        break
      case 'right':
        pointX = position.x + position.width
        pointY = position.y + position.height / 2
        break
      case 'bottom':
        pointX = position.x + position.width / 2
        pointY = position.y + position.height
        break
      case 'left':
        pointX = position.x
        pointY = position.y + position.height / 2
        break
    }

    setIsDrawingArrow(true)
    setDrawingArrow({
      sourceNoteId: noteId,
      sourceType: 'note',
      sourcePoint: { x: pointX, y: pointY, side },
      currentPoint: { x: (pos.x - position.x) / scale, y: (pos.y - position.y) / scale }
    })
  }

  // Connection point handlers for text boxes
  const handleConnectionPointMouseDownTextBox = (textBoxId: string, side: 'top' | 'right' | 'bottom' | 'left', e: any) => {
    e.cancelBubble = true
    const textBox = textBoxes.find(tb => tb.id === textBoxId)
    if (!textBox) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Calculate connection point position based on side
    let pointX = textBox.x
    let pointY = textBox.y

    switch (side) {
      case 'top':
        pointX = textBox.x + textBox.width / 2
        pointY = textBox.y
        break
      case 'right':
        pointX = textBox.x + textBox.width
        pointY = textBox.y + textBox.height / 2
        break
      case 'bottom':
        pointX = textBox.x + textBox.width / 2
        pointY = textBox.y + textBox.height
        break
      case 'left':
        pointX = textBox.x
        pointY = textBox.y + textBox.height / 2
        break
    }

    setIsDrawingArrow(true)
    setDrawingArrow({
      sourceNoteId: textBoxId, // We reuse this field for text box ID
      sourceType: 'textBox',
      sourcePoint: { x: pointX, y: pointY, side },
      currentPoint: { x: (pos.x - position.x) / scale, y: (pos.y - position.y) / scale }
    })
  }

  // Connection point handlers for PDF cards
  const handleConnectionPointMouseDownPdf = (pdfCardId: string, side: 'top' | 'right' | 'bottom' | 'left', e: any) => {
    e.cancelBubble = true
    const pdfCard = pdfCards.find(pc => pc.id === pdfCardId)
    if (!pdfCard) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Calculate connection point position based on side
    let pointX = pdfCard.x
    let pointY = pdfCard.y

    switch (side) {
      case 'top':
        pointX = pdfCard.x + pdfCard.width / 2
        pointY = pdfCard.y
        break
      case 'right':
        pointX = pdfCard.x + pdfCard.width
        pointY = pdfCard.y + pdfCard.height / 2
        break
      case 'bottom':
        pointX = pdfCard.x + pdfCard.width / 2
        pointY = pdfCard.y + pdfCard.height
        break
      case 'left':
        pointX = pdfCard.x
        pointY = pdfCard.y + pdfCard.height / 2
        break
    }

    setIsDrawingArrow(true)
    setDrawingArrow({
      sourceNoteId: pdfCardId, // We reuse this field for PDF card ID
      sourceType: 'pdf',
      sourcePoint: { x: pointX, y: pointY, side },
      currentPoint: { x: (pos.x - pdfCard.x) / scale, y: (pos.y - pdfCard.y) / scale }
    })
  }

  // Connection point handlers for highlight cards
  const handleConnectionPointMouseDownHighlight = (highlightCardId: string, side: 'top' | 'right' | 'bottom' | 'left', e: any) => {
    e.cancelBubble = true
    const highlightCard = highlightCards.find(hc => hc.id === highlightCardId)
    if (!highlightCard) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Calculate connection point position based on side
    let pointX = highlightCard.x
    let pointY = highlightCard.y

    switch (side) {
      case 'top':
        pointX = highlightCard.x + highlightCard.width / 2
        pointY = highlightCard.y
        break
      case 'right':
        pointX = highlightCard.x + highlightCard.width
        pointY = highlightCard.y + highlightCard.height / 2
        break
      case 'bottom':
        pointX = highlightCard.x + highlightCard.width / 2
        pointY = highlightCard.y + highlightCard.height
        break
      case 'left':
        pointX = highlightCard.x
        pointY = highlightCard.y + highlightCard.height / 2
        break
    }

    setIsDrawingArrow(true)
    setDrawingArrow({
      sourceNoteId: highlightCardId, // We reuse this field for highlight card ID
      sourceType: 'highlight',
      sourcePoint: { x: pointX, y: pointY, side },
      currentPoint: { x: (pos.x - highlightCard.x) / scale, y: (pos.y - highlightCard.y) / scale }
    })
  }

  const handleConnectionDrag = () => {
    if (!isDrawingArrow || !drawingArrow) return

    const stage = stageRef.current
    if (!stage) return

    const pos = stage.getPointerPosition()
    if (!pos) return

    // Convert to canvas coordinates
    const currentX = (pos.x - position.x) / scale
    const currentY = (pos.y - position.y) / scale

    setDrawingArrow({
      ...drawingArrow,
      currentPoint: { x: currentX, y: currentY }
    })
  }

  const handleConnectionDrop = async (targetNoteId: string) => {
    if (!isDrawingArrow || !drawingArrow || !activeWhiteboardId) {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    // Don't allow connecting to self
    if (drawingArrow.sourceNoteId === targetNoteId) {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    // Get source position based on source type
    let sourcePos: { x: number; y: number; width: number; height: number } | undefined
    if (drawingArrow.sourceType === 'note') {
      sourcePos = cardPositions.get(drawingArrow.sourceNoteId)
    } else if (drawingArrow.sourceType === 'textBox') {
      const textBox = textBoxes.find(tb => tb.id === drawingArrow.sourceNoteId)
      if (textBox) {
        sourcePos = { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height }
      }
    } else if (drawingArrow.sourceType === 'pdf') {
      const pdfCard = pdfCards.find(pc => pc.id === drawingArrow.sourceNoteId)
      if (pdfCard) {
        sourcePos = { x: pdfCard.x, y: pdfCard.y, width: pdfCard.width, height: pdfCard.height }
      }
    } else if (drawingArrow.sourceType === 'highlight') {
      const highlightCard = highlightCards.find(hc => hc.id === drawingArrow.sourceNoteId)
      if (highlightCard) {
        sourcePos = { x: highlightCard.x, y: highlightCard.y, width: highlightCard.width, height: highlightCard.height }
      }
    }

    // Get target position based on target type (could be note, textBox, PDF card, or highlight card)
    let targetPos: { x: number; y: number; width: number; height: number } | undefined
    let targetType: 'note' | 'textBox' | 'pdf' | 'highlight' = 'note'

    // Check if target is a note card
    targetPos = cardPositions.get(targetNoteId)
    if (targetPos) {
      targetType = 'note'
    } else {
      // Check if target is a text box
      const targetTextBox = textBoxes.find(tb => tb.id === targetNoteId)
      if (targetTextBox) {
        targetPos = { x: targetTextBox.x, y: targetTextBox.y, width: targetTextBox.width, height: targetTextBox.height }
        targetType = 'textBox'
      } else {
        // Check if target is a PDF card
        const targetPdfCard = pdfCards.find(pc => pc.id === targetNoteId)
        if (targetPdfCard) {
          targetPos = { x: targetPdfCard.x, y: targetPdfCard.y, width: targetPdfCard.width, height: targetPdfCard.height }
          targetType = 'pdf'
        } else {
          // Check if target is a highlight card
          const targetHighlightCard = highlightCards.find(hc => hc.id === targetNoteId)
          if (targetHighlightCard) {
            targetPos = { x: targetHighlightCard.x, y: targetHighlightCard.y, width: targetHighlightCard.width, height: targetHighlightCard.height }
            targetType = 'highlight'
          }
        }
      }
    }

    if (!sourcePos || !targetPos) {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    // Calculate relative positions for source point (0-1 range)
    let sourceRelX = 0.5
    let sourceRelY = 0.5

    switch (drawingArrow.sourcePoint.side) {
      case 'top':
        sourceRelX = 0.5
        sourceRelY = 0
        break
      case 'right':
        sourceRelX = 1
        sourceRelY = 0.5
        break
      case 'bottom':
        sourceRelX = 0.5
        sourceRelY = 1
        break
      case 'left':
        sourceRelX = 0
        sourceRelY = 0.5
        break
    }

    // Calculate target point based on which side of target card we're closest to
    const targetCenterX = targetPos.x + targetPos.width / 2
    const targetCenterY = targetPos.y + targetPos.height / 2

    const dx = drawingArrow.currentPoint.x - targetCenterX
    const dy = drawingArrow.currentPoint.y - targetCenterY

    // Determine which edge is closest
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    let targetRelX = 0.5
    let targetRelY = 0.5

    if (absDx > absDy) {
      // Left or right edge
      if (dx > 0) {
        // Right edge
        targetRelX = 1
        targetRelY = 0.5
      } else {
        // Left edge
        targetRelX = 0
        targetRelY = 0.5
      }
    } else {
      // Top or bottom edge
      if (dy > 0) {
        // Bottom edge
        targetRelX = 0.5
        targetRelY = 1
      } else {
        // Top edge
        targetRelX = 0.5
        targetRelY = 0
      }
    }

    // Calculate control point (middle of line)
    const sourceCenterX = sourcePos.x + sourcePos.width * sourceRelX
    const sourceCenterY = sourcePos.y + sourcePos.height * sourceRelY
    const targetEdgeX = targetPos.x + targetPos.width * targetRelX
    const targetEdgeY = targetPos.y + targetPos.height * targetRelY

    // Create new manual arrow
    const newArrow: Arrow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sourceNoteId: drawingArrow.sourceNoteId,
      targetNoteId,
      sourceType: drawingArrow.sourceType,
      targetType: targetType,
      sourcePoint: { x: sourceRelX, y: sourceRelY },
      targetPoint: { x: targetRelX, y: targetRelY },
      controlPoint: {
        x: (sourceCenterX + targetEdgeX) / 2,
        y: (sourceCenterY + targetEdgeY) / 2
      },
      whiteboardId: activeWhiteboardId,
      isManual: true
    }

    // Add to store and save
    addArrow(newArrow)

    try {
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      await window.electronAPI.saveMetadata({
        version: '2.0',
        whiteboards: currentWhiteboards,
        activeWhiteboardId: currentActiveWhiteboardId,
      })
    } catch (error) {
      console.error('Error saving new manual arrow:', error)
    }

    // Reset drawing state
    setIsDrawingArrow(false)
    setDrawingArrow(null)
  }

  const handleConnectionDropTextBox = async (targetTextBoxId: string) => {
    if (!isDrawingArrow || !drawingArrow || !activeWhiteboardId) {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    // Don't allow connecting to self (same ID and same type)
    if (drawingArrow.sourceNoteId === targetTextBoxId && drawingArrow.sourceType === 'textBox') {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    // Get source position based on source type
    let sourcePos: { x: number; y: number; width: number; height: number } | undefined
    if (drawingArrow.sourceType === 'note') {
      sourcePos = cardPositions.get(drawingArrow.sourceNoteId)
    } else {
      const textBox = textBoxes.find(tb => tb.id === drawingArrow.sourceNoteId)
      if (textBox) {
        sourcePos = { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height }
      }
    }

    const targetTextBox = textBoxes.find(tb => tb.id === targetTextBoxId)
    if (!sourcePos || !targetTextBox) {
      setIsDrawingArrow(false)
      setDrawingArrow(null)
      return
    }

    const targetPos = { x: targetTextBox.x, y: targetTextBox.y, width: targetTextBox.width, height: targetTextBox.height }

    // Calculate relative positions for source point (0-1 range)
    let sourceRelX = 0.5
    let sourceRelY = 0.5

    switch (drawingArrow.sourcePoint.side) {
      case 'top':
        sourceRelX = 0.5
        sourceRelY = 0
        break
      case 'right':
        sourceRelX = 1
        sourceRelY = 0.5
        break
      case 'bottom':
        sourceRelX = 0.5
        sourceRelY = 1
        break
      case 'left':
        sourceRelX = 0
        sourceRelY = 0.5
        break
    }

    // Calculate target point based on which side of target we're closest to
    const targetCenterX = targetPos.x + targetPos.width / 2
    const targetCenterY = targetPos.y + targetPos.height / 2

    const dx = drawingArrow.currentPoint.x - targetCenterX
    const dy = drawingArrow.currentPoint.y - targetCenterY

    // Determine which edge is closest
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    let targetRelX = 0.5
    let targetRelY = 0.5

    if (absDx > absDy) {
      // Left or right edge
      if (dx > 0) {
        // Right edge
        targetRelX = 1
        targetRelY = 0.5
      } else {
        // Left edge
        targetRelX = 0
        targetRelY = 0.5
      }
    } else {
      // Top or bottom edge
      if (dy > 0) {
        // Bottom edge
        targetRelX = 0.5
        targetRelY = 1
      } else {
        // Top edge
        targetRelX = 0.5
        targetRelY = 0
      }
    }

    // Calculate control point (middle of line)
    const sourceCenterX = sourcePos.x + sourcePos.width * sourceRelX
    const sourceCenterY = sourcePos.y + sourcePos.height * sourceRelY
    const targetEdgeX = targetPos.x + targetPos.width * targetRelX
    const targetEdgeY = targetPos.y + targetPos.height * targetRelY

    // Create new manual arrow
    const newArrow: Arrow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sourceNoteId: drawingArrow.sourceNoteId,
      targetNoteId: targetTextBoxId,
      sourceType: drawingArrow.sourceType,
      targetType: 'textBox',
      sourcePoint: { x: sourceRelX, y: sourceRelY },
      targetPoint: { x: targetRelX, y: targetRelY },
      controlPoint: {
        x: (sourceCenterX + targetEdgeX) / 2,
        y: (sourceCenterY + targetEdgeY) / 2
      },
      whiteboardId: activeWhiteboardId,
      isManual: true
    }

    // Add to store and save
    addArrow(newArrow)

    try {
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      await window.electronAPI.saveMetadata({
        version: '2.0',
        whiteboards: currentWhiteboards,
        activeWhiteboardId: currentActiveWhiteboardId,
      })
    } catch (error) {
      console.error('Error saving new manual arrow:', error)
    }

    // Reset drawing state
    setIsDrawingArrow(false)
    setDrawingArrow(null)
  }

  const handleConnectionCancel = () => {
    setIsDrawingArrow(false)
    setDrawingArrow(null)
  }

  const handleEditTextBox = (textBoxId: string) => {
    setEditingTextBoxId(textBoxId)
  }

  // Helper function to calculate text box height based on content
  const calculateTextBoxWidth = (text: string): number => {
    if (!text || text.trim() === '') {
      return 120 // Minimum width for empty text boxes
    }

    // Estimate character width
    const avgCharWidth = 8.5 // Approximate width of characters at 14px
    const padding = 16 // 8px on each side for minimal spacing

    // Calculate width needed for single line
    const calculatedWidth = text.length * avgCharWidth + padding
    return Math.max(120, Math.min(800, calculatedWidth)) // Min 120px, max 800px
  }

  const handleCardContextMenu = (e: any, noteId: string) => {
    e.evt.preventDefault()

    // Get the absolute position of the mouse click
    const stage = stageRef.current
    if (stage) {
      const pointerPosition = stage.getPointerPosition()
      if (pointerPosition) {
        setContextMenu({
          x: pointerPosition.x,
          y: pointerPosition.y,
          noteId,
        })
      }
    }
  }

  const handleRename = (noteId: string) => {
    const note = notes.get(noteId)
    if (note) {
      setRenameModal({
        noteId: note.id,
        currentName: note.title,
        path: note.path,
      })
    }
  }

  const performRename = async (newName: string) => {
    if (!renameModal || !vaultPath) return

    const note = notes.get(renameModal.noteId)
    if (!note || newName === note.title) return

    try {
      // Update frontmatter with new title
      const updatedFrontmatter = {
        ...(note.frontmatter || {}),
        title: newName,
      }

      // Serialize with frontmatter
      const frontmatterLines = Object.entries(updatedFrontmatter).map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key}: ${value}`
        } else if (Array.isArray(value)) {
          const arrayValue = value as any[]
          return `${key}: [${arrayValue.map((v: any) => typeof v === 'string' ? `"${v}"` : v).join(', ')}]`
        } else {
          return `${key}: ${JSON.stringify(value)}`
        }
      })

      const fileContent = `---\n${frontmatterLines.join('\n')}\n---\n${note.content}`

      // Create new file path
      const oldPath = note.path
      const normalizedPath = oldPath.replace(/\\/g, '/')
      const lastSlashIndex = normalizedPath.lastIndexOf('/')
      const directory = normalizedPath.substring(0, lastSlashIndex)
      const newPath = `${directory}/${newName}.md`
      const finalNewPath = oldPath.includes('\\') ? newPath.replace(/\//g, '\\') : newPath

      // Write updated content to old path
      await window.electronAPI.writeFile(oldPath, fileContent)

      // Rename the file
      await window.electronAPI.renameFile(oldPath, finalNewPath)

      // Update file tree
      updateFileInTree(oldPath, finalNewPath, `${newName}.md`)

      // Update the selected note ID if this note is selected
      if (selectedNoteId === renameModal.noteId) {
        const newId = finalNewPath
          .replace(vaultPath, '')
          .replace(/^[\\\/]/, '')
          .replace(/\.md$/, '')
          .replace(/\\/g, '/')
        setSelectedNoteId(newId)
      }
    } catch (error) {
      console.error('Error renaming note:', error)
      alert('Failed to rename note')
    }
  }

  const handleRemoveFromWhiteboard = async (noteId: string) => {
    if (!activeWhiteboardId) return

    // Determine which cards to remove:
    // - If multiple cards are selected, remove ALL selected cards
    // - Otherwise, remove only the right-clicked card
    const noteIdsToRemove = selectedNoteIds.size > 1
      ? Array.from(selectedNoteIds)
      : [noteId]

    // Get titles for confirmation message
    const titlesToRemove = noteIdsToRemove
      .map(id => notes.get(id)?.title)
      .filter((title): title is string => !!title)

    if (titlesToRemove.length === 0) return

    const message = titlesToRemove.length === 1
      ? `Remove "${titlesToRemove[0]}" from this whiteboard? The note file will not be deleted.`
      : `Remove ${titlesToRemove.length} cards from this whiteboard? The note files will not be deleted.`

    const confirmed = await confirm({
      message,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      isDanger: false
    })

    if (!confirmed) {
      return
    }

    try {
      // Remove all cards from whiteboard
      for (const id of noteIdsToRemove) {
        await window.electronAPI.removeCardFromWhiteboard(id, activeWhiteboardId)
      }

      // Update frontend store
      const { whiteboards, setWhiteboards } = useVaultStore.getState()
      const updatedWhiteboards = whiteboards.map(wb => {
        if (wb.id === activeWhiteboardId) {
          return {
            ...wb,
            cards: wb.cards.filter(card => !noteIdsToRemove.includes(card.id)),
            arrows: wb.arrows.filter(arrow =>
              !noteIdsToRemove.includes(arrow.sourceNoteId) &&
              !noteIdsToRemove.includes(arrow.targetNoteId)
            )
          }
        }
        return wb
      })
      setWhiteboards(updatedWhiteboards)

      // Clear selection after removing
      clearSelection()
    } catch (error) {
      console.error('Error removing note from whiteboard:', error)
      alert('Failed to remove note from whiteboard')
    }
  }

  const handleDelete = async (noteId: string) => {
    // Determine which cards to delete:
    // - If multiple cards are selected, delete ALL selected cards
    // - Otherwise, delete only the right-clicked card
    const noteIdsToDelete = selectedNoteIds.size > 1
      ? Array.from(selectedNoteIds)
      : [noteId]

    // Get titles for confirmation message
    const titlesToDelete = noteIdsToDelete
      .map(id => notes.get(id)?.title)
      .filter((title): title is string => !!title)

    if (titlesToDelete.length === 0) return

    const message = titlesToDelete.length === 1
      ? `Are you sure you want to delete "${titlesToDelete[0]}"?`
      : `Are you sure you want to delete ${titlesToDelete.length} notes? This action cannot be undone.`

    const confirmed = await confirm({
      message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDanger: true
    })

    if (!confirmed) {
      return
    }

    try {
      // First, remove cards from all whiteboards and clean up arrows
      const { whiteboards, setWhiteboards } = useVaultStore.getState()
      const updatedWhiteboards = whiteboards.map(wb => ({
        ...wb,
        cards: wb.cards.filter(card => !noteIdsToDelete.includes(card.id)),
        arrows: wb.arrows.filter(arrow =>
          !noteIdsToDelete.includes(arrow.sourceNoteId) &&
          !noteIdsToDelete.includes(arrow.targetNoteId)
        )
      }))
      setWhiteboards(updatedWhiteboards)

      // Delete all cards from filesystem
      for (const id of noteIdsToDelete) {
        const note = notes.get(id)
        if (note) {
          // Remove from backend whiteboards (to keep backend in sync)
          for (const wb of whiteboards) {
            const cardExists = wb.cards.some(card => card.id === id)
            if (cardExists) {
              await window.electronAPI.removeCardFromWhiteboard(id, wb.id)
            }
          }
          // Delete from filesystem
          await window.electronAPI.deleteFile(note.path)
          // Remove from store
          deleteNote(id)
        }
      }

      // Clear selection after deleting
      clearSelection()
    } catch (error) {
      console.error('Error deleting note:', error)
      alert('Failed to delete note')
    }
  }

  const handleCreateGroup = (emptyGroupPosition?: { x: number; y: number }) => {
    setContextMenu(null)
    // Store the position for empty group creation if provided
    if (emptyGroupPosition) {
      ;(window as any).__emptyGroupPosition = emptyGroupPosition
    }
    setGroupNameModal({ type: 'create' })
  }

  const performCreateGroup = async (groupName: string) => {
    if (!activeWhiteboardId) return

    let x = 0, y = 0, width = 400, height = 300
    const cardIds = Array.from(selectedNoteIds)

    // Calculate bounds based on selected cards, or use empty group position
    if (cardIds.length > 0) {
      // Calculate bounds from selected cards (including notes and PDF cards)
      const selectedCards: CardPosition[] = []

      cardIds.forEach(id => {
        // Check if it's a note card
        const noteCard = cardPositions.get(id)
        if (noteCard) {
          selectedCards.push(noteCard)
          return
        }

        // Check if it's a PDF card
        const pdfCard = pdfCards.find(pc => pc.id === id)
        if (pdfCard) {
          selectedCards.push({
            id: pdfCard.id,
            x: pdfCard.x,
            y: pdfCard.y,
            width: pdfCard.width,
            height: pdfCard.height,
            whiteboardId: pdfCard.whiteboardId
          })
        }
      })

      if (selectedCards.length > 0) {
        const padding = 30
        const minX = Math.min(...selectedCards.map(c => c.x))
        const minY = Math.min(...selectedCards.map(c => c.y))
        const maxX = Math.max(...selectedCards.map(c => c.x + c.width))
        const maxY = Math.max(...selectedCards.map(c => c.y + c.height))

        x = minX - padding
        y = minY - padding - 30 // Extra space for label
        width = maxX - minX + padding * 2
        height = maxY - minY + padding * 2 + 30 // Extra space for label
      }
    } else {
      // Use position from empty group creation (right-click on blank canvas)
      const emptyGroupPos = (window as any).__emptyGroupPosition
      if (emptyGroupPos) {
        x = emptyGroupPos.x - width / 2
        y = emptyGroupPos.y - height / 2
        delete (window as any).__emptyGroupPosition
      }
    }

    const newGroup: CardGroup = {
      id: `group-${Date.now()}`,
      whiteboardId: activeWhiteboardId,
      name: groupName,
      cardIds,
      color: '#667eea', // Default color
      x,
      y,
      width,
      height,
      createdAt: new Date(),
      modifiedAt: new Date(),
    }

    addGroup(newGroup)

    // Save to backend
    try {
      const activeWhiteboard = whiteboards.find(w => w.id === activeWhiteboardId)
      if (activeWhiteboard) {
        const updatedWhiteboard = {
          ...activeWhiteboard,
          groups: [...activeWhiteboard.groups, newGroup],
        }
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: whiteboards.map(w => w.id === activeWhiteboardId ? updatedWhiteboard : w),
          activeWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving group:', error)
    }
  }

  const handleUngroup = async (groupId: string) => {
    deleteGroup(groupId)
    await saveGroupsToBackend()
    setContextMenu(null)
  }

  const handleChangeGroupColor = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return

    setContextMenu(null)
    setColorPickerModal({ groupId, currentColor: group.color })
  }

  const performChangeGroupColor = async (groupId: string, newColor: string) => {
    updateGroup(groupId, { color: newColor, modifiedAt: new Date() })
    await saveGroupsToBackend()
  }

  const saveGroupsToBackend = async () => {
    try {
      // FIXED: Get fresh state from store to avoid stale closure state
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      const activeWhiteboard = currentWhiteboards.find(w => w.id === currentActiveWhiteboardId)
      if (activeWhiteboard) {
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: currentWhiteboards,
          activeWhiteboardId: currentActiveWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving groups:', error)
    }
  }

  const handleEditGroupName = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return

    setContextMenu(null)
    setGroupNameModal({ type: 'edit', groupId, currentName: group.name })
  }

  const performEditGroupName = async (groupId: string, newName: string) => {
    updateGroup(groupId, { name: newName, modifiedAt: new Date() })
    await saveGroupsToBackend()
  }

  // Sticky note handlers
  const handleStickyNoteDragEnd = async (stickyNoteId: string, x: number, y: number) => {
    updateStickyNote(stickyNoteId, { x, y, modifiedAt: new Date() })
    await saveStickyNotesToBackend()
  }

  const handleStickyNoteResize = (stickyNoteId: string, x: number, y: number, width: number, height: number) => {
    updateStickyNote(stickyNoteId, { x, y, width, height, modifiedAt: new Date() })

    // Debounce filesystem save to prevent excessive writes during resize
    const existingTimeout = saveTimeoutRef.current.get('sticky-' + stickyNoteId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(async () => {
      try {
        await saveStickyNotesToBackend()
        saveTimeoutRef.current.delete('sticky-' + stickyNoteId)
      } catch (error) {
        console.error('Error saving sticky note:', error)
      }
    }, 300) // Wait 300ms after last resize before saving

    saveTimeoutRef.current.set('sticky-' + stickyNoteId, timeout)
  }

  const handleEditStickyNote = (stickyNoteId: string) => {
    const note = stickyNotes.find(n => n.id === stickyNoteId)
    if (!note) return

    setContextMenu(null)
    setStickyNoteEditorModal({ stickyNoteId, currentText: note.text })
  }

  const performEditStickyNote = async (stickyNoteId: string, newText: string) => {
    updateStickyNote(stickyNoteId, { text: newText, modifiedAt: new Date() })
    await saveStickyNotesToBackend()
  }

  const handleChangeStickyNoteColor = (stickyNoteId: string) => {
    const note = stickyNotes.find(n => n.id === stickyNoteId)
    if (!note) return

    setContextMenu(null)
    setStickyNoteColorPickerModal({ stickyNoteId, currentColor: note.color })
  }

  const performChangeStickyNoteColor = async (stickyNoteId: string, newColor: string) => {
    updateStickyNote(stickyNoteId, { color: newColor, modifiedAt: new Date() })
    await saveStickyNotesToBackend()
  }

  const handleDeleteStickyNote = async (stickyNoteId: string) => {
    const confirmed = await confirm({
      message: 'Are you sure you want to delete this sticky note?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    deleteStickyNote(stickyNoteId)
    await saveStickyNotesToBackend()
  }

  const saveStickyNotesToBackend = async () => {
    try {
      // FIXED: Get fresh state from store to avoid stale closure state
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      const activeWhiteboard = currentWhiteboards.find(w => w.id === currentActiveWhiteboardId)
      if (activeWhiteboard) {
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: currentWhiteboards,
          activeWhiteboardId: currentActiveWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving sticky notes:', error)
    }
  }

  // Text box handlers
  const handleTextBoxDragEnd = async (textBoxId: string, x: number, y: number) => {
    updateTextBox(textBoxId, { x, y, modifiedAt: new Date() })
    await saveTextBoxesToBackend()
  }

  // Text boxes are now single-line with auto-width, no manual resize needed
  // const handleTextBoxResize = (textBoxId: string, x: number, y: number, width: number, height: number) => {
  //   updateTextBox(textBoxId, { x, y, width, height, modifiedAt: new Date() })

  //   // Debounce filesystem save to prevent excessive writes during resize
  //   const existingTimeout = saveTimeoutRef.current.get('textbox-' + textBoxId)
  //   if (existingTimeout) {
  //     clearTimeout(existingTimeout)
  //   }

  //   const timeout = setTimeout(async () => {
  //     try {
  //       await saveTextBoxesToBackend()
  //       saveTimeoutRef.current.delete('textbox-' + textBoxId)
  //     } catch (error) {
  //       console.error('Error saving text box:', error)
  //     }
  //   }, 300) // Wait 300ms after last resize before saving

  //   saveTimeoutRef.current.set('textbox-' + textBoxId, timeout)
  // }

  const handleDeleteTextBox = async (textBoxId: string) => {
    const confirmed = await confirm({
      message: 'Are you sure you want to delete this text box?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    deleteTextBox(textBoxId)
    await saveTextBoxesToBackend()
  }

  const handleDeletePdfCard = async (pdfCardId: string) => {
    const pdfCard = pdfCards.find(pc => pc.id === pdfCardId)
    if (!pdfCard) return

    const confirmed = await confirm({
      message: `Are you sure you want to delete "${pdfCard.title}"? This will also delete the PDF file.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    deletePdfCard(pdfCardId)
    setSelectedPdfId(null)

    // Delete the PDF file and thumbnail from the filesystem
    try {
      await window.electronAPI.pdfDelete(pdfCard.pdfPath)
      if (pdfCard.thumbnailPath) {
        await window.electronAPI.pdfDeleteThumbnail(pdfCard.thumbnailPath)
      }
    } catch (error) {
      console.error('Error deleting PDF file:', error)
    }

    await savePdfCardsToBackend()
  }

  const handleDeleteHighlightCard = async (highlightCardId: string) => {
    const highlightCard = highlightCards.find(hc => hc.id === highlightCardId)
    if (!highlightCard) return

    const confirmed = await confirm({
      message: `Are you sure you want to delete this highlight card?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })
    if (!confirmed) return

    deleteHighlightCard(highlightCardId)

    // Clear selection if this card was selected
    if (selectedNoteId === highlightCardId) {
      setSelectedNoteId(null)
    }
    if (selectedNoteIds.has(highlightCardId)) {
      const newSelection = new Set(selectedNoteIds)
      newSelection.delete(highlightCardId)
      setSelectedNoteIds(newSelection)
    }

    await saveHighlightCardsToBackend()
  }

  const saveHighlightCardsToBackend = async () => {
    try {
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      const activeWhiteboard = currentWhiteboards.find(w => w.id === currentActiveWhiteboardId)
      if (activeWhiteboard) {
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: currentWhiteboards,
          activeWhiteboardId: currentActiveWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving highlight cards:', error)
    }
  }

  const savePdfCardsToBackend = async () => {
    try {
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      const activeWhiteboard = currentWhiteboards.find(w => w.id === currentActiveWhiteboardId)
      if (activeWhiteboard) {
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: currentWhiteboards,
          activeWhiteboardId: currentActiveWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving PDF cards:', error)
    }
  }

  const saveTextBoxesToBackend = async () => {
    try {
      const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
      const activeWhiteboard = currentWhiteboards.find(w => w.id === currentActiveWhiteboardId)
      if (activeWhiteboard) {
        await window.electronAPI.saveMetadata({
          version: '2.0',
          whiteboards: currentWhiteboards,
          activeWhiteboardId: currentActiveWhiteboardId,
        })
      }
    } catch (error) {
      console.error('Error saving text boxes:', error)
    }
  }

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? (() => {
        // Check if this is a canvas context menu (right-click on blank space)
        if (contextMenu.noteId === '__canvas__') {
          const stage = stageRef.current
          if (!stage) return []

          // Get the canvas position where user right-clicked
          const pos = stage.getPointerPosition()
          if (!pos) return []

          const canvasX = (pos.x - position.x) / scale
          const canvasY = (pos.y - position.y) / scale

          return [
            {
              label: 'Create Empty Group',
              icon: <Edit size={16} />,
              onClick: () => handleCreateGroup({ x: canvasX, y: canvasY }),
            },
          ]
        }

        // Check if this is a group context menu
        const isGroupMenu = contextMenu.noteId.startsWith('group-')
        const groupId = isGroupMenu ? contextMenu.noteId.replace('group-', '') : null

        if (isGroupMenu && groupId) {
          const group = groups.find(g => g.id === groupId)
          if (!group) return []

          return [
            {
              label: 'Rename Group',
              icon: <Edit size={16} />,
              onClick: () => handleEditGroupName(groupId),
            },
            {
              label: 'Change Color',
              icon: <Edit size={16} />,
              onClick: () => handleChangeGroupColor(groupId),
            },
            {
              label: 'Ungroup',
              icon: <X size={16} />,
              onClick: () => handleUngroup(groupId),
            },
          ]
        }

        // Check if this is a sticky note context menu
        const isStickyNoteMenu = contextMenu.noteId.startsWith('stickynote-')
        const stickyNoteId = isStickyNoteMenu ? contextMenu.noteId.replace('stickynote-', '') : null

        if (isStickyNoteMenu && stickyNoteId) {
          const note = stickyNotes.find(n => n.id === stickyNoteId)
          if (!note) return []

          return [
            {
              label: 'Edit Text',
              icon: <Edit size={16} />,
              onClick: () => handleEditStickyNote(stickyNoteId),
            },
            {
              label: 'Change Color',
              icon: <Edit size={16} />,
              onClick: () => handleChangeStickyNoteColor(stickyNoteId),
            },
            {
              label: 'Delete',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: () => handleDeleteStickyNote(stickyNoteId),
            },
          ]
        }

        // Check if this is an arrow context menu
        const isArrowMenu = contextMenu.noteId.startsWith('arrow-')
        const arrowId = isArrowMenu ? contextMenu.noteId.replace('arrow-', '') : null

        if (isArrowMenu && arrowId) {
          const arrow = arrows.get(arrowId)
          if (!arrow || !arrow.isManual) return []

          return [
            {
              label: 'Delete Connection',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: async () => {
                setContextMenu(null)
                const confirmed = await confirm({
                  message: 'Are you sure you want to delete this connection?',
                  confirmText: 'Delete',
                  cancelText: 'Cancel',
                })
                if (!confirmed) return

                deleteArrow(arrowId)
                setSelectedArrow(null)

                try {
                  const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
                  await window.electronAPI.saveMetadata({
                    version: '2.0',
                    whiteboards: currentWhiteboards,
                    activeWhiteboardId: currentActiveWhiteboardId,
                  })
                } catch (error) {
                  console.error('Error deleting arrow:', error)
                }
              },
            },
          ]
        }

        // Check if this is a text box context menu
        const isTextBoxMenu = contextMenu.noteId.startsWith('textbox-')
        const textBoxId = isTextBoxMenu ? contextMenu.noteId.replace('textbox-', '') : null

        if (isTextBoxMenu && textBoxId) {
          const textBox = textBoxes.find(tb => tb.id === textBoxId)
          if (!textBox) return []

          return [
            {
              label: 'Delete',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: () => handleDeleteTextBox(textBoxId),
            },
          ]
        }

        // Check if this is a PDF card context menu
        const isPdfCardMenu = contextMenu.noteId.startsWith('pdf-')
        const pdfCardId = isPdfCardMenu ? contextMenu.noteId.replace('pdf-', '') : null

        if (isPdfCardMenu && pdfCardId) {
          const pdfCard = pdfCards.find(pc => pc.id === pdfCardId)
          if (!pdfCard) return []

          return [
            {
              label: 'Delete',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: () => handleDeletePdfCard(pdfCardId),
            },
          ]
        }

        // Check if this is a highlight card context menu
        const isHighlightCardMenu = contextMenu.noteId.startsWith('highlight-')
        const highlightCardId = isHighlightCardMenu ? contextMenu.noteId.replace('highlight-', '') : null

        if (isHighlightCardMenu && highlightCardId) {
          const highlightCard = highlightCards.find(hc => hc.id === highlightCardId)
          if (!highlightCard) return []

          return [
            {
              label: 'Delete',
              icon: <Trash2 size={16} />,
              danger: true,
              onClick: () => handleDeleteHighlightCard(highlightCardId),
            },
          ]
        }

        // Regular card context menu
        const isMultiSelect = selectedNoteIds.size > 1

        return [
          // Only show rename when not multi-selecting
          ...(!isMultiSelect
            ? [
                {
                  label: 'Rename',
                  icon: <Edit size={16} />,
                  onClick: () => handleRename(contextMenu.noteId),
                },
              ]
            : []),
          // Add "Create Group" option when multiple cards are selected
          ...(isMultiSelect
            ? [
                {
                  label: 'Create Group',
                  icon: <Edit size={16} />,
                  onClick: () => handleCreateGroup(),
                },
              ]
            : []),
          {
            label: isMultiSelect ? 'Remove from Whiteboard (All Selected)' : 'Remove from Whiteboard',
            icon: <X size={16} />,
            onClick: () => handleRemoveFromWhiteboard(contextMenu.noteId),
          },
          {
            label: isMultiSelect ? 'Delete (All Selected)' : 'Delete',
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => handleDelete(contextMenu.noteId),
          },
        ]
      })()
    : []

  return (
    <>
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onDragEnd={handleStageDragEnd}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onDblClick={handleStageDoubleClick}
        onDblTap={handleStageDoubleClick}
        onMouseDown={handleStageMouseDown}
        onMouseMove={() => {
          if (isDrawingArrow) {
            handleConnectionDrag()
          } else {
            handleStageMouseMove()
          }
        }}
        onMouseUp={(e) => {
          if (isDrawingArrow && drawingArrow) {
            // Check if mouse is over any card or text box
            const stage = stageRef.current
            if (stage) {
              const pos = stage.getPointerPosition()
              if (pos) {
                // Convert to canvas coordinates
                const canvasX = (pos.x - position.x) / scale
                const canvasY = (pos.y - position.y) / scale

                let foundTarget = false

                // First check if we're over any text box
                for (const textBox of textBoxes) {
                  if (
                    canvasX >= textBox.x &&
                    canvasX <= textBox.x + textBox.width &&
                    canvasY >= textBox.y &&
                    canvasY <= textBox.y + textBox.height &&
                    !(drawingArrow.sourceNoteId === textBox.id && drawingArrow.sourceType === 'textBox') // not the source text box
                  ) {
                    // Over a valid target text box
                    handleConnectionDropTextBox(textBox.id)
                    foundTarget = true
                    break
                  }
                }

                // If not over a text box, check if we're over any PDF card
                if (!foundTarget) {
                  for (const pdfCard of pdfCards) {
                    if (
                      canvasX >= pdfCard.x &&
                      canvasX <= pdfCard.x + pdfCard.width &&
                      canvasY >= pdfCard.y &&
                      canvasY <= pdfCard.y + pdfCard.height &&
                      !(drawingArrow.sourceNoteId === pdfCard.id && drawingArrow.sourceType === 'pdf') // not the source PDF card
                    ) {
                      // Over a valid target PDF card
                      handleConnectionDrop(pdfCard.id)
                      foundTarget = true
                      break
                    }
                  }
                }

                // If not over a text box or PDF card, check if we're over any highlight card
                if (!foundTarget) {
                  for (const highlightCard of highlightCards) {
                    if (
                      canvasX >= highlightCard.x &&
                      canvasX <= highlightCard.x + highlightCard.width &&
                      canvasY >= highlightCard.y &&
                      canvasY <= highlightCard.y + highlightCard.height &&
                      !(drawingArrow.sourceNoteId === highlightCard.id && drawingArrow.sourceType === 'highlight') // not the source highlight card
                    ) {
                      // Over a valid target highlight card
                      handleConnectionDrop(highlightCard.id)
                      foundTarget = true
                      break
                    }
                  }
                }

                // If not over a text box, PDF card, or highlight card, check if we're over any note card
                if (!foundTarget) {
                  for (const [noteId, cardPos] of cardPositions) {
                    if (
                      canvasX >= cardPos.x &&
                      canvasX <= cardPos.x + cardPos.width &&
                      canvasY >= cardPos.y &&
                      canvasY <= cardPos.y + cardPos.height &&
                      !(drawingArrow.sourceNoteId === noteId && drawingArrow.sourceType === 'note') // not the source card
                    ) {
                      // Over a valid target card
                      handleConnectionDrop(noteId)
                      foundTarget = true
                      break
                    }
                  }
                }

                // If not over any valid target (text box, PDF card, highlight card, or note card), cancel the drawing
                if (!foundTarget) {
                  handleConnectionCancel()
                }
              } else {
                handleConnectionCancel()
              }
            } else {
              handleConnectionCancel()
            }
          } else {
            handleStageMouseUp(e)
          }
          // Reset cursor when mouse is released on stage (outside cards)
          const container = e.target.getStage()?.container()
          if (container) {
            container.style.cursor = 'default'
          }
        }}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        draggable={!isSelectingBox}
        onContextMenu={(e) => {
          // Prevent default context menu when right-clicking on stage
          if (e.target === e.target.getStage()) {
            e.evt.preventDefault()
          }
        }}
      >
        <Layer>
          {/* Render modern smart arrows */}
          {Array.from(arrows.values())
            .filter(arrow => {
              // Hide auto-generated arrows if hideAutoArrows is enabled
              if (hideAutoArrows && !arrow.isManual) return false
              return true
            })
            .map((arrow) => {
            // Get source position based on type
            const sourceType = arrow.sourceType || 'note'
            let baseSourcePos: RectType | undefined
            if (sourceType === 'note') {
              const pos = cardPositions.get(arrow.sourceNoteId)
              if (pos) baseSourcePos = { x: pos.x, y: pos.y, width: pos.width, height: pos.height }
            } else if (sourceType === 'pdf') {
              const pdfCard = pdfCards.find(pc => pc.id === arrow.sourceNoteId)
              if (pdfCard) {
                baseSourcePos = { x: pdfCard.x, y: pdfCard.y, width: pdfCard.width, height: pdfCard.height }
              }
            } else if (sourceType === 'highlight') {
              const highlightCard = highlightCards.find(hc => hc.id === arrow.sourceNoteId)
              if (highlightCard) {
                baseSourcePos = { x: highlightCard.x, y: highlightCard.y, width: highlightCard.width, height: highlightCard.height }
              }
            } else {
              const textBox = textBoxes.find(tb => tb.id === arrow.sourceNoteId)
              if (textBox) {
                baseSourcePos = { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height }
              }
            }

            // Get target position based on type
            const targetType = arrow.targetType || 'note'
            let baseTargetPos: RectType | undefined
            if (targetType === 'note') {
              const pos = cardPositions.get(arrow.targetNoteId)
              if (pos) baseTargetPos = { x: pos.x, y: pos.y, width: pos.width, height: pos.height }
            } else if (targetType === 'pdf') {
              const pdfCard = pdfCards.find(pc => pc.id === arrow.targetNoteId)
              if (pdfCard) {
                baseTargetPos = { x: pdfCard.x, y: pdfCard.y, width: pdfCard.width, height: pdfCard.height }
              }
            } else if (targetType === 'highlight') {
              const highlightCard = highlightCards.find(hc => hc.id === arrow.targetNoteId)
              if (highlightCard) {
                baseTargetPos = { x: highlightCard.x, y: highlightCard.y, width: highlightCard.width, height: highlightCard.height }
              }
            } else {
              const textBox = textBoxes.find(tb => tb.id === arrow.targetNoteId)
              if (textBox) {
                baseTargetPos = { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height }
              }
            }

            if (!baseSourcePos || !baseTargetPos) return null

            // Use drag positions if available for real-time updates (only for notes)
            const sourcePos: RectType = (sourceType === 'note' && dragPositions.get(arrow.sourceNoteId)) || baseSourcePos
            const targetPos: RectType = (targetType === 'note' && dragPositions.get(arrow.targetNoteId)) || baseTargetPos

            // Build obstacles array (all cards except source and target)
            const obstacles: RectType[] = []
            for (const [noteId, pos] of cardPositions) {
              if (noteId !== arrow.sourceNoteId && noteId !== arrow.targetNoteId) {
                // Use drag position if available
                const actualPos = dragPositions.get(noteId) || pos
                obstacles.push({
                  x: actualPos.x,
                  y: actualPos.y,
                  width: actualPos.width,
                  height: actualPos.height,
                })
              }
            }

            const isSelected = selectedArrow === arrow.id
            const isManual = arrow.isManual === true

            // Determine arrow style
            const style = arrow.style || (isManual ? ArrowStylePresets.manual : ArrowStylePresets.auto)

            return (
              <Group key={arrow.id}>
                <SmartArrow
                  sourceRect={sourcePos}
                  targetRect={targetPos}
                  obstacles={obstacles}
                  style={style}
                  isSelected={isSelected}
                  showWaypoints={isSelected}
                  onClick={() => setSelectedArrow(arrow.id)}
                  onContextMenu={(e) => {
                    e.evt.preventDefault()
                    const stage = e.target.getStage()
                    if (stage) {
                      const rect = stage.container().getBoundingClientRect()
                      setContextMenu({
                        x: rect.left + e.evt.clientX,
                        y: rect.top + e.evt.clientY,
                        noteId: `arrow-${arrow.id}`,
                      })
                    }
                  }}
                />
              </Group>
            )
          })}

          {/* Render groups (behind cards) */}
          {groups.map((group) => {
            // Use drag positions for cards if available
            const groupCardPositions = new Map(cardPositions)
            group.cardIds.forEach(cardId => {
              const dragPos = dragPositions.get(cardId)
              if (dragPos) {
                groupCardPositions.set(cardId, dragPos)
              }
            })

            return (
              <CardGroupComponent
                key={group.id}
                group={group}
                cardPositions={groupCardPositions}
                isSearchActive={searchQuery.length > 0}
                isSearchMatched={searchMatchedIds.has(group.id)}
                onDragStart={() => handleGroupDragStart(group.id)}
                onDragMove={(deltaX, deltaY) => handleGroupDragMove(group.id, deltaX, deltaY)}
                onDragEnd={(deltaX, deltaY) => handleGroupDragEnd(group.id, deltaX, deltaY)}
                onResize={(x, y, width, height) => handleGroupResize(group.id, x, y, width, height)}
                onDoubleClick={() => handleEditGroupName(group.id)}
                onContextMenu={(e) => {
                  // Handle group context menu
                  e.evt.preventDefault()
                  const stage = e.target.getStage()
                  if (stage) {
                    const rect = stage.container().getBoundingClientRect()
                    setContextMenu({
                      x: rect.left + e.evt.clientX,
                      y: rect.top + e.evt.clientY,
                      noteId: `group-${group.id}`,
                    })
                  }
                }}
              />
            )
          })}

          {/* Render sticky notes (after groups, before cards) */}
          {stickyNotes.map((stickyNote) => {
            return (
              <StickyNoteComponent
                key={stickyNote.id}
                note={stickyNote}
                isSearchActive={searchQuery.length > 0}
                isSearchMatched={searchMatchedIds.has(stickyNote.id)}
                onDragMove={(x, y) => {
                  // Update local state for smooth dragging
                  setStickyNotes(prev =>
                    prev.map(n => n.id === stickyNote.id ? { ...n, x, y } : n)
                  )
                }}
                onDragEnd={(x, y) => handleStickyNoteDragEnd(stickyNote.id, x, y)}
                onResize={(x, y, width, height) => handleStickyNoteResize(stickyNote.id, x, y, width, height)}
                onDoubleClick={() => handleEditStickyNote(stickyNote.id)}
                onContextMenu={(e) => {
                  e.evt.preventDefault()
                  const stage = e.target.getStage()
                  if (stage) {
                    const rect = stage.container().getBoundingClientRect()
                    setContextMenu({
                      x: rect.left + e.evt.clientX,
                      y: rect.top + e.evt.clientY,
                      noteId: `stickynote-${stickyNote.id}`,
                    })
                  }
                }}
              />
            )
          })}

          {/* Render text boxes (after sticky notes, before cards) */}
          {textBoxes.map((textBox) => {
            return (
              <TextBoxComponent
                key={textBox.id}
                textBox={textBox}
                isSelected={selectedTextBoxId === textBox.id}
                isDrawingArrow={isDrawingArrow}
                isSearchActive={searchQuery.length > 0}
                isSearchMatched={searchMatchedIds.has(textBox.id)}
                onClick={() => {
                  setSelectedTextBoxId(textBox.id)
                  // Clear note selection when selecting a text box
                  clearSelection()
                }}
                onDragMove={(x, y) => {
                  // Update local state for smooth dragging
                  setTextBoxes(prev =>
                    prev.map(tb => tb.id === textBox.id ? { ...tb, x, y } : tb)
                  )
                }}
                onDragEnd={(x, y) => handleTextBoxDragEnd(textBox.id, x, y)}
                onDoubleClick={() => handleEditTextBox(textBox.id)}
                onConnectionDrop={() => handleConnectionDropTextBox(textBox.id)}
                onContextMenu={(e) => {
                  e.evt.preventDefault()
                  const stage = e.target.getStage()
                  if (stage) {
                    const rect = stage.container().getBoundingClientRect()
                    setContextMenu({
                      x: rect.left + e.evt.clientX,
                      y: rect.top + e.evt.clientY,
                      noteId: `textbox-${textBox.id}`,
                    })
                  }
                }}
              />
            )
          })}

          {/* Render PDF cards (after text boxes, before highlight cards) */}
          {pdfCards.map((pdfCard) => {
            const isSelected = selectedNoteId === pdfCard.id || selectedNoteIds.has(pdfCard.id)
            const searchOpacity = searchQuery.length > 0 && !searchMatchedIds.has(pdfCard.id) ? 0.25 : 1

            return (
              <Group
                key={pdfCard.id}
                opacity={searchOpacity}
                onMouseUp={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(pdfCard.id)
                  }
                }}
                onTouchEnd={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(pdfCard.id)
                  }
                }}
              >
                <PdfCardComponent
                  pdfCard={pdfCard}
                  isSelected={isSelected}
                  isDrawingArrow={isDrawingArrow}
                  onClick={(e) => {
                    // Clear text box selection when selecting a PDF card
                    setSelectedTextBoxId(null)
                    setSelectedPdfId(null)

                    // Handle right-clicks specially for multi-selection
                    if (e.evt && e.evt.button === 2) {
                      // If right-clicking on a card that's part of multi-selection, preserve the selection
                      // Otherwise, clear selection and select only this card
                      if (!selectedNoteIds.has(pdfCard.id)) {
                        setSelectedNoteIds(new Set([pdfCard.id]))
                        setSelectedNoteId(pdfCard.id)
                      }
                      return
                    }

                    // Check if Ctrl or Cmd key is pressed
                    if (e.evt && (e.evt.ctrlKey || e.evt.metaKey)) {
                      // Toggle selection
                      toggleNoteSelection(pdfCard.id)
                    } else {
                      // Regular selection - clear multi-select and select this card
                      setSelectedNoteIds(new Set([pdfCard.id]))
                      setSelectedNoteId(pdfCard.id)
                    }
                  }}
                  onDragMove={(x, y) => {
                    setPdfCards(prev =>
                      prev.map(pc => pc.id === pdfCard.id ? { ...pc, x, y } : pc)
                    )
                  }}
                  onDragEnd={(x, y) => {
                    useVaultStore.getState().updatePdfCard(pdfCard.id, { x, y, modifiedAt: new Date() })
                  }}
                  onDoubleClick={() => {
                    setPdfReaderCardId(pdfCard.id)
                  }}
                  onContextMenu={(e) => {
                    e.evt.preventDefault()
                    const stage = e.target.getStage()
                    if (stage) {
                      const rect = stage.container().getBoundingClientRect()
                      setContextMenu({
                        x: rect.left + e.evt.clientX,
                        y: rect.top + e.evt.clientY,
                        noteId: `pdf-${pdfCard.id}`,
                      })
                    }
                  }}
                />
              </Group>
            )
          })}

          {/* Render highlight cards (after PDF cards, before note cards) */}
          {highlightCards.map((highlightCard) => {
            const isSelected = selectedNoteId === highlightCard.id || selectedNoteIds.has(highlightCard.id)
            const searchOpacity = searchQuery.length > 0 && !searchMatchedIds.has(highlightCard.id) ? 0.25 : 1

            return (
              <Group
                key={highlightCard.id}
                opacity={searchOpacity}
                onMouseUp={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(highlightCard.id)
                  }
                }}
                onTouchEnd={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(highlightCard.id)
                  }
                }}
              >
                <HighlightCardComponent
                  highlightCard={highlightCard}
                  isSelected={isSelected}
                  isDrawingArrow={isDrawingArrow}
                  onClick={(e) => {
                    // Clear other selections when selecting a highlight card
                    setSelectedTextBoxId(null)
                    setSelectedPdfId(null)

                    // Handle right-clicks specially for multi-selection
                    if (e.evt && e.evt.button === 2) {
                      if (!selectedNoteIds.has(highlightCard.id)) {
                        setSelectedNoteIds(new Set([highlightCard.id]))
                        setSelectedNoteId(highlightCard.id)
                      }
                      return
                    }

                    // Check if Ctrl or Cmd key is pressed
                    if (e.evt && (e.evt.ctrlKey || e.evt.metaKey)) {
                      toggleNoteSelection(highlightCard.id)
                    } else {
                      setSelectedNoteIds(new Set([highlightCard.id]))
                      setSelectedNoteId(highlightCard.id)
                    }
                  }}
                  onDragMove={(x, y) => {
                    setHighlightCards(prev =>
                      prev.map(hc => hc.id === highlightCard.id ? { ...hc, x, y } : hc)
                    )
                  }}
                  onDragEnd={(x, y) => {
                    useVaultStore.getState().updateHighlightCard(highlightCard.id, { x, y, modifiedAt: new Date() })
                  }}
                  onContextMenu={(e) => {
                    e.evt.preventDefault()
                    const stage = e.target.getStage()
                    if (stage) {
                      const rect = stage.container().getBoundingClientRect()
                      setContextMenu({
                        x: rect.left + e.evt.clientX,
                        y: rect.top + e.evt.clientY,
                        noteId: `highlight-${highlightCard.id}`,
                      })
                    }
                  }}
                  onGoToSource={() => {
                    // Find the source PDF card
                    const sourcePdfCard = pdfCards.find(pc => pc.id === highlightCard.sourcePdfCardId)
                    if (sourcePdfCard) {
                      // Set navigation target to go to the highlight location
                      setPdfNavigationTarget({
                        page: highlightCard.pageNumber,
                        scrollPosition: highlightCard.scrollPosition,
                      })
                      // Open the PDF reader
                      setPdfReaderCardId(sourcePdfCard.id)
                    }
                  }}
                  onDoubleClick={() => {
                    setHighlightTextModal(highlightCard)
                  }}
                />
              </Group>
            )
          })}

          {/* Render note cards */}
          {Array.from(notes.values()).map((note) => {
            const basePosition = cardPositions.get(note.id)
            if (!basePosition) return null

            // Use drag position if available for real-time updates during drag
            const position = dragPositions.get(note.id) || basePosition

            const isSelected = selectedNoteId === note.id || selectedNoteIds.has(note.id)

            return (
              <Group
                key={note.id}
                onMouseUp={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(note.id)
                  }
                }}
                onTouchEnd={() => {
                  if (isDrawingArrow) {
                    handleConnectionDrop(note.id)
                  }
                }}
              >
                <NoteCard
                  note={note}
                  position={position}
                  isSelected={isSelected}
                  isSearchActive={searchQuery.length > 0}
                  isSearchMatched={searchMatchedIds.has(note.id)}
                  onSelect={(e) => {
                    // Clear text box selection when selecting a note card
                    setSelectedTextBoxId(null)

                    // Handle right-clicks specially for multi-selection
                    if (e.evt && e.evt.button === 2) {
                      // If right-clicking on a card that's part of multi-selection, preserve the selection
                      // Otherwise, clear selection and select only this card
                      if (!selectedNoteIds.has(note.id)) {
                        setSelectedNoteIds(new Set([note.id]))
                        setSelectedNoteId(note.id)
                      }
                      return
                    }

                    // Check if Ctrl or Cmd key is pressed
                    if (e.evt && (e.evt.ctrlKey || e.evt.metaKey)) {
                      // Toggle selection
                      toggleNoteSelection(note.id)
                    } else {
                      // Regular selection - clear multi-select and select this card
                      setSelectedNoteIds(new Set([note.id]))
                      setSelectedNoteId(note.id)
                    }
                  }}
                  onDragStart={() => handleCardDragStart(note.id)}
                  onDragMove={(x, y) => handleCardDragMove(note.id, x, y)}
                  onDragEnd={(x, y) => handleCardDragEnd(note.id, x, y)}
                  onResize={(width, height) => handleCardResize(note.id, width, height)}
                  onDoubleClick={() => setEditingNoteId(note.id)}
                  onContextMenu={(e) => handleCardContextMenu(e, note.id)}
                />
              </Group>
            )
          })}

          {/* Render selection box */}
          {selectionBox && selectionBox.width > 0 && selectionBox.height > 0 && (
            <Rect
              x={selectionBox.x}
              y={selectionBox.y}
              width={selectionBox.width}
              height={selectionBox.height}
              fill="rgba(102, 126, 234, 0.1)"
              stroke="rgba(102, 126, 234, 0.5)"
              strokeWidth={2 / scale}
              dash={[10 / scale, 5 / scale]}
            />
          )}

          {/* Render alignment guides */}
          {alignmentGuides.map((guide, index) => {
            if (guide.type === 'vertical') {
              return (
                <Line
                  key={`guide-${index}`}
                  points={[guide.position, guide.from, guide.position, guide.to]}
                  stroke="rgba(102, 126, 234, 0.6)"
                  strokeWidth={1.5 / scale}
                  dash={[6 / scale, 4 / scale]}
                  listening={false}
                />
              )
            } else {
              return (
                <Line
                  key={`guide-${index}`}
                  points={[guide.from, guide.position, guide.to, guide.position]}
                  stroke="rgba(102, 126, 234, 0.6)"
                  strokeWidth={1.5 / scale}
                  dash={[6 / scale, 4 / scale]}
                  listening={false}
                />
              )
            }
          })}

          {/* Render modern connection points for selected card */}
          {selectedNoteId && !isDrawingArrow && (
            (() => {
              const position = cardPositions.get(selectedNoteId)
              if (!position) return null

              const connectionPoints = [
                { side: 'top' as const, x: position.x + position.width / 2, y: position.y },
                { side: 'right' as const, x: position.x + position.width, y: position.y + position.height / 2 },
                { side: 'bottom' as const, x: position.x + position.width / 2, y: position.y + position.height },
                { side: 'left' as const, x: position.x, y: position.y + position.height / 2 }
              ]

              return (
                <Group>
                  {connectionPoints.map(({ side, x, y }) => (
                    <ConnectionPoint
                      key={side}
                      x={x}
                      y={y}
                      side={side}
                      visible={true}
                      onMouseDown={(e) => handleConnectionPointMouseDown(selectedNoteId, side, e)}
                    />
                  ))}
                </Group>
              )
            })()
          )}

          {/* Render modern connection points for selected text box */}
          {selectedTextBoxId && !isDrawingArrow && (
            (() => {
              const textBox = textBoxes.find(tb => tb.id === selectedTextBoxId)
              if (!textBox) return null

              const connectionPoints = [
                { side: 'top' as const, x: textBox.x + textBox.width / 2, y: textBox.y },
                { side: 'right' as const, x: textBox.x + textBox.width, y: textBox.y + textBox.height / 2 },
                { side: 'bottom' as const, x: textBox.x + textBox.width / 2, y: textBox.y + textBox.height },
                { side: 'left' as const, x: textBox.x, y: textBox.y + textBox.height / 2 }
              ]

              return (
                <Group>
                  {connectionPoints.map(({ side, x, y }) => (
                    <ConnectionPoint
                      key={side}
                      x={x}
                      y={y}
                      side={side}
                      visible={true}
                      onMouseDown={(e) => handleConnectionPointMouseDownTextBox(selectedTextBoxId, side, e)}
                    />
                  ))}
                </Group>
              )
            })()
          )}

          {/* Render modern connection points for selected PDF card */}
          {selectedNoteId && !isDrawingArrow && (
            (() => {
              const pdfCard = pdfCards.find(pc => pc.id === selectedNoteId)
              if (!pdfCard) return null

              const connectionPoints = [
                { side: 'top' as const, x: pdfCard.x + pdfCard.width / 2, y: pdfCard.y },
                { side: 'right' as const, x: pdfCard.x + pdfCard.width, y: pdfCard.y + pdfCard.height / 2 },
                { side: 'bottom' as const, x: pdfCard.x + pdfCard.width / 2, y: pdfCard.y + pdfCard.height },
                { side: 'left' as const, x: pdfCard.x, y: pdfCard.y + pdfCard.height / 2 }
              ]

              return (
                <Group>
                  {connectionPoints.map(({ side, x, y }) => (
                    <ConnectionPoint
                      key={side}
                      x={x}
                      y={y}
                      side={side}
                      visible={true}
                      onMouseDown={(e) => handleConnectionPointMouseDownPdf(selectedNoteId, side, e)}
                    />
                  ))}
                </Group>
              )
            })()
          )}

          {/* Render modern connection points for selected highlight card */}
          {selectedNoteId && !isDrawingArrow && (
            (() => {
              const highlightCard = highlightCards.find(hc => hc.id === selectedNoteId)
              if (!highlightCard) return null

              const connectionPoints = [
                { side: 'top' as const, x: highlightCard.x + highlightCard.width / 2, y: highlightCard.y },
                { side: 'right' as const, x: highlightCard.x + highlightCard.width, y: highlightCard.y + highlightCard.height / 2 },
                { side: 'bottom' as const, x: highlightCard.x + highlightCard.width / 2, y: highlightCard.y + highlightCard.height },
                { side: 'left' as const, x: highlightCard.x, y: highlightCard.y + highlightCard.height / 2 }
              ]

              return (
                <Group>
                  {connectionPoints.map(({ side, x, y }) => (
                    <ConnectionPoint
                      key={side}
                      x={x}
                      y={y}
                      side={side}
                      visible={true}
                      onMouseDown={(e) => handleConnectionPointMouseDownHighlight(selectedNoteId, side, e)}
                    />
                  ))}
                </Group>
              )
            })()
          )}

          {/* Render drawing arrow preview with modern styling */}
          {isDrawingArrow && drawingArrow && (
            <Group>
              {/* Glow layer behind preview */}
              <Line
                points={[
                  drawingArrow.sourcePoint.x,
                  drawingArrow.sourcePoint.y,
                  drawingArrow.currentPoint.x,
                  drawingArrow.currentPoint.y
                ]}
                stroke={ArrowStylePresets.preview.strokeColor}
                strokeWidth={ArrowStylePresets.preview.strokeWidth + 4}
                opacity={0.2}
                lineCap="round"
                shadowBlur={10}
                shadowColor={ArrowStylePresets.preview.strokeColor}
              />
              {/* Main preview line */}
              <Line
                points={[
                  drawingArrow.sourcePoint.x,
                  drawingArrow.sourcePoint.y,
                  drawingArrow.currentPoint.x,
                  drawingArrow.currentPoint.y
                ]}
                stroke={ArrowStylePresets.preview.strokeColor}
                strokeWidth={ArrowStylePresets.preview.strokeWidth}
                opacity={ArrowStylePresets.preview.opacity}
                dash={ArrowStylePresets.preview.dashPattern}
                lineCap="round"
              />
              {/* Outer pulse ring at cursor */}
              <Circle
                x={drawingArrow.currentPoint.x}
                y={drawingArrow.currentPoint.y}
                radius={10}
                fill={ArrowStylePresets.preview.strokeColor}
                opacity={0.2}
              />
              {/* Mid pulse ring */}
              <Circle
                x={drawingArrow.currentPoint.x}
                y={drawingArrow.currentPoint.y}
                radius={6}
                fill={ArrowStylePresets.preview.strokeColor}
                opacity={0.4}
                shadowBlur={8}
                shadowColor={ArrowStylePresets.preview.strokeColor}
              />
              {/* Center dot */}
              <Circle
                x={drawingArrow.currentPoint.x}
                y={drawingArrow.currentPoint.y}
                radius={3}
                fill="white"
                opacity={0.9}
              />
              <Circle
                x={drawingArrow.currentPoint.x}
                y={drawingArrow.currentPoint.y}
                radius={2}
                fill={ArrowStylePresets.preview.strokeColor}
                opacity={1}
              />
            </Group>
          )}
        </Layer>
      </Stage>
      {editingTextBoxId && (() => {
        const textBox = textBoxes.find(tb => tb.id === editingTextBoxId)
        if (!textBox) return null

        // Calculate screen position of text box
        const screenX = textBox.x * scale + position.x
        const screenY = textBox.y * scale + position.y
        const screenWidth = textBox.width * scale
        const screenHeight = textBox.height * scale

        return (
          <input
            type="text"
            autoFocus
            defaultValue={textBox.text}
            onChange={(e) => {
              // Update width in real-time while typing
              const newText = e.target.value.replace(/\n/g, ' ') // Remove any newlines
              const newWidth = calculateTextBoxWidth(newText)
              updateTextBox(editingTextBoxId, {
                text: newText,
                width: newWidth,
                modifiedAt: new Date()
              })
            }}
            onBlur={(e) => {
              const newText = e.target.value.replace(/\n/g, ' ') // Remove any newlines
              const newWidth = calculateTextBoxWidth(newText)
              updateTextBox(editingTextBoxId, {
                text: newText,
                width: newWidth,
                modifiedAt: new Date()
              })
              setEditingTextBoxId(null)
              saveTextBoxesToBackend()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                const newText = e.currentTarget.value.replace(/\n/g, ' ') // Remove any newlines
                const newWidth = calculateTextBoxWidth(newText)
                updateTextBox(editingTextBoxId, {
                  text: newText,
                  width: newWidth,
                  modifiedAt: new Date()
                })
                setEditingTextBoxId(null)
                saveTextBoxesToBackend()
              }
            }}
            style={{
              position: 'absolute',
              left: `${screenX}px`,
              top: `${screenY}px`,
              width: `${screenWidth}px`,
              height: `${screenHeight}px`,
              padding: '8px',
              fontSize: `${14 * scale}px`,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              border: '2px solid #8b5cf6',
              borderRadius: '4px',
              outline: 'none',
              zIndex: 1000,
              backgroundColor: 'white',
              textAlign: 'center',
            }}
          />
        )
      })()}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {renameModal && (
        <RenameModal
          currentName={renameModal.currentName}
          onRename={performRename}
          onClose={() => setRenameModal(null)}
        />
      )}
      {groupNameModal && (
        <GroupNameModal
          currentName={groupNameModal.currentName}
          title={groupNameModal.type === 'create' ? 'Create Group' : 'Rename Group'}
          onSubmit={(name) => {
            if (groupNameModal.type === 'create') {
              performCreateGroup(name)
            } else if (groupNameModal.groupId) {
              performEditGroupName(groupNameModal.groupId, name)
            }
          }}
          onClose={() => setGroupNameModal(null)}
        />
      )}
      {colorPickerModal && (
        <ColorPickerModal
          currentColor={colorPickerModal.currentColor}
          onSelectColor={(color) => performChangeGroupColor(colorPickerModal.groupId, color)}
          onClose={() => setColorPickerModal(null)}
        />
      )}
      {stickyNoteEditorModal && (
        <StickyNoteEditorModal
          currentText={stickyNoteEditorModal.currentText}
          onSubmit={(text) => {
            performEditStickyNote(stickyNoteEditorModal.stickyNoteId, text)
          }}
          onClose={() => setStickyNoteEditorModal(null)}
        />
      )}
      {stickyNoteColorPickerModal && (
        <ColorPickerModal
          currentColor={stickyNoteColorPickerModal.currentColor}
          onSelectColor={(color) => performChangeStickyNoteColor(stickyNoteColorPickerModal.stickyNoteId, color)}
          onClose={() => setStickyNoteColorPickerModal(null)}
        />
      )}
      {/* PDF Reader Modal */}
      {pdfReaderCardId && (() => {
        const pdfCard = pdfCards.find(pc => pc.id === pdfReaderCardId)
        if (!pdfCard) return null
        return (
          <PdfReaderModal
            pdfCard={pdfCard}
            navigationTarget={pdfNavigationTarget || undefined}
            onClose={async () => {
              setPdfReaderCardId(null)
              setPdfNavigationTarget(null) // Clear navigation target
              // Save metadata to persist last read position
              try {
                const { whiteboards: currentWhiteboards, activeWhiteboardId: currentActiveWhiteboardId } = useVaultStore.getState()
                await window.electronAPI.saveMetadata({
                  version: '2.0',
                  whiteboards: currentWhiteboards,
                  activeWhiteboardId: currentActiveWhiteboardId,
                })
              } catch (error) {
                console.error('Error saving PDF reading position:', error)
              }
            }}
            onUpdateReadingPosition={(page, scrollPosition) => {
              useVaultStore.getState().updatePdfCard(pdfCard.id, {
                lastReadPage: page,
                lastScrollPosition: scrollPosition,
                lastReadAt: new Date(),
                modifiedAt: new Date(),
              })
            }}
          />
        )
      })()}

      {/* Highlight Text Modal */}
      {highlightTextModal && (
        <HighlightTextModal
          text={highlightTextModal.highlightedText}
          color={highlightTextModal.color}
          pageNumber={highlightTextModal.pageNumber}
          onClose={() => setHighlightTextModal(null)}
        />
      )}

      {/* Toggle button for hiding auto-generated arrows */}
      <button
        onClick={() => setHideAutoArrows(!hideAutoArrows)}
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          padding: '10px',
          backgroundColor: hideAutoArrows ? '#8b5cf6' : 'white',
          color: hideAutoArrows ? 'white' : '#374151',
          border: '2px solid #8b5cf6',
          borderRadius: '8px',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={hideAutoArrows ? 'Show auto-generated connections' : 'Hide auto-generated connections'}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {hideAutoArrows ? (
            <>
              <path d="M1 1l14 14M1 8h6M9 8h6M5 4l-3 4 3 4M11 4l3 4-3 4" />
            </>
          ) : (
            <>
              <path d="M1 8h14M5 4l-4 4 4 4M15 4l-4 4 4 4" />
            </>
          )}
        </svg>
      </button>
    </>
  )
})

Canvas.displayName = 'Canvas'

export default Canvas
