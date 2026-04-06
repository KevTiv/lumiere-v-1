/**
 * Build Zone / StorageSlot / StockItem data for <WarehouseViewer> from HTTP /api/query rows
 * (same layout as packages/stdb useWarehouse3D + queryWarehouse3DZones).
 */

import type { Zone, StorageSlot, StockItem, ZoneType, StockCategory } from "@lumiere/stdb/warehouse-3d"
import type { QueryRows } from "@lumiere/api-client"

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

  if (
    childLocations.length > 0 &&
    childLocations.some((l) => Number(l.posx ?? 0) || Number(l.posy ?? 0) || Number(l.posz ?? 0))
  ) {
    for (const loc of childLocations) {
      const px = Number(loc.posx ?? 0)
      const py = Number(loc.posy ?? 0)
      const pz = Number(loc.posz ?? 0)
      const col = Math.max(
        0,
        Math.min(zone.columns - 1, Math.round((px - zone.position.x) / slotWidth)),
      )
      const level = Math.max(
        0,
        Math.min(zone.levels - 1, Math.round((py - zone.position.y) / slotHeight)),
      )
      const row = Math.max(
        0,
        Math.min(zone.rows - 1, Math.round((pz - zone.position.z) / slotDepth)),
      )
      slots.push({
        id: String(loc.id),
        zoneId: zone.id,
        row,
        column: col,
        level,
        position: { x: px, y: py, z: pz },
        occupied: false,
        itemId: undefined,
      })
    }
  } else {
    for (let row = 0; row < zone.rows; row++) {
      for (let col = 0; col < zone.columns; col++) {
        for (let level = 0; level < zone.levels; level++) {
          const slotId = `${zone.id}-${row}-${col}-${level}`
          slots.push({
            id: slotId,
            zoneId: zone.id,
            row,
            column: col,
            level,
            position: {
              x: zone.position.x + col * slotWidth + slotWidth / 2,
              y: zone.position.y + level * slotHeight + slotHeight / 2,
              z: zone.position.z + row * slotDepth + slotDepth / 2,
            },
            occupied: false,
            itemId: undefined,
          })
        }
      }
    }
  }

  return slots
}

function buildItems(
  quants: QueryRows,
  slotsByLocationId: Map<string, StorageSlot>,
  zoneByLocationId: Map<string, string>,
  productNames: Map<string, string>,
  productSkus: Map<string, string>,
): StockItem[] {
  return quants
    .filter((q) => Number(q.quantity ?? 0) > 0)
    .map((q) => {
      const locId = String(q.locationId ?? "")
      const slot = slotsByLocationId.get(locId)
      const zoneId = slot?.zoneId ?? zoneByLocationId.get(locId) ?? "unknown"
      const pid = String(q.productId ?? "")
      return {
        id: String(q.id),
        sku: productSkus.get(pid) ?? `SKU-${q.productId}`,
        name: productNames.get(pid) ?? `Product ${q.productId}`,
        category: "finished-goods" as StockCategory,
        quantity: Number(q.quantity ?? 0),
        slotId: slot?.id ?? locId,
        zoneId,
        lastUpdated: q.inDate ? new Date(Number(q.inDate) / 1000) : new Date(),
        minStock: undefined,
        maxStock: undefined,
      }
    })
}

export function buildWarehouse3DView(
  warehouseId: bigint,
  zones3D: QueryRows,
  allLocations: QueryRows,
  allQuants: QueryRows,
  productById: Map<string, { name: string; sku: string }>,
): { zones: Zone[]; slots: StorageSlot[]; items: StockItem[] } {
  const wid = String(warehouseId)
  const filteredZones = zones3D.filter(
    (z) => String(z.warehouseId) === wid && z.isActive !== false,
  )

  const locationById = new Map(allLocations.map((l) => [String(l.id), l]))
  const productNames = new Map<string, string>()
  const productSkus = new Map<string, string>()
  for (const [id, p] of productById) {
    productNames.set(id, p.name)
    productSkus.set(id, p.sku)
  }

  const zones: Zone[] = []
  const slotsByLocationId = new Map<string, StorageSlot>()
  const zoneByLocationId = new Map<string, string>()
  const allSlots: StorageSlot[] = []

  for (const zone3D of filteredZones) {
    const rootLocation = locationById.get(String(zone3D.locationId))
    if (!rootLocation) continue

    const zone = buildZone(zone3D, rootLocation)
    zones.push(zone)

    const children = allLocations.filter(
      (l) => l.locationId != null && String(l.locationId) === String(rootLocation.id),
    )

    const slots = buildSlots(zone, children)
    for (const slot of slots) {
      allSlots.push(slot)
      slotsByLocationId.set(slot.id, slot)
      zoneByLocationId.set(slot.id, zone.id)
    }
  }

  const relevantQuants = allQuants.filter((q) => slotsByLocationId.has(String(q.locationId)))

  for (const q of relevantQuants) {
    const slot = slotsByLocationId.get(String(q.locationId))
    if (slot && Number(q.quantity ?? 0) > 0) {
      slot.occupied = true
      slot.itemId = String(q.id)
    }
  }

  const items = buildItems(relevantQuants, slotsByLocationId, zoneByLocationId, productNames, productSkus)

  return { zones, slots: allSlots, items }
}
