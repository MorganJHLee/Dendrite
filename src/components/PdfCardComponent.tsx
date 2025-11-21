import { useRef, useState, useEffect } from 'react'
import { Group, Rect, Text, Image as KonvaImage } from 'react-konva'
import type { PdfCard } from '../types'
import { loadPdfThumbnail } from '../services/pdfService'

interface PdfCardComponentProps {
  pdfCard: PdfCard
  isSelected?: boolean
  isDrawingArrow?: boolean
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onClick: (e: any) => void
  onDoubleClick?: () => void
  onContextMenu: (e: any) => void
}

export function PdfCardComponent({
  pdfCard,
  isSelected,
  isDrawingArrow,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
  onDoubleClick,
  onContextMenu,
}: PdfCardComponentProps) {
  const cardRef = useRef<any>(null)
  const [thumbnail, setThumbnail] = useState<HTMLImageElement | null>(null)

  // Load thumbnail
  useEffect(() => {
    const loadThumbnail = async () => {
      try {
        const thumbnailDataUrl = await loadPdfThumbnail(pdfCard.thumbnailPath)
        const img = new window.Image()
        img.src = thumbnailDataUrl
        img.onload = () => {
          setThumbnail(img)
        }
      } catch (error) {
        console.error('Error loading PDF thumbnail:', error)
      }
    }

    if (pdfCard.thumbnailPath) {
      loadThumbnail()
    }
  }, [pdfCard.thumbnailPath])

  return (
    <Group
      ref={cardRef}
      x={pdfCard.x}
      y={pdfCard.y}
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
    >
      {/* Card background */}
      <Rect
        x={0}
        y={0}
        width={pdfCard.width}
        height={pdfCard.height}
        fill="#ffffff"
        stroke={isSelected ? '#3b82f6' : '#e5e7eb'}
        strokeWidth={isSelected ? 2 : 1}
        cornerRadius={4}
        shadowColor="rgba(0, 0, 0, 0.1)"
        shadowBlur={4}
        shadowOpacity={0.5}
        shadowOffsetX={0}
        shadowOffsetY={2}
      />

      {/* Thumbnail image */}
      {thumbnail && (
        <KonvaImage
          x={8}
          y={8}
          width={pdfCard.width - 16}
          height={pdfCard.height - 80}
          image={thumbnail}
        />
      )}

      {/* Title background */}
      <Rect
        x={0}
        y={pdfCard.height - 72}
        width={pdfCard.width}
        height={72}
        fill="#f9fafb"
        cornerRadius={[0, 0, 4, 4]}
      />

      {/* Title text */}
      <Text
        x={12}
        y={pdfCard.height - 60}
        width={pdfCard.width - 24}
        text={pdfCard.title}
        fontSize={14}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontStyle="bold"
        fill="#1f2937"
        ellipsis={true}
        wrap="none"
      />

      {/* Page count and file size */}
      <Text
        x={12}
        y={pdfCard.height - 38}
        width={pdfCard.width - 24}
        text={`${pdfCard.pageCount} pages • ${formatFileSize(pdfCard.fileSize)}`}
        fontSize={12}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#6b7280"
        ellipsis={true}
        wrap="none"
      />

      {/* File name */}
      <Text
        x={12}
        y={pdfCard.height - 20}
        width={pdfCard.width - 24}
        text={pdfCard.fileName}
        fontSize={10}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill="#9ca3af"
        ellipsis={true}
        wrap="none"
      />
    </Group>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
