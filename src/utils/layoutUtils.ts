import type { CardPosition } from '../types'

export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  vx: number
  vy: number
}

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal'
  position: number
  from: number
  to: number
}

const SNAP_THRESHOLD = 8 // pixels
const ALIGNMENT_THRESHOLD = 5 // pixels for showing guides

/**
 * Calculate alignment guides for a dragging card
 */
export function calculateAlignmentGuides(
  draggingCard: { x: number; y: number; width: number; height: number },
  otherCards: Array<{ x: number; y: number; width: number; height: number; id: string }>,
  draggingCardIds: Set<string>
): { guides: AlignmentGuide[]; snappedX: number; snappedY: number } {
  const guides: AlignmentGuide[] = []
  let snappedX = draggingCard.x
  let snappedY = draggingCard.y

  // Calculate key points for the dragging card
  const dragLeft = draggingCard.x
  const dragRight = draggingCard.x + draggingCard.width
  const dragCenterX = draggingCard.x + draggingCard.width / 2
  const dragTop = draggingCard.y
  const dragBottom = draggingCard.y + draggingCard.height
  const dragCenterY = draggingCard.y + draggingCard.height / 2

  let closestVerticalDist = Infinity
  let closestHorizontalDist = Infinity
  let verticalSnapDelta = 0
  let horizontalSnapDelta = 0

  // Check alignment with other cards (excluding dragged cards)
  otherCards.forEach((card) => {
    // Skip if this card is being dragged
    if (draggingCardIds.has(card.id)) return

    const cardLeft = card.x
    const cardRight = card.x + card.width
    const cardCenterX = card.x + card.width / 2
    const cardTop = card.y
    const cardBottom = card.y + card.height
    const cardCenterY = card.y + card.height / 2

    // Check vertical alignments (left, center, right)
    const verticalAlignments = [
      { dragPos: dragLeft, cardPos: cardLeft, label: 'left' },
      { dragPos: dragCenterX, cardPos: cardCenterX, label: 'center' },
      { dragPos: dragRight, cardPos: cardRight, label: 'right' },
    ]

    verticalAlignments.forEach(({ dragPos, cardPos }) => {
      const dist = Math.abs(dragPos - cardPos)
      if (dist < ALIGNMENT_THRESHOLD && dist < closestVerticalDist) {
        closestVerticalDist = dist
        verticalSnapDelta = cardPos - dragPos
      }
    })

    // Check horizontal alignments (top, middle, bottom)
    const horizontalAlignments = [
      { dragPos: dragTop, cardPos: cardTop, label: 'top' },
      { dragPos: dragCenterY, cardPos: cardCenterY, label: 'middle' },
      { dragPos: dragBottom, cardPos: cardBottom, label: 'bottom' },
    ]

    horizontalAlignments.forEach(({ dragPos, cardPos }) => {
      const dist = Math.abs(dragPos - cardPos)
      if (dist < ALIGNMENT_THRESHOLD && dist < closestHorizontalDist) {
        closestHorizontalDist = dist
        horizontalSnapDelta = cardPos - dragPos
      }
    })
  })

  // Apply snapping
  if (closestVerticalDist < SNAP_THRESHOLD) {
    snappedX = draggingCard.x + verticalSnapDelta
  }
  if (closestHorizontalDist < SNAP_THRESHOLD) {
    snappedY = draggingCard.y + horizontalSnapDelta
  }

  // Create guide lines for aligned positions
  if (closestVerticalDist < ALIGNMENT_THRESHOLD) {
    const guidePosX = snappedX + (closestVerticalDist < SNAP_THRESHOLD ? verticalSnapDelta : 0)

    // Determine if it's left, center, or right alignment
    let guideX = guidePosX
    if (Math.abs((snappedX + draggingCard.width / 2) - (guidePosX + draggingCard.width / 2)) < 1) {
      guideX = snappedX + draggingCard.width / 2
    } else if (Math.abs((snappedX + draggingCard.width) - (guidePosX + draggingCard.width)) < 1) {
      guideX = snappedX + draggingCard.width
    }

    guides.push({
      type: 'vertical',
      position: guideX,
      from: Math.min(draggingCard.y, ...otherCards.map(c => c.y)),
      to: Math.max(draggingCard.y + draggingCard.height, ...otherCards.map(c => c.y + c.height)),
    })
  }

  if (closestHorizontalDist < ALIGNMENT_THRESHOLD) {
    const guidePosY = snappedY + (closestHorizontalDist < SNAP_THRESHOLD ? horizontalSnapDelta : 0)

    let guideY = guidePosY
    if (Math.abs((snappedY + draggingCard.height / 2) - (guidePosY + draggingCard.height / 2)) < 1) {
      guideY = snappedY + draggingCard.height / 2
    } else if (Math.abs((snappedY + draggingCard.height) - (guidePosY + draggingCard.height)) < 1) {
      guideY = snappedY + draggingCard.height
    }

    guides.push({
      type: 'horizontal',
      position: guideY,
      from: Math.min(draggingCard.x, ...otherCards.map(c => c.x)),
      to: Math.max(draggingCard.x + draggingCard.width, ...otherCards.map(c => c.x + c.width)),
    })
  }

  return { guides, snappedX, snappedY }
}

