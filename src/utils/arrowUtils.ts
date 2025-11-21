/**
 * Modern Arrow Utilities
 * Provides clean, efficient utilities for arrow rendering and calculations
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectionPoint extends Point {
  side: 'top' | 'right' | 'bottom' | 'left';
  angle: number; // Direction perpendicular to the edge (for arrow head rotation)
}

export type CurveType = 'smooth' | 'straight' | 'step';
export type ArrowHeadType = 'triangle' | 'circle' | 'diamond' | 'none';

export interface ArrowStyle {
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  curveType: CurveType;
  arrowHeadType: ArrowHeadType;
  arrowHeadSize: number;
  dashEnabled?: boolean;
  dashPattern?: number[];
  shadowEnabled?: boolean;
  shadowBlur?: number;
  shadowColor?: string;
}

/**
 * Modern arrow style presets with beautiful gradients and effects
 */
export const ArrowStylePresets = {
  manual: {
    strokeColor: '#3b82f6', // Modern blue-500 (brighter, more vibrant)
    strokeWidth: 2.5,
    opacity: 0.95,
    curveType: 'smooth' as CurveType,
    arrowHeadType: 'triangle' as ArrowHeadType,
    arrowHeadSize: 11,
    shadowEnabled: true,
    shadowBlur: 10,
    shadowColor: 'rgba(59, 130, 246, 0.25)',
  },
  auto: {
    strokeColor: '#94a3b8', // Slate-400 (softer than gray)
    strokeWidth: 2,
    opacity: 0.35,
    curveType: 'smooth' as CurveType,
    arrowHeadType: 'triangle' as ArrowHeadType,
    arrowHeadSize: 9,
    shadowEnabled: false,
  },
  selected: {
    strokeColor: '#06b6d4', // Cyan-500 (vibrant highlight color)
    strokeWidth: 3.5,
    opacity: 1,
    curveType: 'smooth' as CurveType,
    arrowHeadType: 'triangle' as ArrowHeadType,
    arrowHeadSize: 13,
    shadowEnabled: true,
    shadowBlur: 16,
    shadowColor: 'rgba(6, 182, 212, 0.5)',
  },
  preview: {
    strokeColor: '#a855f7', // Purple-500 (distinctive preview color)
    strokeWidth: 2.5,
    opacity: 0.7,
    curveType: 'smooth' as CurveType,
    arrowHeadType: 'triangle' as ArrowHeadType,
    arrowHeadSize: 11,
    dashEnabled: true,
    dashPattern: [12, 6],
  },
};

/**
 * Calculate the center point of a rectangle
 */
export function getRectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Get the optimal connection point on a rectangle's edge based on target direction
 */
export function getOptimalConnectionPoint(
  rect: Rect,
  targetPoint: Point,
  preferredSide?: 'top' | 'right' | 'bottom' | 'left'
): ConnectionPoint {
  const center = getRectCenter(rect);

  // If a preferred side is specified, use it
  if (preferredSide) {
    return getConnectionPointOnSide(rect, preferredSide, targetPoint);
  }

  // Calculate angle from center to target
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;
  const angle = Math.atan2(dy, dx);

  // Determine which side based on angle
  // Right: -π/4 to π/4
  // Bottom: π/4 to 3π/4
  // Left: 3π/4 to -3π/4
  // Top: -3π/4 to -π/4

  let side: 'top' | 'right' | 'bottom' | 'left';

  if (angle >= -Math.PI / 4 && angle < Math.PI / 4) {
    side = 'right';
  } else if (angle >= Math.PI / 4 && angle < (3 * Math.PI) / 4) {
    side = 'bottom';
  } else if (angle >= (3 * Math.PI) / 4 || angle < -(3 * Math.PI) / 4) {
    side = 'left';
  } else {
    side = 'top';
  }

  return getConnectionPointOnSide(rect, side, targetPoint);
}

/**
 * Get a connection point on a specific side of a rectangle
 */
export function getConnectionPointOnSide(
  rect: Rect,
  side: 'top' | 'right' | 'bottom' | 'left',
  targetPoint?: Point
): ConnectionPoint {
  let x: number, y: number, angle: number;

  switch (side) {
    case 'top':
      y = rect.y;
      // If target point provided, align x position
      if (targetPoint) {
        x = Math.max(rect.x, Math.min(rect.x + rect.width, targetPoint.x));
      } else {
        x = rect.x + rect.width / 2;
      }
      angle = -Math.PI / 2; // Point up
      break;
    case 'right':
      x = rect.x + rect.width;
      if (targetPoint) {
        y = Math.max(rect.y, Math.min(rect.y + rect.height, targetPoint.y));
      } else {
        y = rect.y + rect.height / 2;
      }
      angle = 0; // Point right
      break;
    case 'bottom':
      y = rect.y + rect.height;
      if (targetPoint) {
        x = Math.max(rect.x, Math.min(rect.x + rect.width, targetPoint.x));
      } else {
        x = rect.x + rect.width / 2;
      }
      angle = Math.PI / 2; // Point down
      break;
    case 'left':
      x = rect.x;
      if (targetPoint) {
        y = Math.max(rect.y, Math.min(rect.y + rect.height, targetPoint.y));
      } else {
        y = rect.y + rect.height / 2;
      }
      angle = Math.PI; // Point left
      break;
  }

  return { x, y, side, angle };
}

