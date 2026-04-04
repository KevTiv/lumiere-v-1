/**
 * Types for 3D warehouse visualization — shared by `useWarehouse3D` and `@lumiere/ui` stock-3d.
 * Keeps `@lumiere/stdb` free of any dependency on `@lumiere/ui`.
 */

export type ZoneType = "rack" | "shelf" | "floor" | "cold-storage" | "bin"

export interface Position3D {
  x: number
  y: number
  z: number
}

export interface Dimensions3D {
  width: number
  height: number
  depth: number
}

export interface Zone {
  id: string
  warehouseId: string
  name: string
  type: ZoneType
  position: Position3D
  dimensions: Dimensions3D
  rows: number
  columns: number
  levels: number
  color: string
}

export interface StorageSlot {
  id: string
  zoneId: string
  row: number
  column: number
  level: number
  position: Position3D
  occupied: boolean
  itemId?: string
}

export type StockCategory =
  | "electronics"
  | "clothing"
  | "food"
  | "furniture"
  | "tools"
  | "packaging"
  | "raw-materials"
  | "finished-goods"

export interface StockItem {
  id: string
  sku: string
  name: string
  category: StockCategory
  quantity: number
  slotId: string
  zoneId: string
  lastUpdated: Date
  minStock?: number
  maxStock?: number
}
