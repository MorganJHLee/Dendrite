/**
 * Pathfinding utility for arrow routing around obstacles
 * Uses A* algorithm to find optimal paths between cards
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GridNode {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic to end
  f: number; // Total cost (g + h)
  parent: GridNode | null;
}

const GRID_SIZE = 20; // Grid cell size in pixels
const OBSTACLE_PADDING = 15; // Extra padding around obstacles
const CLEARANCE_PREFERENCE = 40; // Preferred distance from obstacles for natural-looking paths

/**
 * Calculate Euclidean distance between two points
 */
function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a point is inside or near an obstacle (with padding)
 */
function isPointInObstacle(point: Point, obstacles: Rectangle[], padding: number = OBSTACLE_PADDING): boolean {
  for (const obstacle of obstacles) {
    if (
      point.x >= obstacle.x - padding &&
      point.x <= obstacle.x + obstacle.width + padding &&
      point.y >= obstacle.y - padding &&
      point.y <= obstacle.y + obstacle.height + padding
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate minimum distance from a point to any obstacle
 * Returns 0 if inside obstacle, otherwise returns closest distance to any obstacle edge
 */
function distanceToNearestObstacle(point: Point, obstacles: Rectangle[]): number {
  let minDistance = Infinity;

  for (const obstacle of obstacles) {
    // Calculate distance to closest point on the rectangle
    const closestX = Math.max(obstacle.x, Math.min(point.x, obstacle.x + obstacle.width));
    const closestY = Math.max(obstacle.y, Math.min(point.y, obstacle.y + obstacle.height));

    const dx = point.x - closestX;
    const dy = point.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    minDistance = Math.min(minDistance, dist);
  }

  return minDistance;
}

/**
 * Check if a line segment intersects any obstacles
 */
function lineIntersectsObstacles(start: Point, end: Point, obstacles: Rectangle[]): boolean {
  // Sample points along the line
  const steps = Math.ceil(distance(start, end) / (GRID_SIZE / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    };
    if (isPointInObstacle(point, obstacles)) {
      return true;
    }
  }
  return false;
}

/**
 * Get neighboring grid points for A* algorithm
 */
function getNeighbors(node: GridNode, obstacles: Rectangle[]): Point[] {
  const neighbors: Point[] = [];
  const directions = [
    { x: GRID_SIZE, y: 0 },      // Right
    { x: -GRID_SIZE, y: 0 },     // Left
    { x: 0, y: GRID_SIZE },      // Down
    { x: 0, y: -GRID_SIZE },     // Up
    { x: GRID_SIZE, y: GRID_SIZE },     // Diagonal down-right
    { x: -GRID_SIZE, y: GRID_SIZE },    // Diagonal down-left
    { x: GRID_SIZE, y: -GRID_SIZE },    // Diagonal up-right
    { x: -GRID_SIZE, y: -GRID_SIZE },   // Diagonal up-left
  ];

  for (const dir of directions) {
    const neighbor = {
      x: node.x + dir.x,
      y: node.y + dir.y,
    };

    // Check if neighbor is in an obstacle
    if (!isPointInObstacle(neighbor, obstacles)) {
      neighbors.push(neighbor);
    }
  }

  return neighbors;
}

/**
 * A* pathfinding algorithm
 */
function astar(start: Point, end: Point, obstacles: Rectangle[]): Point[] {
  // Snap points to grid
  const gridStart = {
    x: Math.round(start.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(start.y / GRID_SIZE) * GRID_SIZE,
  };
  const gridEnd = {
    x: Math.round(end.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(end.y / GRID_SIZE) * GRID_SIZE,
  };

  const openSet: GridNode[] = [];
  const closedSet = new Set<string>();
  const startNode: GridNode = {
    x: gridStart.x,
    y: gridStart.y,
    g: 0,
    h: distance(gridStart, gridEnd),
    f: distance(gridStart, gridEnd),
    parent: null,
  };

  openSet.push(startNode);

  const maxIterations = 1000; // Prevent infinite loops
  let iterations = 0;

  while (openSet.length > 0 && iterations < maxIterations) {
    iterations++;

    // Sort by f value and get the node with lowest cost
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;

    const currentKey = `${current.x},${current.y}`;

    // Check if we reached the goal
    if (Math.abs(current.x - gridEnd.x) < GRID_SIZE && Math.abs(current.y - gridEnd.y) < GRID_SIZE) {
      // Reconstruct path
      const path: Point[] = [];
      let node: GridNode | null = current;
      while (node !== null) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      // Add exact start and end points
      path[0] = start;
      path[path.length - 1] = end;
      return path;
    }

    closedSet.add(currentKey);

    // Check neighbors
    const neighbors = getNeighbors(current, obstacles);
    for (const neighborPos of neighbors) {
      const neighborKey = `${neighborPos.x},${neighborPos.y}`;

      if (closedSet.has(neighborKey)) {
        continue;
      }

      const moveCost = distance(current, neighborPos);

      // Add penalty for direction changes to encourage smooth paths
      let directionPenalty = 0;
      if (current.parent) {
        const prevDx = current.x - current.parent.x;
        const prevDy = current.y - current.parent.y;
        const currDx = neighborPos.x - current.x;
        const currDy = neighborPos.y - current.y;

        // Calculate angle change (0 = same direction, 2 = opposite direction)
        const prevLen = Math.sqrt(prevDx * prevDx + prevDy * prevDy);
        const currLen = Math.sqrt(currDx * currDx + currDy * currDy);

        if (prevLen > 0 && currLen > 0) {
          const dot = (prevDx * currDx + prevDy * currDy) / (prevLen * currLen);
          // Penalty proportional to angle change (0 for straight, higher for turns)
          directionPenalty = (1 - dot) * GRID_SIZE * 0.3;
        }
      }

      // Add penalty for being too close to obstacles (encourages natural clearance)
      let clearancePenalty = 0;
      const distToObstacle = distanceToNearestObstacle(neighborPos, obstacles);
      if (distToObstacle < CLEARANCE_PREFERENCE) {
        // Exponential penalty: closer = much higher cost
        const clearanceRatio = distToObstacle / CLEARANCE_PREFERENCE;
        clearancePenalty = (1 - clearanceRatio) * (1 - clearanceRatio) * GRID_SIZE * 0.5;
      }

      const g = current.g + moveCost + directionPenalty + clearancePenalty;
      const h = distance(neighborPos, gridEnd);
      const f = g + h;

      // Check if this neighbor is already in open set
      const existingNode = openSet.find(n => n.x === neighborPos.x && n.y === neighborPos.y);

      if (existingNode) {
        // Update if we found a better path
        if (g < existingNode.g) {
          existingNode.g = g;
          existingNode.f = f;
          existingNode.parent = current;
        }
      } else {
        // Add new node to open set
        openSet.push({
          x: neighborPos.x,
          y: neighborPos.y,
          g,
          h,
          f,
          parent: current,
        });
      }
    }
  }

  // No path found, return direct line
  return [start, end];
}

/**
 * Simplify path by removing unnecessary waypoints (Enhanced Douglas-Peucker algorithm)
 * Also detects and preserves important corners
 */
function simplifyPath(path: Point[], tolerance: number = GRID_SIZE): Point[] {
  if (path.length <= 2) {
    return path;
  }

  // First pass: detect sharp corners that must be preserved
  const isCorner: boolean[] = new Array(path.length).fill(false);
  isCorner[0] = true;
  isCorner[path.length - 1] = true;

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];

    // Calculate angle change at this point
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    const dot = v1x * v2x + v1y * v2y;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 > 0 && len2 > 0) {
      const cosAngle = dot / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

      // Mark as corner if angle change is significant (> 30 degrees)
      if (angle > Math.PI / 6) {
        isCorner[i] = true;
      }
    }
  }

  // Second pass: Douglas-Peucker with corner awareness
  function simplifySegment(start: number, end: number): number[] {
    if (end - start <= 1) {
      return [start, end];
    }

    // Find point with maximum distance from line
    let maxDistance = 0;
    let maxIndex = start;
    const startPoint = path[start];
    const endPoint = path[end];
    const lineLength = distance(startPoint, endPoint);

    for (let i = start + 1; i < end; i++) {
      // Always keep corners
      if (isCorner[i]) {
        maxIndex = i;
        maxDistance = tolerance + 1; // Force split
        break;
      }

      const point = path[i];
      // Calculate perpendicular distance from point to line
      const dist = lineLength > 0 ? Math.abs(
        (endPoint.y - startPoint.y) * point.x -
        (endPoint.x - startPoint.x) * point.y +
        endPoint.x * startPoint.y -
        endPoint.y * startPoint.x
      ) / lineLength : 0;

      if (dist > maxDistance) {
        maxDistance = dist;
        maxIndex = i;
      }
    }

    // If max distance is greater than tolerance, split recursively
    if (maxDistance > tolerance) {
      const left = simplifySegment(start, maxIndex);
      const right = simplifySegment(maxIndex, end);
      return [...left.slice(0, -1), ...right];
    } else {
      return [start, end];
    }
  }

  const indices = simplifySegment(0, path.length - 1);
  return indices.map(i => path[i]);
}

/**
 * Push waypoints away from obstacles if they're unnecessarily close
 * This prevents "magnetic attraction" to card borders
 */
function adjustWaypointsForClearance(waypoints: Point[], obstacles: Rectangle[], minClearance: number = 30): Point[] {
  if (waypoints.length <= 2) {
    return waypoints;
  }

  const adjusted: Point[] = [waypoints[0]]; // Keep start point fixed

  for (let i = 1; i < waypoints.length - 1; i++) {
    const point = waypoints[i];
    const distToObstacle = distanceToNearestObstacle(point, obstacles);

    // If the point is too close to an obstacle, try to push it away
    if (distToObstacle < minClearance && distToObstacle > 0) {
      // Find the nearest obstacle and push away from it
      let nearestObstacle: Rectangle | null = null;
      let minDist = Infinity;

      for (const obstacle of obstacles) {
        const closestX = Math.max(obstacle.x, Math.min(point.x, obstacle.x + obstacle.width));
        const closestY = Math.max(obstacle.y, Math.min(point.y, obstacle.y + obstacle.height));
        const dx = point.x - closestX;
        const dy = point.y - closestY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDist) {
          minDist = dist;
          nearestObstacle = obstacle;
        }
      }

      if (nearestObstacle && minDist > 0) {
        // Calculate push direction (away from nearest obstacle)
        const closestX = Math.max(nearestObstacle.x, Math.min(point.x, nearestObstacle.x + nearestObstacle.width));
        const closestY = Math.max(nearestObstacle.y, Math.min(point.y, nearestObstacle.y + nearestObstacle.height));
        const pushDx = point.x - closestX;
        const pushDy = point.y - closestY;
        const pushDist = Math.sqrt(pushDx * pushDx + pushDy * pushDy);

        if (pushDist > 0) {
          // Push the point away to achieve minimum clearance
          const pushAmount = minClearance - minDist;
          const adjustedPoint = {
            x: point.x + (pushDx / pushDist) * pushAmount,
            y: point.y + (pushDy / pushDist) * pushAmount,
          };

          // Verify the adjusted point doesn't create line intersections
          const prevPoint = waypoints[i - 1];
          const nextPoint = waypoints[i + 1];

          // Only use adjusted point if it doesn't cause new intersections
          if (!lineIntersectsObstacles(prevPoint, adjustedPoint, obstacles) &&
              !lineIntersectsObstacles(adjustedPoint, nextPoint, obstacles)) {
            adjusted.push(adjustedPoint);
          } else {
            adjusted.push(point);
          }
        } else {
          adjusted.push(point);
        }
      } else {
        adjusted.push(point);
      }
    } else {
      adjusted.push(point);
    }
  }

  adjusted.push(waypoints[waypoints.length - 1]); // Keep end point fixed
  return adjusted;
}

/**
 * Create smooth Bezier curve segments from waypoints using Catmull-Rom spline approach
 * This creates elegant, flowing curves that pass through all waypoints
 */
function createSmoothCurve(waypoints: Point[]): { points: number[]; segments: number } {
  if (waypoints.length < 2) {
    return { points: [], segments: 0 };
  }

  if (waypoints.length === 2) {
    // Perfect straight line - control points along the line for truly straight arrow
    const [start, end] = waypoints;

    // Place control points exactly on the line for a perfectly straight arrow
    const cp1x = start.x + (end.x - start.x) / 3;
    const cp1y = start.y + (end.y - start.y) / 3;
    const cp2x = start.x + (2 * (end.x - start.x)) / 3;
    const cp2y = start.y + (2 * (end.y - start.y)) / 3;

    return {
      points: [
        start.x, start.y,
        cp1x, cp1y, cp2x, cp2y,
        end.x, end.y,
      ],
      segments: 1,
    };
  }

  // Use Catmull-Rom spline approach for beautiful, natural curves
  // Tension: 0 = tight curves, 0.5 = moderate, 1 = loose curves
  const tension = 0.5;
  const points: number[] = [waypoints[0].x, waypoints[0].y];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = i > 0 ? waypoints[i - 1] : waypoints[i];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = i < waypoints.length - 2 ? waypoints[i + 2] : waypoints[i + 1];

    // Catmull-Rom to Bezier conversion with tension control
    // The tangent at p1 pointing toward p2
    const m1x = (p2.x - p0.x) * tension;
    const m1y = (p2.y - p0.y) * tension;

    // The tangent at p2 pointing away from p1
    const m2x = (p3.x - p1.x) * tension;
    const m2y = (p3.y - p1.y) * tension;

    // Convert Catmull-Rom tangents to cubic Bezier control points
    // For Catmull-Rom to Bezier: cp1 = p1 + m1/3, cp2 = p2 - m2/3
    const cp1x = p1.x + m1x / 3;
    const cp1y = p1.y + m1y / 3;
    const cp2x = p2.x - m2x / 3;
    const cp2y = p2.y - m2y / 3;

    points.push(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  return {
    points,
    segments: waypoints.length - 1,
  };
}

/**
 * Main pathfinding function: finds optimal path and returns smooth curve
 */
export function findArrowPath(
  start: Point,
  end: Point,
  obstacles: Rectangle[],
  sourceObstacle?: Rectangle,
  targetObstacle?: Rectangle
): { points: number[]; segments: number; waypoints: Point[] } {
  // Filter out source and target cards from obstacles
  const filteredObstacles = obstacles.filter(
    obs => obs !== sourceObstacle && obs !== targetObstacle
  );

  // Check if direct path is clear
  if (!lineIntersectsObstacles(start, end, filteredObstacles)) {
    // When path is clear, use perfectly straight line
    // Control points placed exactly on the line for zero curvature
    const cp1x = start.x + (end.x - start.x) / 3;
    const cp1y = start.y + (end.y - start.y) / 3;
    const cp2x = start.x + (2 * (end.x - start.x)) / 3;
    const cp2y = start.y + (2 * (end.y - start.y)) / 3;

    return {
      points: [start.x, start.y, cp1x, cp1y, cp2x, cp2y, end.x, end.y],
      segments: 1,
      waypoints: [start, end],
    };
  }

  // Find path using A*
  const waypoints = astar(start, end, filteredObstacles);

  // Simplify path while preserving important corners
  // The enhanced algorithm detects corners automatically
  const simplifiedPath = simplifyPath(waypoints, GRID_SIZE * 2.0);

  // Adjust waypoints to avoid being unnecessarily close to obstacles
  // This prevents "magnetic attraction" to card borders
  const adjustedPath = adjustWaypointsForClearance(simplifiedPath, filteredObstacles, 25);

  // Create smooth curve from waypoints using Catmull-Rom splines
  const curve = createSmoothCurve(adjustedPath);

  return {
    ...curve,
    waypoints: adjustedPath,
  };
}

/**
 * Calculate the best edge point on a card for arrow connection
 */
export function getOptimalEdgePoint(
  cardRect: Rectangle,
  targetPoint: Point,
  _obstacles: Rectangle[]
): Point {
  const cardCenterX = cardRect.x + cardRect.width / 2;
  const cardCenterY = cardRect.y + cardRect.height / 2;

  // Calculate direction to target
  const dx = targetPoint.x - cardCenterX;
  const dy = targetPoint.y - cardCenterY;

  // Find edge intersection
  const halfWidth = cardRect.width / 2;
  const halfHeight = cardRect.height / 2;

  const tRight = dx > 0 ? halfWidth / dx : Infinity;
  const tLeft = dx < 0 ? -halfWidth / dx : Infinity;
  const tBottom = dy > 0 ? halfHeight / dy : Infinity;
  const tTop = dy < 0 ? -halfHeight / dy : Infinity;

  const t = Math.min(tRight, tLeft, tBottom, tTop);

  const edgeX = cardCenterX + t * dx;
  const edgeY = cardCenterY + t * dy;

  return {
    x: Math.max(cardRect.x, Math.min(edgeX, cardRect.x + cardRect.width)),
    y: Math.max(cardRect.y, Math.min(edgeY, cardRect.y + cardRect.height)),
  };
}
