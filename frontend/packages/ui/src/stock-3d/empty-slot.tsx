"use client"

import { useState } from 'react'
import { Html } from '@react-three/drei'
import type { StorageSlot } from './types'
import { useWarehouse3DContext } from './warehouse-3d-context'

interface EmptySlotProps {
  slot: StorageSlot
  size?: [number, number, number]
}

export function EmptySlot({ slot, size = [0.8, 0.8, 0.8] }: EmptySlotProps) {
  const [hovered, setHovered] = useState(false)

  const { selectedSlotId, viewMode, setSelectedSlot } = useWarehouse3DContext()

  const isSelected = selectedSlotId === slot.id
  const showEmptySlots = viewMode === 'empty-slots'

  if (!showEmptySlots && !isSelected && !hovered) {
    return (
      <mesh
        position={[slot.position.x, slot.position.y, slot.position.z]}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedSlot(isSelected ? null : slot.id)
        }}
      >
        <boxGeometry args={size} />
        <meshBasicMaterial visible={false} />
      </mesh>
    )
  }

  return (
    <group position={[slot.position.x, slot.position.y, slot.position.z]}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedSlot(isSelected ? null : slot.id)
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={isSelected ? '#22c55e' : '#64748b'}
          transparent
          opacity={isSelected ? 0.6 : 0.2}
          wireframe={!isSelected}
        />
      </mesh>
      {hovered && (
        <Html
          position={[0, size[1] / 2 + 0.3, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-popover text-popover-foreground px-3 py-2 rounded-lg shadow-lg border border-border text-sm whitespace-nowrap">
            <p className="font-medium">Empty Slot</p>
            <p className="text-muted-foreground text-xs">
              Row {slot.row + 1}, Col {slot.column + 1}, Level {slot.level + 1}
            </p>
            <p className="text-xs text-green-500 mt-1">Click to add item</p>
          </div>
        </Html>
      )}
    </group>
  )
}
