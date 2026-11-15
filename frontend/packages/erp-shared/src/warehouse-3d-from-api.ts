/**
 * Build Zone / StorageSlot / StockItem data for <WarehouseViewer> from HTTP /api/query rows
 * (same layout as packages/stdb useWarehouse3D + queryWarehouse3DZones).
 */

import type { Zone, StorageSlot, StockItem, ZoneType } from "@lumiere/stdb/warehouse-3d"
import type { QueryRows } from "@lumiere/api-client"
import { getRowField } from "./row-values"
import { inventoryQuantity, type StockReorderEntry } from "./replenishment-stock"
import { stbTimestampMicros } from "./stb-timestamp"

function toZoneType(displayType: unknown): ZoneType {
  const tag =
    displayType !== null &&
    typeof displayType === "object" &&
    "tag" in displayType
      ? String((displayType as { tag: string }).tag)
      : String(displayType ?? "")
  switch (tag.toLowerCase()) {
    case "floor":
      return "floor"
    case "bin":
      return "bin"
    case "rack":
    default:
      return "rack"
  }
}

function buildZone(zone3D: Record<string, unknown>, location: Record<string, unknown>): Zone {
  return {
    id: String(zone3D.id ?? ""),
    warehouseId: String(zone3D.warehouseId ?? ""),
    name: String(location.completeName ?? location.name ?? `Zone ${zone3D.id}`),
    type: toZoneType(zone3D.displayType),
    position: {
      x: Number(location.posx ?? 0),
      y: Number(location.posy ?? 0),
      z: Number(location.posz ?? 0),
    },
    dimensions: {
      width: Number(zone3D.width ?? 10),
      height: Number(zone3D.height ?? 5),
      depth: Number(zone3D.depth ?? 4),
    },
    rows: Number(zone3D.rows ?? 2),
    columns: Number(zone3D.columns ?? 4),
    levels: Number(zone3D.levels ?? 3),
    color: String(zone3D.color ?? "#0e7490"),
  }
}

function buildSlots(zone: Zone, childLocations: QueryRows): StorageSlot[] {
  const slots: StorageSlot[] = []
  const { width, height, depth } = zone.dimensions
  const slotWidth = width / zone.columns
  const slotHeight = height / zone.levels
  const slotDepth = depth / zone.rows

  if (childLocations.length > 0) {
    for (const [index, location] of childLocations.entries()) {
      const px = Number(location.posx ?? 0)
      const py = Number(location.posy ?? 0)
      const pz = Number(location.posz ?? 0)
      const hasPosition = Boolean(px || py || pz)
      const column = hasPosition ? Math.max(0, Math.min(zone.columns - 1, Math.round((px - zone.position.x) / slotWidth))) : index % zone.columns
      const level = hasPosition ? Math.max(0, Math.min(zone.levels - 1, Math.round((py - zone.position.y) / slotHeight))) : Math.floor(index / zone.columns) % zone.levels
      const row = hasPosition ? Math.max(0, Math.min(zone.rows - 1, Math.round((pz - zone.position.z) / slotDepth))) : Math.floor(index / (zone.columns * zone.levels))
      slots.push({
        id: String(location.id),
        zoneId: zone.id,
        locationId: String(location.id),
        row,
        column,
        level,
        position: hasPosition ? { x: px, y: py, z: pz } : {
          x: zone.position.x + (column + 0.5) * slotWidth,
          y: zone.position.y + (level + 0.5) * slotHeight,
          z: zone.position.z + (row + 0.5) * slotDepth,
        },
        occupied: false,
      })
    }
  }

  return slots
}

function stockDate(value: unknown): Date | undefined {
  const raw = value && typeof value === "object" && "some" in value ? value.some : value
  const micros = stbTimestampMicros(raw)
    ?? (typeof raw === "bigint" || typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : undefined)
  if (micros == null || Number(micros) <= 0) return undefined
  const timestamp = new Date(Number(micros) / 1000)
  return Number.isFinite(timestamp.getTime()) ? timestamp : undefined
}

function buildItems(
  quants: QueryRows,
  slotsByLocationId: Map<string, StorageSlot>,
  productById: ReadonlyMap<string, { name: string; sku: string; category?: string }>,
  reorderEntries: readonly Pick<StockReorderEntry<object>, "key" | "minimum">[],
): StockItem[] {
  const reorderByKey = new Map(reorderEntries.map((entry) => [entry.key, entry]))
  return quants.flatMap((quant) => {
    const quantity = inventoryQuantity(getRowField(quant, "quantity"))
    const locationId = String(getRowField(quant, "locationId"))
    const slot = slotsByLocationId.get(locationId)
    if (quantity == null || quantity <= 0 || !slot) return []
    const productId = String(getRowField(quant, "productId"))
    const product = productById.get(productId)
    const reorder = reorderByKey.get(`${productId}:${locationId}`)
    return [{
      id: String(quant.id),
      sku: product?.sku || `SKU-${productId}`,
      name: product?.name || `Product ${productId}`,
      category: product?.category ?? "",
      quantity,
      availableQuantity: inventoryQuantity(getRowField(quant, "availableQuantity")),
      slotId: slot.id,
      zoneId: slot.zoneId,
      lastUpdated: stockDate(getRowField(quant, "inDate")),
      lowStock: reorder != null,
      minStock: reorder?.minimum,
    }]
  })
}

export function buildWarehouse3DView(
  warehouseId: bigint,
  zones3D: QueryRows,
  allLocations: QueryRows,
  allQuants: QueryRows,
  productById: ReadonlyMap<string, { name: string; sku: string; category?: string }>,
  reorderEntries: readonly Pick<StockReorderEntry<object>, "key" | "minimum">[] = [],
): { zones: Zone[]; slots: StorageSlot[]; items: StockItem[] } {
  const wid = String(warehouseId)
  const filteredZones = zones3D.filter(
    (z) => String(z.warehouseId) === wid && z.isActive !== false,
  )

  const locationById = new Map(allLocations.map((l) => [String(l.id), l]))
  const zones: Zone[] = []
  const slotsByLocationId = new Map<string, StorageSlot>()
  const allSlots: StorageSlot[] = []

  for (const zone3D of filteredZones) {
    const rootLocation = locationById.get(String(getRowField(zone3D, "locationId")))
    if (!rootLocation) continue

    const zone = buildZone(zone3D, rootLocation)
    zones.push(zone)

    const children = allLocations.filter(
      (location) => location.active !== false && String(getRowField(location, "locationId")) === String(rootLocation.id),
    )
    const rootHasStock = allQuants.some((quant) => String(getRowField(quant, "locationId")) === String(rootLocation.id))

    const slots = buildSlots(zone, rootHasStock || children.length === 0 ? [rootLocation, ...children] : children)
    for (const slot of slots) {
      allSlots.push(slot)
      slotsByLocationId.set(slot.id, slot)
    }
  }

  const relevantQuants = allQuants.filter((q) => slotsByLocationId.has(String(getRowField(q, "locationId"))))

  for (const q of relevantQuants) {
    const slot = slotsByLocationId.get(String(getRowField(q, "locationId")))
    if (slot && Number(q.quantity ?? 0) > 0) {
      slot.occupied = true
      slot.itemId = String(q.id)
    }
  }

  const items = buildItems(relevantQuants, slotsByLocationId, productById, reorderEntries)

  return { zones, slots: allSlots, items }
}
