// 3D Stock Visualization Types — adapted from v0-mock-up-lumiere

export type ZoneType = 'rack' | 'shelf' | 'floor' | 'cold-storage' | 'bin'

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

export interface Warehouse {
  id: string
  name: string
  dimensions: Dimensions3D
  zones: Zone[]
  createdAt: Date
  updatedAt: Date
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

export type StockCategory =
  | 'electronics'
  | 'clothing'
  | 'food'
  | 'furniture'
  | 'tools'
  | 'packaging'
  | 'raw-materials'
  | 'finished-goods'

export const CATEGORY_COLORS: Record<StockCategory, string> = {
  electronics: '#3b82f6',
  clothing: '#8b5cf6',
  food: '#22c55e',
  furniture: '#f59e0b',
  tools: '#64748b',
  packaging: '#06b6d4',
  'raw-materials': '#ec4899',
  'finished-goods': '#10b981',
}

export interface SearchResult {
  item: StockItem
  slot: StorageSlot
  zone: Zone
}
