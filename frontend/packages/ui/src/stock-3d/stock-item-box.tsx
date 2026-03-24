"use client"

import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Mesh } from 'three'
import type { StockItem, Position3D } from './types'
import { CATEGORY_COLORS } from './types'
import { useWarehouse3DContext } from './warehouse-3d-context'

interface StockItemBoxProps {
  item: StockItem
  position: Position3D
  size?: [number, number, number]
}

export function StockItemBox({ item, position, size = [0.8, 0.8, 0.8] }: StockItemBoxProps) {
  const meshRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const { selectedItemId, highlightedItemIds, setSelectedItem, setHoveredItem } =
    useWarehouse3DContext()

  const isSelected = selectedItemId === item.id
  const isHighlighted = highlightedItemIds.includes(item.id)
  const isLowStock = item.minStock !== undefined && item.quantity <= item.minStock

  const baseColor = CATEGORY_COLORS[item.category]

  useFrame((state) => {
    if (!meshRef.current) return
    if (isSelected) {
      meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 3) * 0.05)
    } else if (isHighlighted) {
      meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 4) * 0.08)
    } else {
      meshRef.current.scale.setScalar(1)
    }
  })

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          setHoveredItem(item.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
          setHoveredItem(null)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          setSelectedItem(isSelected ? null : item.id)
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={isLowStock ? '#ef4444' : baseColor}
          emissive={isSelected ? '#ffffff' : isHighlighted ? '#fbbf24' : '#000000'}
          emissiveIntensity={isSelected ? 0.3 : isHighlighted ? 0.4 : 0}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -size[1] / 2 + 0.01, 0]}>
          <ringGeometry args={[0.6, 0.7, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
        </mesh>
      )}

      {hovered && !isSelected && (
        <Html
          position={[0, size[1] / 2 + 0.5, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-popover text-popover-foreground px-3 py-2 rounded-lg shadow-lg border border-border text-sm whitespace-nowrap">
            <p className="font-medium">{item.name}</p>
            <p className="text-muted-foreground text-xs">{item.sku}</p>
            <p className="text-xs mt-1">
              Qty:{' '}
              <span className={isLowStock ? 'text-destructive font-bold' : ''}>{item.quantity}</span>
              {isLowStock && ' (Low Stock)'}
            </p>
          </div>
        </Html>
      )}
    </group>
  )
}
