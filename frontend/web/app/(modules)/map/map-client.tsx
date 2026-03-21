"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { MapLayerLegend } from "@lumiere/ui"
import { defaultMapLayers } from "@lumiere/ui/lib/map-pin-configs"
import type { MapPinData } from "@lumiere/ui/lib/map-types"
import { Warehouse, Truck, Monitor, Package, TrendingUp, MapPin } from "lucide-react"
import {
  useFleetVehicles,
  usePosTerminals,
  useWarehouseGeo,
  useStdbConnection,
  getStdbConnection,
  fleetSubscriptions,
} from "@lumiere/stdb"

// SSR-safe: import directly from file, not the barrel (leaflet needs browser APIs)
const MapView = dynamic(
  () => import("@lumiere/ui/map-components/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading map…</div> }
)

// ── Demo fallback (used when no live data exists yet) ─────────────────────────
const DEMO_PINS: MapPinData[] = [
  { id: "wh-1", layerId: "warehouse", lat: 40.7128, lng: -74.006, label: "NYC Main Warehouse", data: { name: "NYC Main Warehouse", city: "New York, NY", total_products: 1842, stock_value: 2450000, manager: "Sarah Chen" } },
  { id: "wh-2", layerId: "warehouse", lat: 34.0522, lng: -118.2437, label: "LA Distribution Center", data: { name: "LA Distribution Center", city: "Los Angeles, CA", total_products: 934, stock_value: 1120000, manager: "Marco Rivera" } },
  { id: "wh-3", layerId: "warehouse", lat: 51.5074, lng: -0.1278, label: "London Hub", data: { name: "London Hub", city: "London, UK", total_products: 621, stock_value: 890000, manager: "James Whitfield" } },
  { id: "wh-4", layerId: "warehouse", lat: 48.8566, lng: 2.3522, label: "Paris Depot", data: { name: "Paris Depot", city: "Paris, FR", total_products: 410, stock_value: 540000, manager: "Amélie Dubois" } },
  { id: "wh-5", layerId: "warehouse", lat: 35.6762, lng: 139.6503, label: "Tokyo Fulfillment", data: { name: "Tokyo Fulfillment", city: "Tokyo, JP", total_products: 756, stock_value: 1340000, manager: "Kenji Tanaka" } },
  { id: "veh-1", layerId: "vehicle", lat: 40.758, lng: -73.985, label: "Truck #101", data: { name: "Truck #101", driver: "Mike Johnson", status: "active", speed: 62, last_updated: "2 min ago" } },
  { id: "veh-2", layerId: "vehicle", lat: 34.073, lng: -118.28, label: "Van #204", data: { name: "Van #204", driver: "Lisa Nguyen", status: "idle", speed: 0, last_updated: "8 min ago" } },
  { id: "veh-3", layerId: "vehicle", lat: 51.52, lng: -0.09, label: "Truck #88", data: { name: "Truck #88", driver: "Tom Bradley", status: "active", speed: 48, last_updated: "1 min ago" } },
  { id: "veh-4", layerId: "vehicle", lat: 48.87, lng: 2.38, label: "Van #312", data: { name: "Van #312", driver: "Claire Martin", status: "maintenance", speed: 0, last_updated: "45 min ago" } },
  { id: "pos-1", layerId: "pos", lat: 40.752, lng: -73.978, label: "NYC Store — 5th Ave", data: { name: "NYC Store — 5th Ave", location: "5th Ave, New York", status: "open", daily_revenue: 18400, open_orders: 3 } },
  { id: "pos-2", layerId: "pos", lat: 34.061, lng: -118.253, label: "LA Showroom", data: { name: "LA Showroom", location: "Downtown LA", status: "open", daily_revenue: 9200, open_orders: 1 } },
  { id: "pos-3", layerId: "pos", lat: 51.513, lng: -0.135, label: "London Retail", data: { name: "London Retail", location: "Oxford St, London", status: "closed", daily_revenue: 14100, open_orders: 0 } },
  { id: "pos-4", layerId: "pos", lat: 48.862, lng: 2.342, label: "Paris Boutique", data: { name: "Paris Boutique", location: "Champs-Élysées, Paris", status: "open", daily_revenue: 7800, open_orders: 2 } },
  { id: "pos-5", layerId: "pos", lat: 35.682, lng: 139.762, label: "Tokyo Outlet", data: { name: "Tokyo Outlet", location: "Shibuya, Tokyo", status: "error", daily_revenue: 0, open_orders: 0 } },
]

// ── Stats sidebar ─────────────────────────────────────────────────────────────

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  warehouse: Warehouse,
  vehicle: Truck,
  pos: Monitor,
}

interface MapClientProps {
  organizationId?: number
}

