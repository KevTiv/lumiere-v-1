"use client"

import type { Zone, StorageSlot, StockItem } from './types'
import { StockItemBox } from './stock-item-box'
import { EmptySlot } from './empty-slot'

interface FloorZoneProps {
  zone: Zone
  slots: StorageSlot[]
  items: StockItem[]
}

export function FloorZone({ zone, slots, items }: FloorZoneProps) {
  const slotWidth = zone.dimensions.width / zone.columns
  const slotDepth = zone.dimensions.depth / zone.rows
  const floorY = zone.position.y + 0.01

  return (
    <group>
      {/* Floor area marking */}
      <mesh
        position={[
          zone.position.x + zone.dimensions.width / 2,
          floorY,
          zone.position.z + zone.dimensions.depth / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[zone.dimensions.width, zone.dimensions.depth]} />
        <meshStandardMaterial color={zone.color} transparent opacity={0.3} roughness={0.9} />
      </mesh>

      {/* Zone boundary outline */}
      <mesh
        position={[
          zone.position.x + zone.dimensions.width / 2,
          floorY + 0.02,
          zone.position.z + zone.dimensions.depth / 2,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry
          args={[
            Math.max(zone.dimensions.width, zone.dimensions.depth) * 0.48,
            Math.max(zone.dimensions.width, zone.dimensions.depth) * 0.5,
            4,
          ]}
        />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} />
      </mesh>

      {/* Grid lines — vertical */}
      {Array.from({ length: zone.columns + 1 }).map((_, col) => (
        <mesh
          key={`vline-${col}`}
          position={[
            zone.position.x + col * slotWidth,
            floorY + 0.005,
            zone.position.z + zone.dimensions.depth / 2,
          ]}
        >
          <boxGeometry args={[0.02, 0.01, zone.dimensions.depth]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
      ))}

      {/* Grid lines — horizontal */}
      {Array.from({ length: zone.rows + 1 }).map((_, row) => (
        <mesh
          key={`hline-${row}`}
          position={[
            zone.position.x + zone.dimensions.width / 2,
            floorY + 0.005,
            zone.position.z + row * slotDepth,
          ]}
        >
          <boxGeometry args={[zone.dimensions.width, 0.01, 0.02]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.5} />
        </mesh>
      ))}

      {/* Items in floor slots */}
      {slots.map((slot) => {
        const item = items.find((i) => i.slotId === slot.id)
        if (item) {
          return (
            <StockItemBox
              key={item.id}
              item={item}
              position={{ ...slot.position, y: slot.position.y + 0.5 }}
              size={[slotWidth * 0.8, 1, slotDepth * 0.8]}
            />
          )
        }
        return (
          <EmptySlot
            key={slot.id}
            slot={{ ...slot, position: { ...slot.position, y: slot.position.y + 0.5 } }}
            size={[slotWidth * 0.8, 1, slotDepth * 0.8]}
          />
        )
      })}
    </group>
  )
}
