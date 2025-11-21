/**
 * ConnectionPoint Component
 * Visual connection points that appear on cards for creating arrows
 */

import React, { useState } from 'react';
import { Group, Circle } from 'react-konva';

interface ConnectionPointProps {
  x: number;
  y: number;
  side: 'top' | 'right' | 'bottom' | 'left';
  visible: boolean;
  onMouseDown: (e: any) => void;
  isActive?: boolean; // Currently being used to draw
}

export const ConnectionPoint: React.FC<ConnectionPointProps> = ({
  x,
  y,
  // side is included for potential future use (e.g., directional indicators)
  visible,
  onMouseDown,
  isActive = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  if (!visible && !isActive) return null;

  const baseSize = 7;
  const hoverSize = 10;
  const activeSize = 9;

  const size = isActive ? activeSize : isHovered ? hoverSize : baseSize;

  const baseColor = '#3b82f6'; // Blue-500 (matching arrow color)
  const hoverColor = '#2563eb'; // Blue-600
  const activeColor = '#1d4ed8'; // Blue-700

  const color = isActive ? activeColor : isHovered ? hoverColor : baseColor;

  return (
    <Group x={x} y={y}>
      {/* Outer animated glow ring */}
      <Circle
        radius={size + 6}
        fill={color}
        opacity={isHovered || isActive ? 0.25 : 0.12}
        shadowBlur={isHovered ? 12 : 6}
        shadowColor={color}
        shadowOpacity={0.4}
      />

      {/* Mid glow ring */}
      {(isHovered || isActive) && (
        <Circle
          radius={size + 3}
          fill={color}
          opacity={0.4}
        />
      )}

      {/* White border ring */}
      <Circle
        radius={size + 1}
        fill="white"
        opacity={visible || isActive ? 1 : 0}
      />

      {/* Main colored circle */}
      <Circle
        radius={size}
        fill={color}
        opacity={visible || isActive ? 0.95 : 0}
        onMouseDown={onMouseDown}
        onMouseEnter={() => {
          setIsHovered(true);
          document.body.style.cursor = 'crosshair';
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          document.body.style.cursor = 'default';
        }}
        shadowBlur={isHovered ? 8 : 0}
        shadowColor={color}
        shadowOpacity={0.6}
      />

      {/* Center white highlight */}
      <Circle
        radius={size * 0.35}
        fill="white"
        opacity={isHovered || isActive ? 0.9 : 0.6}
      />
    </Group>
  );
};

export default ConnectionPoint;
