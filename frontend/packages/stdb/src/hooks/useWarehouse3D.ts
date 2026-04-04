/**
 * useWarehouse3D — transforms SpacetimeDB inventory data into the Zone/Slot/Item
 * types consumed by the <WarehouseViewer> 3D component.
 *
 * Data flow:
 *   Warehouse3DZone (metadata) + StockLocation (parent) → Zone
 *   StockLocation children of each zone's root location → StorageSlot[]
 *   StockQuant + Product → StockItem[]
 *
 * NOTE: Warehouse3DZone generated bindings are produced after running:
 *   spacetime publish lumiere --module-path spacetimedb
 *   spacetime generate --lang typescript --out-dir frontend/packages/stdb/src/generated --module-path spacetimedb
 */
import { useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { getStdbConnection } from "../connection";
import {
  queryStockLocations,
  queryStockQuants,
  queryWarehouse3DZones,
} from "../queries/inventory";
import type { StockLocation, StockQuant } from "../queries/inventory";
import type {
  Zone,
  StorageSlot,
  StockItem,
  ZoneType,
  StockCategory,
} from "../warehouse-3d-types";

// ── Internal helpers ──────────────────────────────────────────────────────────

function toZoneType(displayType: string | undefined): ZoneType {
  switch (displayType?.toLowerCase()) {
    case "rack":
      return "rack";
    case "floor":
      return "floor";
    case "bin":
      return "bin";
    default:
      return "rack";
  }
}

/** Build Zone from a Warehouse3DZone row + its linked StockLocation */
function buildZone(
  zone3D: ReturnType<typeof queryWarehouse3DZones>[number],
  location: StockLocation,
): Zone {
  return {
    id: String(zone3D.id),
    warehouseId: String(zone3D.warehouseId),
    name: location.completeName ?? location.name ?? `Zone ${zone3D.id}`,
    type: toZoneType(zone3D.displayType?.tag ?? zone3D.displayType),
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
    color: zone3D.color ?? "#0e7490",
  };
}

/** Build StorageSlots for all child locations of a zone */
function buildSlots(zone: Zone, childLocations: StockLocation[]): StorageSlot[] {
  const slots: StorageSlot[] = [];
  const { width, height, depth } = zone.dimensions;
  const slotWidth = width / zone.columns;
  const slotHeight = height / zone.levels;
  const slotDepth = depth / zone.rows;

  // If the locations have explicit 3D positions, use them; otherwise generate a grid
  if (childLocations.length > 0 && childLocations.some((l) => l.posx || l.posy || l.posz)) {
    for (const loc of childLocations) {
      const px = Number(loc.posx ?? 0);
      const py = Number(loc.posy ?? 0);
      const pz = Number(loc.posz ?? 0);

      const col = Math.max(0, Math.min(zone.columns - 1, Math.round((px - zone.position.x) / slotWidth)));
      const level = Math.max(0, Math.min(zone.levels - 1, Math.round((py - zone.position.y) / slotHeight)));
      const row = Math.max(0, Math.min(zone.rows - 1, Math.round((pz - zone.position.z) / slotDepth)));

      slots.push({
        id: String(loc.id),
        zoneId: zone.id,
        row,
        column: col,
        level,
        position: { x: px, y: py, z: pz },
        occupied: false,
        itemId: undefined,
      });
    }
  } else {
    // Generate a full grid (used when no child locations exist yet)
    for (let row = 0; row < zone.rows; row++) {
      for (let col = 0; col < zone.columns; col++) {
        for (let level = 0; level < zone.levels; level++) {
          const slotId = `${zone.id}-${row}-${col}-${level}`;
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
          });
        }
      }
    }
  }

  return slots;
}

