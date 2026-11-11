"use client"

import { Suspense, useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { useTranslation } from '@lumiere/i18n'
import { CanvasWorkspace } from '../composed/canvas-workspace'
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
  const { t } = useTranslation()
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
      <CanvasWorkspace
        className={className}
        side="left"
        controlsLabel={t('ui.stock3d.sidebar.controls', { defaultValue: 'Stock controls' })}
        controlsTitle={t('ui.stock3d.sidebar.title')}
        controlsDescription={t('ui.stock3d.sidebar.subtitle')}
        controls={<StockSidebar />}
        toolbar={<StockSearchBar className="max-w-md" onNavigateToItem={flyToItem} />}
      >
        <div className="relative min-h-0 flex-1" data-testid="warehouse-3d-canvas">
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

        <ItemDetailsPanel className="max-h-[45%] min-w-0 shrink-0 overflow-y-auto overscroll-contain" />
      </CanvasWorkspace>
    </Warehouse3DProvider>
  )
}

export default WarehouseViewer
