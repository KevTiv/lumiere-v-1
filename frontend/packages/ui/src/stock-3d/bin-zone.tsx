"use client"

import type { Zone, StorageSlot, StockItem } from './types'
import { StockItemBox } from './stock-item-box'
import { EmptySlot } from './empty-slot'

interface BinZoneProps {
  zone: Zone
  slots: StorageSlot[]
  items: StockItem[]
}

export function BinZone({ zone, slots, items }: BinZoneProps) {
  const binWidth = zone.dimensions.width / zone.columns
  const binHeight = zone.dimensions.height / zone.levels
  const binDepth = zone.dimensions.depth / zone.rows

  const frameColor = '#0e7490'
  const dividerColor = '#155e75'

  return (
    <group>
      {/* Back panel */}
      <mesh
        position={[
          zone.position.x + zone.dimensions.width / 2,
          zone.position.y + zone.dimensions.height / 2,
          zone.position.z - 0.05,
        ]}
      >
        <boxGeometry
          args={[zone.dimensions.width + 0.1, zone.dimensions.height + 0.1, 0.05]}
        />
        <meshStandardMaterial color={frameColor} roughness={0.6} metalness={0.2} />
      </mesh>

      {/* Horizontal dividers */}
      {Array.from({ length: zone.levels + 1 }).map((_, level) => (
        <mesh
          key={`hdiv-${level}`}
          position={[
            zone.position.x + zone.dimensions.width / 2,
            zone.position.y + level * binHeight,
            zone.position.z + zone.dimensions.depth / 2,
          ]}
        >
          <boxGeometry
            args={[zone.dimensions.width + 0.05, 0.02, zone.dimensions.depth + 0.05]}
          />
          <meshStandardMaterial color={dividerColor} roughness={0.7} />
        </mesh>
      ))}

      {/* Vertical dividers */}
      {Array.from({ length: zone.columns + 1 }).map((_, col) => (
        <mesh
          key={`vdiv-${col}`}
          position={[
            zone.position.x + col * binWidth,
            zone.position.y + zone.dimensions.height / 2,
            zone.position.z + zone.dimensions.depth / 2,
          ]}
        >
          <boxGeometry
            args={[0.02, zone.dimensions.height, zone.dimensions.depth + 0.05]}
          />
          <meshStandardMaterial color={dividerColor} roughness={0.7} />
        </mesh>
      ))}

      {/* Items in bin slots */}
      {slots.map((slot) => {
        const item = items.find((i) => i.slotId === slot.id)
        if (item) {
          return (
            <StockItemBox
              key={item.id}
              item={item}
              position={slot.position}
              size={[binWidth * 0.7, binHeight * 0.7, binDepth * 0.7]}
            />
          )
        }
        return (
          <EmptySlot
            key={slot.id}
            slot={slot}
            size={[binWidth * 0.7, binHeight * 0.7, binDepth * 0.7]}
          />
        )
      })}
    </group>
  )
}