/**
 * Calculate smooth bezier curve points between two connection points
 */
export function calculateSmoothCurve(
  start: ConnectionPoint,
  end: ConnectionPoint,
  curvature: number = 0.3
): number[] {
  // Calculate control points based on connection angles
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Control point distance is proportional to the distance between points
  const controlDist = dist * curvature;

  // First control point: extend from start point in its perpendicular direction
  const cp1x = start.x + Math.cos(start.angle) * controlDist;
  const cp1y = start.y + Math.sin(start.angle) * controlDist;

  // Second control point: extend from end point in opposite of its perpendicular direction
  const cp2x = end.x - Math.cos(end.angle) * controlDist;
  const cp2y = end.y - Math.sin(end.angle) * controlDist;

  // Return points in format for Konva Line with bezier: [x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2]
  return [start.x, start.y, cp1x, cp1y, cp2x, cp2y, end.x, end.y];
}

/**
 * Calculate straight line between two points
 */
export function calculateStraightLine(start: Point, end: Point): number[] {
  return [start.x, start.y, end.x, end.y];
}

/**
 * Calculate step/right-angled path between two points
 */
export function calculateStepPath(
  start: ConnectionPoint,
  end: ConnectionPoint
): number[] {
  const points: number[] = [start.x, start.y];

  // Determine step based on the sides
  if (
    (start.side === 'right' && end.side === 'left') ||
    (start.side === 'left' && end.side === 'right')
  ) {
    // Horizontal step
    const midX = (start.x + end.x) / 2;
    points.push(midX, start.y);
    points.push(midX, end.y);
  } else if (
    (start.side === 'top' && end.side === 'bottom') ||
    (start.side === 'bottom' && end.side === 'top')
  ) {
    // Vertical step
    const midY = (start.y + end.y) / 2;
    points.push(start.x, midY);
    points.push(end.x, midY);
  } else {
    // Mixed - create L shape
    if (start.side === 'right' || start.side === 'left') {
      points.push(end.x, start.y);
    } else {
      points.push(start.x, end.y);
    }
  }

  points.push(end.x, end.y);
  return points;
}

/**
 * Calculate the angle and position for arrow head based on curve end
 */
export function calculateArrowHead(
  points: number[],
  size: number,
  type: ArrowHeadType
): { points: number[]; rotation: number; position: Point } | null {
  if (type === 'none' || points.length < 4) return null;

  // Get the last two points to determine angle
  const len = points.length;
  const x2 = points[len - 2];
  const y2 = points[len - 1];
  const x1 = points[len - 4];
  const y1 = points[len - 3];

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const rotation = (angle * 180) / Math.PI;

  let arrowPoints: number[];

  switch (type) {
    case 'triangle':
      arrowPoints = [
        0, 0,
        -size, -size / 2,
        -size, size / 2,
      ];
      break;
    case 'circle':
      // Will be rendered as a circle, just return position
      arrowPoints = [];
      break;
    case 'diamond':
      arrowPoints = [
        0, 0,
        -size, -size / 2,
        -size * 1.5, 0,
        -size, size / 2,
      ];
      break;
    default:
      return null;
  }

  return {
    points: arrowPoints,
    rotation,
    position: { x: x2, y: y2 },
  };
}

/**
 * Check if a point is near a curve (for click detection)
 */
export function isPointNearCurve(
  point: Point,
  curvePoints: number[],
  threshold: number = 10
): boolean {
  // Simple check: iterate through curve segments and check distance
  for (let i = 0; i < curvePoints.length - 2; i += 2) {
    const x1 = curvePoints[i];
    const y1 = curvePoints[i + 1];
    const x2 = curvePoints[i + 2];
    const y2 = curvePoints[i + 3];

    const dist = pointToSegmentDistance(point, { x: x1, y: y1 }, { x: x2, y: y2 });
    if (dist <= threshold) return true;
  }

  return false;
}

/**
 * Calculate distance from point to line segment
 */
function pointToSegmentDistance(p: Point, v: Point, w: Point): number {
  const l2 = distance(v, w) ** 2;
  if (l2 === 0) return distance(p, v);

  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projection = {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y),
  };

  return distance(p, projection);
}

/**
 * Interpolate between two points for animation
 */
export function interpolatePoint(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

/**
 * Easing function for smooth animations
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
