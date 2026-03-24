"use client"

import { useRef } from 'react'
import { OrbitControls, Grid, Environment, Text, PerspectiveCamera } from '@react-three/drei'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { useWarehouse3DContext } from './warehouse-3d-context'
import { RackModel } from './rack-model'
import { FloorZone } from './floor-zone'
import { BinZone } from './bin-zone'

interface WarehouseSceneProps {
  onCameraRef?: (controls: OrbitControlsType | null) => void
  warehouseName?: string
  warehouseDimensions?: { width: number; height: number; depth: number }
}

export function WarehouseScene({
  onCameraRef,
  warehouseName,
  warehouseDimensions = { width: 50, height: 10, depth: 50 },
}: WarehouseSceneProps) {
  const controlsRef = useRef<OrbitControlsType>(null)

  const { zones, slots, items } = useWarehouse3DContext()

  const zoneData = zones.map((zone) => ({
    zone,
    slots: slots.filter((s) => s.zoneId === zone.id),
    items: items.filter((i) => i.zoneId === zone.id),
  }))

  return (
    <>
      <PerspectiveCamera makeDefault position={[25, 20, 25]} fov={50} />

      <OrbitControls
        ref={(ref) => {
          controlsRef.current = ref
          onCameraRef?.(ref)
        }}
        enableDamping
        dampingFactor={0.05}
        minDistance={5}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2 - 0.1}
        target={[0, 2, 0]}
      />

      <ambientLight intensity={0.4} />
      <directionalLight
        position={[20, 30, 10]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-10, 20, -10]} intensity={0.3} />

      <Environment preset="warehouse" />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} />
      </mesh>

      <Grid
        position={[0, 0, 0]}
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#334155"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#475569"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid
      />

      {/* Warehouse boundary ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry
          args={[
            Math.max(warehouseDimensions.width, warehouseDimensions.depth) * 0.6,
            Math.max(warehouseDimensions.width, warehouseDimensions.depth) * 0.62,
            64,
          ]}
        />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.3} />
      </mesh>

      {/* Zones */}
      {zoneData.map(({ zone, slots: zoneSlots, items: zoneItems }) => {
        switch (zone.type) {
          case 'rack':
          case 'shelf':
            return (
              <RackModel key={zone.id} zone={zone} slots={zoneSlots} items={zoneItems} />
            )
          case 'floor':
          case 'cold-storage':
            return (
              <FloorZone key={zone.id} zone={zone} slots={zoneSlots} items={zoneItems} />
            )
          case 'bin':
            return (
              <BinZone key={zone.id} zone={zone} slots={zoneSlots} items={zoneItems} />
            )
          default:
            return null
        }
      })}

      {/* Zone labels */}
      {zones.map((zone) => (
        <Text
          key={`label-${zone.id}`}
          position={[
            zone.position.x + zone.dimensions.width / 2,
            zone.position.y + zone.dimensions.height + 1,
            zone.position.z + zone.dimensions.depth / 2,
          ]}
          fontSize={0.8}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          {zone.name}
        </Text>
      ))}

      {/* Warehouse name */}
      {warehouseName && (
        <Text
          position={[0, warehouseDimensions.height + 3, 0]}
          fontSize={1.5}
          color="#64748b"
          anchorX="center"
          anchorY="middle"
        >
          {warehouseName}
        </Text>
      )}
    </>
  )
}
