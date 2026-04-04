// 3D Stock Visualization — core shapes live in @lumiere/stdb for useWarehouse3D / HTTP adapters.

import type {
  Dimensions3D,
  StockCategory,
  StockItem,
  StorageSlot,
  Zone,
} from "@lumiere/stdb"

export type {
  ZoneType,
  Position3D,
  Dimensions3D,
  Zone,
  StorageSlot,
  StockItem,
  StockCategory,
} from "@lumiere/stdb"

export interface Warehouse {
  id: string
  name: string
  dimensions: Dimensions3D
  zones: Zone[]
  createdAt: Date
  updatedAt: Date
}

export const CATEGORY_COLORS: Record<StockCategory, string> = {
  electronics: "#3b82f6",
  clothing: "#8b5cf6",
  food: "#22c55e",
  furniture: "#f59e0b",
  tools: "#64748b",
  packaging: "#06b6d4",
  "raw-materials": "#ec4899",
  "finished-goods": "#10b981",
}

export interface SearchResult {
  item: StockItem
  slot: StorageSlot
  zone: Zone
}
