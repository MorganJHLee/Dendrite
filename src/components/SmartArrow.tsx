/**
 * SmartArrow Component
 * A modern, feature-rich arrow component for connecting elements in the whiteboard
 */

import React, { useMemo } from 'react';
import { Group, Line, Circle } from 'react-konva';
import {
  ArrowStyle,
  ArrowStylePresets,
  Rect,
} from '../utils/arrowUtils';
import { findArrowPath, getOptimalEdgePoint } from '../utils/pathfinding';
import type { Rectangle } from '../utils/pathfinding';

interface SmartArrowProps {
  // Source and target rectangles
  sourceRect: Rect;
  targetRect: Rect;

  // Obstacles for pathfinding (other cards to route around)
  obstacles?: Rectangle[];

  // Arrow appearance
  style?: Partial<ArrowStyle>;
  isSelected?: boolean;
  isPreview?: boolean;

  // Interaction callbacks
  onClick?: () => void;
  onContextMenu?: (e: any) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;

  // Advanced options
  showWaypoints?: boolean; // Debug: show pathfinding waypoints
  label?: string; // Optional label on the arrow
}

export const SmartArrow: React.FC<SmartArrowProps> = ({
  sourceRect,
  targetRect,
  obstacles = [],
  style = {},
  isSelected = false,
  isPreview = false,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  showWaypoints = false,
  label,
}) => {
  // Determine the effective style based on state
  const effectiveStyle: ArrowStyle = useMemo(() => {
    let baseStyle: ArrowStyle;

    if (isPreview) {
      baseStyle = ArrowStylePresets.preview;
    } else if (isSelected) {
      baseStyle = ArrowStylePresets.selected;
    } else if (style.strokeColor || style.strokeWidth) {
      // Custom style
      baseStyle = { ...ArrowStylePresets.manual, ...style };
    } else {
      // Default based on whether it's manual or auto
      baseStyle = ArrowStylePresets.manual;
    }

    return { ...baseStyle, ...style };
  }, [isSelected, isPreview, style]);

  // Calculate path using sophisticated pathfinding
  const { curvePoints, waypoints, arrowHeadAngle } = useMemo(() => {
    // Calculate centers for edge point detection
    const sourceCenterX = sourceRect.x + sourceRect.width / 2;
    const sourceCenterY = sourceRect.y + sourceRect.height / 2;
    const targetCenterX = targetRect.x + targetRect.width / 2;
    const targetCenterY = targetRect.y + targetRect.height / 2;

    // Get optimal edge points using pathfinding utility
    const sourceEdge = getOptimalEdgePoint(
      sourceRect,
      { x: targetCenterX, y: targetCenterY },
      obstacles
    );

    const targetEdge = getOptimalEdgePoint(
      targetRect,
      { x: sourceCenterX, y: sourceCenterY },
      obstacles
    );

    // Use A* pathfinding to find smooth curve around obstacles
    const pathResult = findArrowPath(
      sourceEdge,
      targetEdge,
      obstacles,
      sourceRect,
      targetRect
    );

    // Calculate arrow head angle from the curve
    const points = pathResult.points;
    let arrowHeadAngle = 0;

    if (points && points.length >= 4) {
      const tx = points[points.length - 2];
      const ty = points[points.length - 1];
      const prevX = points[points.length - 4];
      const prevY = points[points.length - 3];
      arrowHeadAngle = Math.atan2(ty - prevY, tx - prevX);
    }

    return {
      curvePoints: pathResult.points,
      waypoints: pathResult.waypoints,
      arrowHeadAngle,
    };
  }, [sourceRect, targetRect, obstacles]);

  // Skip rendering if no valid path
  if (!curvePoints || curvePoints.length < 4) return null;

  // Hitbox for better click detection
  const hitboxWidth = 20;

  // Arrow head dimensions
  const arrowLength = effectiveStyle.arrowHeadSize;
  const arrowWidth = effectiveStyle.arrowHeadSize * 0.83; // ~10px for 12px size

  // Get arrow tip position
  const tx = curvePoints[curvePoints.length - 2];
  const ty = curvePoints[curvePoints.length - 1];

  return (
    <Group>
      {/* Invisible hitbox for easier clicking */}
      <Line
        points={curvePoints}
        stroke="transparent"
        strokeWidth={hitboxWidth}
        lineCap="round"
        lineJoin="round"
        tension={0}
        bezier
        hitStrokeWidth={hitboxWidth}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={() => {
          if (onMouseEnter) onMouseEnter();
          document.body.style.cursor = 'pointer';
        }}
        onMouseLeave={() => {
          if (onMouseLeave) onMouseLeave();
          document.body.style.cursor = 'default';
        }}
      />

      {/* Outer glow layer for depth */}
      {effectiveStyle.shadowEnabled && (
        <Line
          points={curvePoints}
          stroke={effectiveStyle.strokeColor}
          strokeWidth={effectiveStyle.strokeWidth + 6}
          opacity={0.15}
          lineCap="round"
          lineJoin="round"
          tension={0}
          bezier
          blur={8}
          listening={false}
        />
      )}

      {/* Shadow layer (if enabled) */}
      {effectiveStyle.shadowEnabled && (
        <Line
          points={curvePoints}
          stroke={effectiveStyle.shadowColor || 'rgba(0, 0, 0, 0.2)'}
          strokeWidth={effectiveStyle.strokeWidth}
          opacity={effectiveStyle.opacity * 0.4}
          lineCap="round"
          lineJoin="round"
          tension={0}
          bezier
          shadowBlur={effectiveStyle.shadowBlur || 8}
          shadowColor={effectiveStyle.shadowColor || 'rgba(0, 0, 0, 0.2)'}
          listening={false}
        />
      )}

      {/* Inner bright core line for modern look */}
      {isSelected && (
        <Line
          points={curvePoints}
          stroke="white"
          strokeWidth={effectiveStyle.strokeWidth * 0.4}
          opacity={0.6}
          lineCap="round"
          lineJoin="round"
          tension={0}
          bezier
          listening={false}
        />
      )}

      {/* Main arrow line */}
      <Line
        points={curvePoints}
        stroke={effectiveStyle.strokeColor}
        strokeWidth={effectiveStyle.strokeWidth}
        opacity={effectiveStyle.opacity}
        lineCap="round"
        lineJoin="round"
        tension={0}
        bezier
        dash={effectiveStyle.dashEnabled ? effectiveStyle.dashPattern : undefined}
        listening={false}
      />

      {/* Arrow head */}
      {effectiveStyle.arrowHeadType === 'triangle' && (
        <Group x={tx} y={ty} rotation={arrowHeadAngle * 180 / Math.PI}>
          {/* Glow behind arrow head when selected */}
          {isSelected && (
            <Line
              points={[
                0, 0,
                -arrowLength, arrowWidth / 2,
                -arrowLength, -arrowWidth / 2,
                0, 0
              ]}
              fill={effectiveStyle.strokeColor}
              opacity={0.3}
              closed
              shadowBlur={12}
              shadowColor={effectiveStyle.strokeColor}
              shadowOpacity={0.6}
              listening={false}
            />
          )}
          {/* Main arrow head */}
          <Line
            points={[
              0, 0,
              -arrowLength, arrowWidth / 2,
              -arrowLength, -arrowWidth / 2,
              0, 0
            ]}
            fill={effectiveStyle.strokeColor}
            fillOpacity={effectiveStyle.opacity}
            stroke={effectiveStyle.strokeColor}
            strokeWidth={1}
            opacity={effectiveStyle.opacity}
            closed
            listening={false}
          />
        </Group>
      )}

      {effectiveStyle.arrowHeadType === 'circle' && (
        <Circle
          x={tx}
          y={ty}
          radius={arrowLength / 2}
          fill={effectiveStyle.strokeColor}
          opacity={effectiveStyle.opacity}
          listening={false}
        />
      )}

      {effectiveStyle.arrowHeadType === 'diamond' && (
        <Line
          points={[
            0, 0,
            -arrowLength, -arrowWidth / 2,
            -arrowLength * 1.5, 0,
            -arrowLength, arrowWidth / 2,
            0, 0
          ]}
          fill={effectiveStyle.strokeColor}
          stroke={effectiveStyle.strokeColor}
          strokeWidth={1}
          closed
          opacity={effectiveStyle.opacity}
          x={tx}
          y={ty}
          rotation={arrowHeadAngle * 180 / Math.PI}
          listening={false}
        />
      )}

      {/* Show waypoints when selected for debugging */}
      {(isSelected && showWaypoints) && waypoints.map((waypoint, idx) => (
        <Circle
          key={`waypoint-${idx}`}
          x={waypoint.x}
          y={waypoint.y}
          radius={4}
          fill={effectiveStyle.strokeColor}
          opacity={0.4}
          listening={false}
        />
      ))}

      {/* Optional label */}
      {label && (
        <Group
          x={(curvePoints[0] + tx) / 2}
          y={(curvePoints[1] + ty) / 2}
        >
          {/* Label background */}
          <Circle
            radius={20}
            fill="white"
            stroke={effectiveStyle.strokeColor}
            strokeWidth={2}
            opacity={0.9}
          />
          {/* Label text - would need to use Text component from react-konva */}
        </Group>
      )}
    </Group>
  );
};

export default SmartArrow;