/** Build StockItems from StockQuant rows */
function buildItems(
  quants: StockQuant[],
  slotsByLocationId: Map<string, StorageSlot>,
  zoneByLocationId: Map<string, string>,
  productNames: Map<string, string>,
  productSkus: Map<string, string>,
): StockItem[] {
  return quants
    .filter((q) => q.quantity > 0)
    .map((q) => {
      const locId = String(q.locationId);
      const slot = slotsByLocationId.get(locId);
      const zoneId = slot?.zoneId ?? zoneByLocationId.get(locId) ?? "unknown";

      return {
        id: String(q.id),
        sku: productSkus.get(String(q.productId)) ?? `SKU-${q.productId}`,
        name: productNames.get(String(q.productId)) ?? `Product ${q.productId}`,
        category: "finished-goods" as StockCategory,
        quantity: Number(q.quantity),
        slotId: slot?.id ?? locId,
        zoneId,
        lastUpdated: q.inDate ? new Date(Number(q.inDate) / 1000) : new Date(),
        minStock: undefined,
        maxStock: undefined,
      };
    });
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export interface UseWarehouse3DResult {
  zones: Zone[];
  slots: StorageSlot[];
  items: StockItem[];
  isLoading: boolean;
}

export function useWarehouse3D(
  organizationId: bigint,
  companyId: bigint,
  warehouseId: bigint,
): UseWarehouse3DResult {
  const queryClient = useQueryClient();
  const queryKey = ["warehouse-3d", warehouseId.toString()];

  // Subscribe to real-time updates from all relevant tables
  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;

    const reload = () => queryClient.invalidateQueries({ queryKey });

    conn.db.stock_location.onInsert((_ctx, _row) => reload());
    conn.db.stock_location.onUpdate((_ctx, _old, _new) => reload());
    conn.db.stock_quant.onInsert((_ctx, _row) => reload());
    conn.db.stock_quant.onUpdate((_ctx, _old, _new) => reload());
    conn.db.stock_quant.onDelete((_ctx, _row) => reload());

    // warehouse_3d_zone subscription (available after bindings regeneration)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = conn.db as any;
      db.warehouse_3d_zone.onInsert((_ctx: unknown, _row: unknown) => reload());
      db.warehouse_3d_zone.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
      db.warehouse_3d_zone.onDelete((_ctx: unknown, _row: unknown) => reload());
    } catch {
      // bindings not yet generated — will work after `spacetime generate`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, warehouseId.toString()]);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => {
      const zones3D = queryWarehouse3DZones(warehouseId);
      const allLocations = queryStockLocations();
      const allQuants = queryStockQuants();

      // Build product lookup from conn.db directly
      const conn = getStdbConnection();
      const productNames = new Map<string, string>();
      const productSkus = new Map<string, string>();
      if (conn) {
        for (const p of conn.db.product.iter()) {
          productNames.set(String(p.id), p.name ?? "");
          productSkus.set(String(p.id), p.defaultCode ?? "");
        }
      }

      // Build location lookup
      const locationById = new Map(allLocations.map((l) => [String(l.id), l]));

      // Build Zone[] from zones3D
      const zones: Zone[] = [];
      const slotsByLocationId = new Map<string, StorageSlot>();
      const zoneByLocationId = new Map<string, string>();
      const allSlots: StorageSlot[] = [];

      for (const zone3D of zones3D) {
        const rootLocation = locationById.get(String(zone3D.locationId));
        if (!rootLocation) continue;

        const zone = buildZone(zone3D, rootLocation);
        zones.push(zone);

        // Find child locations of this zone's root location
        const children = allLocations.filter(
          (l) => l.locationId !== null && String(l.locationId) === String(rootLocation.id),
        );

        const slots = buildSlots(zone, children);

        for (const slot of slots) {
          allSlots.push(slot);
          slotsByLocationId.set(slot.id, slot);
          zoneByLocationId.set(slot.id, zone.id);
        }
      }

      // Filter quants to those at locations within our warehouse zones
      const relevantQuants = allQuants.filter((q) =>
        slotsByLocationId.has(String(q.locationId)),
      );

      // Mark slots as occupied
      for (const q of relevantQuants) {
        const slot = slotsByLocationId.get(String(q.locationId));
        if (slot && q.quantity > 0) {
          slot.occupied = true;
          slot.itemId = String(q.id);
        }
      }

      const items = buildItems(
        relevantQuants,
        slotsByLocationId,
        zoneByLocationId,
        productNames,
        productSkus,
      );

      return { zones, slots: allSlots, items };
    },
    staleTime: Infinity,
    placeholderData: { zones: [], slots: [], items: [] },
  });

  return {
    zones: data?.zones ?? [],
    slots: data?.slots ?? [],
    items: data?.items ?? [],
    isLoading,
  };
}

// ── Action hooks ──────────────────────────────────────────────────────────────

export function useMoveStockItem3D(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      quantId,
      targetLocationId,
      quantity,
    }: {
      quantId: bigint;
      targetLocationId: bigint;
      quantity: number;
    }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return conn.reducers.moveStockQuant({
        organizationId,
        quantId,
        params: {
          companyId: undefined,
          destLocationId: targetLocationId,
          quantity,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-quants"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-3d"] });
    },
  });
}

export function useCreateWarehouse3DZone(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      warehouseId,
      locationId,
      params,
    }: {
      warehouseId: bigint;
      locationId: bigint;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: any; // CreateWarehouse3DZoneParams — available after bindings regeneration
    }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return conn.reducers.createWarehouse3DZone({
        organizationId,
        warehouseId,
        locationId,
        params,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-3d"] });
    },
  });
}
