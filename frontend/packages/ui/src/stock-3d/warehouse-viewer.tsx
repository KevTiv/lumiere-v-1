"use client"

import { Suspense, useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { cn } from '../lib/utils'
import { Warehouse3DProvider } from './warehouse-3d-context'
import { WarehouseScene } from './warehouse-scene'
import { StockSidebar } from './stock-sidebar'
import { StockSearchBar } from './stock-search-bar'
import { ItemDetailsPanel } from './item-details-panel'
import type { Zone, StorageSlot, StockItem } from './types'

interface WarehouseViewerProps {
  className?: string
  zones: Zone[]
  slots: StorageSlot[]
  items: StockItem[]
  warehouseName?: string
  warehouseDimensions?: { width: number; height: number; depth: number }
  onMoveItem?: (itemId: string, targetSlotId: string) => void
  onUpdateQuantity?: (itemId: string, quantity: number) => void
  onRemoveItem?: (itemId: string) => void
}

export function WarehouseViewer({
  className,
  zones,
  slots,
  items,
  warehouseName,
  warehouseDimensions,
  onMoveItem,
  onUpdateQuantity,
  onRemoveItem,
}: WarehouseViewerProps) {
  const controlsRef = useRef<OrbitControlsType | null>(null)

  const flyToItem = useCallback(
    (itemId: string) => {
      if (!controlsRef.current) return

      const item = items.find((i) => i.id === itemId)
      if (!item) return

      const slot = slots.find((s) => s.id === item.slotId)
      if (!slot) return

      const controls = controlsRef.current
      const startPos = controls.object.position.clone()
      const startTarget = controls.target.clone()
      const duration = 1000
      const startTime = performance.now()

      const targetX = slot.position.x
      const targetY = slot.position.y + 2
      const targetZ = slot.position.z + 8

      const animate = () => {
        const elapsed = performance.now() - startTime
        const progress = Math.min(elapsed / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)

        controls.object.position.set(
          startPos.x + (targetX + 5 - startPos.x) * eased,
          startPos.y + (targetY + 5 - startPos.y) * eased,
          startPos.z + (targetZ - startPos.z) * eased,
        )

        controls.target.set(
          startTarget.x + (slot.position.x - startTarget.x) * eased,
          startTarget.y + (slot.position.y - startTarget.y) * eased,
          startTarget.z + (slot.position.z - startTarget.z) * eased,
        )

        controls.update()

        if (progress < 1) requestAnimationFrame(animate)
      }

      animate()
    },
    [items, slots],
  )

  const handleCameraRef = useCallback((controls: OrbitControlsType | null) => {
    controlsRef.current = controls
  }, [])

  return (
    <Warehouse3DProvider
      zones={zones}
      slots={slots}
      items={items}
      onMoveItem={onMoveItem}
      onUpdateQuantity={onUpdateQuantity}
      onRemoveItem={onRemoveItem}
    >
      <div className={cn('flex h-full w-full overflow-hidden', className)}>
        {/* Sidebar */}
        <StockSidebar className="w-64 shrink-0" />

        {/* Main area */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-3 p-3 border-b border-border bg-card">
            <StockSearchBar className="flex-1 max-w-md" onNavigateToItem={flyToItem} />
          </div>

          {/* 3D Canvas */}
          <div className="flex-1 relative">
            <Canvas
              shadows
              gl={{ antialias: true, alpha: false }}
              dpr={[1, 2]}
              style={{ background: '#0f172a' }}
            >
              <Suspense fallback={null}>
                <WarehouseScene
                  onCameraRef={handleCameraRef}
                  warehouseName={warehouseName}
                  warehouseDimensions={warehouseDimensions}
                />
              </Suspense>
            </Canvas>
            <Loader />
          </div>

          {/* Item details panel (shown when an item is selected) */}
          <ItemDetailsPanel />
        </div>
      </div>
    </Warehouse3DProvider>
  )
}

export default WarehouseViewer
