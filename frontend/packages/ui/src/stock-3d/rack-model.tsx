"use client"

import type { Zone, StorageSlot, StockItem } from './types'
import { StockItemBox } from './stock-item-box'
import { EmptySlot } from './empty-slot'

interface RackModelProps {
  zone: Zone
  slots: StorageSlot[]
  items: StockItem[]
}

export function RackModel({ zone, slots, items }: RackModelProps) {
  const slotWidth = zone.dimensions.width / zone.columns
  const slotHeight = zone.dimensions.height / zone.levels
  const slotDepth = zone.dimensions.depth / zone.rows

  const frameColor = '#374151'
  const shelfColor = '#4b5563'
  const frameThickness = 0.08

  const posts: React.ReactElement[] = []
  for (let col = 0; col <= zone.columns; col++) {
    for (let row = 0; row <= zone.rows; row++) {
      const x = zone.position.x + col * slotWidth
      const z = zone.position.z + row * slotDepth

      posts.push(
        <mesh
          key={`post-${col}-${row}`}
          position={[x, zone.position.y + zone.dimensions.height / 2, z]}
        >
          <boxGeometry
            args={[frameThickness, zone.dimensions.height, frameThickness]}
          />
          <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0.3} />
        </mesh>,
      )
    }
  }

  const shelves: React.ReactElement[] = []
  for (let level = 0; level <= zone.levels; level++) {
    const y = zone.position.y + level * slotHeight

    shelves.push(
      <mesh
        key={`shelf-${level}`}
        position={[
          zone.position.x + zone.dimensions.width / 2,
          y,
          zone.position.z + zone.dimensions.depth / 2,
        ]}
      >
        <boxGeometry args={[zone.dimensions.width, 0.03, zone.dimensions.depth]} />
        <meshStandardMaterial color={shelfColor} roughness={0.8} metalness={0.1} />
      </mesh>,
    )
  }

  const slotElements = slots.map((slot) => {
    const item = items.find((i) => i.slotId === slot.id)
    if (item) {
      return (
        <StockItemBox
          key={item.id}
          item={item}
          position={slot.position}
          size={[slotWidth * 0.7, slotHeight * 0.7, slotDepth * 0.7]}
        />
      )
    }
    return (
      <EmptySlot
        key={slot.id}
        slot={slot}
        size={[slotWidth * 0.7, slotHeight * 0.7, slotDepth * 0.7]}
      />
    )
  })

  return (
    <group>
      {posts}
      {shelves}
      {slotElements}
    </group>
  )
}