export function MapClient({ organizationId }: MapClientProps) {
  const orgId = BigInt(organizationId ?? 1)
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    () => new Set(defaultMapLayers.filter((l) => l.defaultVisible !== false).map((l) => l.id))
  )
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] fleet subscription error", err))
      .subscribe(fleetSubscriptions(orgId))
  }, [connected, orgId])

  const { data: vehicles = [] } = useFleetVehicles(orgId)
  const { data: posTerminals = [] } = usePosTerminals(orgId)
  const { data: warehouseGeos = [] } = useWarehouseGeo(orgId)

  // Build live pins from SpacetimeDB data; fall back to demo if empty
  const livePins: MapPinData[] = useMemo(() => {
    const vehiclePins: MapPinData[] = vehicles
      .filter((v) => v.latitude != null && v.longitude != null)
      .map((v) => ({
        id: `veh-${v.id}`,
        layerId: "vehicle",
        lat: Number(v.latitude),
        lng: Number(v.longitude),
        label: v.name,
        data: {
          name: v.name,
          driver: v.driverName ?? "—",
          status: String(v.status ?? "idle").toLowerCase(),
          speed: Number(v.speedKmh ?? 0),
          last_updated: "live",
        },
      }))

    const posPins: MapPinData[] = posTerminals
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        id: `pos-${p.id}`,
        layerId: "pos",
        lat: Number(p.latitude),
        lng: Number(p.longitude),
        label: p.name,
        data: {
          name: p.name,
          location: p.locationLabel ?? "—",
          status: String(p.status ?? "closed").toLowerCase(),
          daily_revenue: Number(p.dailyRevenue ?? 0),
          open_orders: Number(p.openOrders ?? 0),
        },
      }))

    const warehousePins: MapPinData[] = warehouseGeos.map((wg) => ({
      id: `wh-${wg.warehouseId}`,
      layerId: "warehouse",
      lat: Number(wg.latitude),
      lng: Number(wg.longitude),
      label: wg.city ?? `Warehouse ${wg.warehouseId}`,
      data: {
        name: wg.city ?? `Warehouse ${wg.warehouseId}`,
        city: wg.city ?? "—",
        manager: wg.managerName ?? "—",
        stock_value: 0,
        total_products: 0,
      },
    }))

    const allLive = [...vehiclePins, ...posPins, ...warehousePins]
    return allLive.length > 0 ? allLive : DEMO_PINS
  }, [vehicles, posTerminals, warehouseGeos])

  const toggleLayer = (id: string) =>
    setVisibleLayers((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const stats = useMemo(() => {
    return defaultMapLayers.map((layer) => {
      const pins = livePins.filter((p) => p.layerId === layer.id)
      return { layer, total: pins.length }
    })
  }, [livePins])

  const totalStockValue = useMemo(() => {
    return livePins.filter((p) => p.layerId === "warehouse").reduce(
      (s, p) => s + Number(p.data.stock_value ?? 0), 0
    )
  }, [livePins])

  const activeVehicles = useMemo(
    () => livePins.filter((p) => p.layerId === "vehicle" && p.data.status === "active").length,
    [livePins]
  )

  const openPos = useMemo(
    () => livePins.filter((p) => p.layerId === "pos" && p.data.status === "open").length,
    [livePins]
  )

  const isLiveData = vehicles.length > 0 || posTerminals.length > 0 || warehouseGeos.length > 0

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Map Overview</h1>
        </div>
        <MapLayerLegend
          layers={defaultMapLayers}
          visibleLayers={visibleLayers}
          onToggle={toggleLayer}
        />
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative min-h-0 flex-1">
          <MapView
            pins={livePins}
            layers={defaultMapLayers}
            visibleLayers={visibleLayers}
            defaultCenter={[30, 10]}
            defaultZoom={2}
            className="h-full w-full"
          />
        </div>

        {/* Stats sidebar */}
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </p>

          {/* Layer counts */}
          <div className="space-y-2">
            {stats.map(({ layer, total }) => {
              const Icon = STAT_ICONS[layer.id]
              return (
                <div
                  key={layer.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex size-6 items-center justify-center rounded-md"
                      style={{ backgroundColor: layer.color + "22" }}
                    >
                      {Icon && <Icon className="size-3.5" style={{ color: layer.color }} />}
                    </span>
                    <span className="text-xs text-muted-foreground">{layer.label}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{total}</span>
                </div>
              )
            })}
          </div>

          <div className="my-1 border-t border-border" />

          {/* KPI cards */}
          <div className="space-y-2">
            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Package className="size-3" />
                Total Stock Value
              </div>
              <p className="mt-0.5 text-sm font-semibold">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalStockValue)}
              </p>
            </div>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Truck className="size-3" />
                Active Vehicles
              </div>
              <p className="mt-0.5 text-sm font-semibold">{activeVehicles} / {livePins.filter(p => p.layerId === "vehicle").length}</p>
            </div>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <TrendingUp className="size-3" />
                Open POS
              </div>
              <p className="mt-0.5 text-sm font-semibold">{openPos} / {livePins.filter(p => p.layerId === "pos").length}</p>
            </div>
          </div>

          <div className="mt-auto rounded-md bg-muted/50 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
            {isLiveData
              ? "Live data from SpacetimeDB. Use fleet reducers to update GPS positions."
              : "Demo data — add fleet vehicles, POS terminals, and warehouse geo in SpacetimeDB to populate real coordinates."}
          </div>
        </aside>
      </div>
    </div>
  )
}
