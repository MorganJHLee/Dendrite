import { useRef, useState } from 'react'
import { Group, Rect, Text } from 'react-konva'
import type { HighlightCard } from '../types'

interface HighlightCardComponentProps {
  highlightCard: HighlightCard
  isSelected?: boolean
  isDrawingArrow?: boolean
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onClick: (e: any) => void
  onDoubleClick?: () => void
  onContextMenu: (e: any) => void
  onGoToSource?: () => void
}

export function HighlightCardComponent({
  highlightCard,
  isSelected,
  isDrawingArrow,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
  onDoubleClick,
  onContextMenu,
  onGoToSource,
}: HighlightCardComponentProps) {
  const cardRef = useRef<any>(null)
  const [isHovering, setIsHovering] = useState(false)

  // Truncate text if too long
  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  const displayText = truncateText(highlightCard.highlightedText, 200)

  return (
    <Group
      ref={cardRef}
      x={highlightCard.x}
      y={highlightCard.y}
      draggable={!isDrawingArrow}
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
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Card background with highlight color */}
      <Rect
        x={0}
        y={0}
        width={highlightCard.width}
        height={highlightCard.height}
        fill={highlightCard.color}
        stroke={isSelected ? '#3b82f6' : '#f59e0b'}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={8}
        shadowColor="rgba(0, 0, 0, 0.1)"
        shadowBlur={8}
        shadowOpacity={0.5}
        shadowOffsetX={0}
        shadowOffsetY={4}
      />

      {/* Header bar */}
      <Rect
        x={0}
        y={0}
        width={highlightCard.width}
        height={32}
        fill="#fbbf24"
        cornerRadius={[8, 8, 0, 0]}
      />

      {/* Header icon and title */}
      <Text
        x={12}
        y={10}
        text="📝 Highlight"
        fontSize={13}
        fontStyle="bold"
        fill="#78350f"
      />

      {/* Page number indicator */}
      <Text
        x={highlightCard.width - 60}
        y={10}
        text={`Page ${highlightCard.pageNumber}`}
        fontSize={11}
        fill="#78350f"
      />

      {/* Highlighted text content */}
      <Text
        x={16}
        y={48}
        width={highlightCard.width - 32}
        height={highlightCard.height - 100}
        text={displayText}
        fontSize={13}
        lineHeight={1.5}
        fill="#374151"
        wrap="word"
        ellipsis={true}
      />

      {/* Go to source button area (bottom) */}
      <Rect
        x={0}
        y={highlightCard.height - 40}
        width={highlightCard.width}
        height={40}
        fill={isHovering ? '#f59e0b' : '#fbbf24'}
        cornerRadius={[0, 0, 8, 8]}
        listening={true}
        onClick={(e) => {
          e.cancelBubble = true
          onGoToSource?.()
        }}
        onTap={(e) => {
          e.cancelBubble = true
          onGoToSource?.()
        }}
      />

      {/* Go to source button text */}
      <Text
        x={highlightCard.width / 2 - 60}
        y={highlightCard.height - 28}
        text="📍 Go to Source"
        fontSize={12}
        fontStyle="bold"
        fill="#78350f"
        listening={false}
      />

      {/* Selection indicator */}
      {isSelected && (
        <Rect
          x={-4}
          y={-4}
          width={highlightCard.width + 8}
          height={highlightCard.height + 8}
          stroke="#3b82f6"
          strokeWidth={2}
          cornerRadius={10}
          listening={false}
        />
      )}
    </Group>
  )
}