/**
 * Force-directed layout algorithm for auto-organizing cards
 */
export function calculateForceDirectedLayout(
  cardPositions: Map<string, CardPosition>,
  iterations: number = 100
): Map<string, { x: number; y: number }> {
  // Convert to nodes
  const nodes: LayoutNode[] = Array.from(cardPositions.values()).map(card => ({
    id: card.id,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    vx: 0,
    vy: 0,
  }))

  if (nodes.length === 0) return new Map()

  // Calculate center of mass
  const centerX = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length
  const centerY = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length

  // Force parameters
  const REPULSION_STRENGTH = 50000
  const ATTRACTION_TO_CENTER = 0.01
  const DAMPING = 0.8
  const MIN_DISTANCE = 50
  const SPACING_MARGIN = 40

  // Run simulation
  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations // Cooling factor

    // Reset forces
    nodes.forEach(node => {
      node.vx *= DAMPING
      node.vy *= DAMPING
    })

    // Apply repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i]
        const node2 = nodes[j]

        const dx = node2.x - node1.x
        const dy = node2.y - node1.y
        const distance = Math.sqrt(dx * dx + dy * dy) || 1

        // Calculate ideal distance based on card sizes
        const idealDist = Math.max(
          (node1.width + node2.width) / 2 + SPACING_MARGIN,
          (node1.height + node2.height) / 2 + SPACING_MARGIN,
          MIN_DISTANCE
        )

        if (distance < idealDist * 3) {
          // Repulsion force
          const force = (REPULSION_STRENGTH * alpha) / (distance * distance)
          const fx = (dx / distance) * force
          const fy = (dy / distance) * force

          node1.vx -= fx
          node1.vy -= fy
          node2.vx += fx
          node2.vy += fy
        }
      }
    }

    // Apply gentle attraction to center
    nodes.forEach(node => {
      const dx = centerX - node.x
      const dy = centerY - node.y

      node.vx += dx * ATTRACTION_TO_CENTER * alpha
      node.vy += dy * ATTRACTION_TO_CENTER * alpha
    })

    // Update positions
    nodes.forEach(node => {
      node.x += node.vx
      node.y += node.vy
    })
  }

  // Align to grid (24px) for cleaner appearance
  nodes.forEach(node => {
    node.x = Math.round(node.x / 24) * 24
    node.y = Math.round(node.y / 24) * 24
  })

  // Ensure all cards are in positive coordinates with margin
  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  const offsetX = minX < 100 ? 100 - minX : 0
  const offsetY = minY < 100 ? 100 - minY : 0

  // Create result map
  const result = new Map<string, { x: number; y: number }>()
  nodes.forEach(node => {
    result.set(node.id, {
      x: node.x + offsetX,
      y: node.y + offsetY,
    })
  })

  return result
}
