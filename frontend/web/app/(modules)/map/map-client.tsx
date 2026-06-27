"use client"

import dynamic from "next/dynamic"
import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  FormModal,
  MapLayerLegend,
  MissingOrganization,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  type FormConfig,
} from "@lumiere/ui"
import { defaultMapLayers } from "@lumiere/ui/lib/map-pin-configs"
import type { MapPinData } from "@lumiere/ui/lib/map-types"
import { Warehouse, Truck, Monitor, Package, TrendingUp, MapPin } from "lucide-react"
import { useFleetVehicles, usePosTerminals, useWarehouseGeo } from "@lumiere/query-hooks/hooks/map"
import {
  useCreateFleetVehicle,
  useUpdateVehiclePosition,
} from "@lumiere/query-hooks/hooks/fleet"
import { fleetVehicleRowsToSelectOptions } from "@/lib/form-lookup"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

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

type FleetMapAction = "createVehicle" | "updatePosition"

const fleetMapFormIds = {
  createVehicle: "fleet-create-vehicle",
  updatePosition: "fleet-update-position",
} as const

function fleetMapForms(t: (key: string) => string): Record<FleetMapAction, FormConfig> {
  return {
    createVehicle: {
      id: fleetMapFormIds.createVehicle,
      title: t("map.fleet.create"),
      submitLabel: t("map.fleet.create"),
      sections: [
        {
          id: "vehicle",
          fields: [
            { id: "vehicle-name", type: "text", name: "name", label: "Name", required: true },
            { id: "vehicle-type", type: "text", name: "vehicleType", label: "Vehicle type", required: true },
            { id: "license-plate", type: "text", name: "licensePlate", label: "License plate", width: "1/2" },
            { id: "driver-name", type: "text", name: "driverName", label: "Driver name", width: "1/2" },
          ],
        },
      ],
    },
    updatePosition: {
      id: fleetMapFormIds.updatePosition,
      title: t("map.fleet.updatePosition"),
      submitLabel: t("map.fleet.updatePosition"),
      sections: [
        {
          id: "vehicle-select",
          fields: [
            {
              id: "vehicle-id",
              type: "select",
              name: "vehicleId",
              label: t("map.fleet.selectVehicle"),
              required: true,
              width: "full",
              options: [],
            },
          ],
        },
        {
          id: "position",
          fields: [
            { id: "vehicle-lat", type: "number", name: "latitude", label: "Latitude", required: true, width: "1/2" },
            { id: "vehicle-lng", type: "number", name: "longitude", label: "Longitude", required: true, width: "1/2" },
            { id: "vehicle-speed", type: "number", name: "speedKmh", label: "Speed km/h", width: "1/3" },
            { id: "vehicle-heading", type: "number", name: "heading", label: "Heading", width: "1/3" },
            { id: "vehicle-status", type: "text", name: "status", label: "Status", required: true, width: "1/3" },
          ],
        },
      ],
    },
  }
}

interface MapClientProps {
  organizationId?: number
}

export function MapClient(props: MapClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <MapClientLoaded {...props} organizationId={props.organizationId} />
}

function MapClientLoaded({ organizationId }: { organizationId: number }) {
  const { orgId } = orgBigInts(organizationId)
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    () => new Set(defaultMapLayers.filter((l) => l.defaultVisible !== false).map((l) => l.id))
  )
  const { t } = useTranslation()
  const { data: vehicles = [] } = useFleetVehicles(orgId)
  const { data: posTerminals = [] } = usePosTerminals(orgId)
  const { data: warehouseGeos = [] } = useWarehouseGeo(orgId)
  const createFleetVehicle = useCreateFleetVehicle(orgId)
  const updateVehiclePosition = useUpdateVehiclePosition(orgId)
  const [fleetAction, setFleetAction] = useState<FleetMapAction | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [vehicleError, setVehicleError] = useState<string | null>(null)

  const vehicleOptions = useMemo(() => {
    const fromApi = fleetVehicleRowsToSelectOptions(vehicles as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("map.fleet.empty"), disabled: true }]
  }, [vehicles, t])

  const fleetFormConfig = useMemo(() => {
    if (!fleetAction) return null
    const base = fleetMapForms(t)[fleetAction]
    if (fleetAction === "updatePosition") {
      let config = mergeSelectOptionsForFields(base, { vehicleId: vehicleOptions })
      if (selectedVehicleId) {
        config = mergeFieldDefaultValues(config, { vehicleId: selectedVehicleId })
      }
      return config
    }
    return base
  }, [fleetAction, t, vehicleOptions, selectedVehicleId])

  const demoPinsByLayer = useMemo(() => {
    const grouped = Object.fromEntries(defaultMapLayers.map((l) => [l.id, [] as MapPinData[]])) as Record<
      string,
      MapPinData[]
    >
    for (const pin of DEMO_PINS) {
      grouped[pin.layerId]?.push(pin)
    }
    return grouped
  }, [])

  // Build live pins per layer; fall back to demo pins only for empty layers
  const livePins: MapPinData[] = useMemo(() => {
    const vehiclePins: MapPinData[] = vehicles
      .filter((v) => v.latitude != null && v.longitude != null)
      .map((v) => ({
        id: `veh-${v.id}`,
        layerId: "vehicle",
        lat: Number(v.latitude),
        lng: Number(v.longitude),
        label: String(v.name ?? ""),
        data: {
          name: String(v.name ?? ""),
          driver: String(v.driverName ?? "—"),
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
        label: String(p.name ?? ""),
        data: {
          name: String(p.name ?? ""),
          location: String(p.locationLabel ?? "—"),
          status: String(p.status ?? "closed").toLowerCase(),
          daily_revenue: Number(p.dailyRevenue ?? 0),
          open_orders: Number(p.openOrders ?? 0),
        },
      }))

    const warehousePins: MapPinData[] = warehouseGeos.map((wg) => {
      const fallback = t("map.warehouseFallback", { id: wg.warehouseId })
      const cityStr = wg.city != null && String(wg.city) !== "" ? String(wg.city) : fallback
      return {
        id: `wh-${wg.warehouseId}`,
        layerId: "warehouse",
        lat: Number(wg.latitude),
        lng: Number(wg.longitude),
        label: cityStr,
        data: {
          name: cityStr,
          city: wg.city != null && String(wg.city) !== "" ? String(wg.city) : "—",
          manager: String(wg.managerName ?? "—"),
          stock_value: 0,
          total_products: 0,
        },
      }
    })

    const layerPins = (layerId: string, live: MapPinData[]) =>
      live.length > 0 ? live : (demoPinsByLayer[layerId] ?? [])

    return [
      ...layerPins("vehicle", vehiclePins),
      ...layerPins("pos", posPins),
      ...layerPins("warehouse", warehousePins),
    ]
  }, [t, vehicles, posTerminals, warehouseGeos, demoPinsByLayer])

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
  const isFleetPending = createFleetVehicle.isPending || updateVehiclePosition.isPending

  const handleCreateFleetVehicle = async (data: Record<string, unknown>) => {
    setVehicleError(null)
    try {
      await createFleetVehicle.mutateAsync({
        name: String(data.name ?? "Fleet Vehicle"),
        vehicleType: String(data.vehicleType ?? "truck"),
        licensePlate: data.licensePlate != null && String(data.licensePlate).trim() !== "" ? String(data.licensePlate) : null,
        driverName: data.driverName != null && String(data.driverName).trim() !== "" ? String(data.driverName) : null,
      })
      setFleetAction(null)
    } catch (e) {
      setVehicleError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  const handleUpdateVehiclePosition = async (data: Record<string, unknown>) => {
    setVehicleError(null)
    try {
      const vehicleId = data.vehicleId ?? selectedVehicleId
      if (vehicleId == null || String(vehicleId).trim() === "") {
        throw new Error(t("map.fleet.selectVehicle"))
      }
      await updateVehiclePosition.mutateAsync({
        vehicleId: String(vehicleId),
        latitude: Number(data.latitude) || 0,
        longitude: Number(data.longitude) || 0,
        speedKmh: Number(data.speedKmh) || 0,
        heading: Number(data.heading) || 0,
        status: String(data.status ?? "active"),
      })
      setFleetAction(null)
    } catch (e) {
      setVehicleError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  const handleFleetSubmit = async (data: Record<string, unknown>) => {
    if (fleetAction === "createVehicle") await handleCreateFleetVehicle(data)
    else if (fleetAction === "updatePosition") await handleUpdateVehiclePosition(data)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">{t("map.title")}</h1>
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
        <div className="relative min-h-0 flex-1" data-testid="map-view">
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
            {t("map.summary")}
          </p>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("map.fleet.title")}
            </p>
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
              disabled={isFleetPending}
              onClick={() => setFleetAction("createVehicle")}
            >
              {t("map.fleet.create")}
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
              disabled={isFleetPending || vehicles.length === 0}
              onClick={() => setFleetAction("updatePosition")}
            >
              {t("map.fleet.updatePosition")}
            </button>
            <div className="max-h-40 space-y-1 overflow-y-auto pt-1">
              {vehicles.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("map.fleet.empty")}</p>
              ) : (
                (vehicles as Record<string, unknown>[]).map((vehicle) => (
                  <button
                    key={String(vehicle.id)}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      setSelectedVehicleId(String(vehicle.id))
                      setFleetAction("updatePosition")
                    }}
                  >
                    <span className="truncate font-medium">{String(vehicle.name ?? vehicle.id)}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">
                      {String(vehicle.status ?? "idle")}
                    </span>
                  </button>
                ))
              )}
            </div>
            {vehicleError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {vehicleError}
              </p>
            ) : null}
          </div>

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
                {t("map.totalStockValue")}
              </div>
              <p className="mt-0.5 text-sm font-semibold">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalStockValue)}
              </p>
            </div>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Truck className="size-3" />
                {t("map.activeVehicles")}
              </div>
              <p className="mt-0.5 text-sm font-semibold">{activeVehicles} / {livePins.filter(p => p.layerId === "vehicle").length}</p>
            </div>

            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <TrendingUp className="size-3" />
                {t("map.openPOS")}
              </div>
              <p className="mt-0.5 text-sm font-semibold">{openPos} / {livePins.filter(p => p.layerId === "pos").length}</p>
            </div>
          </div>

          <div className="mt-auto rounded-md bg-muted/50 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
            {isLiveData
              ? t("map.liveDataHint")
              : t("map.demoDataHint")}
          </div>
        </aside>
      </div>
      {fleetAction && fleetFormConfig ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setFleetAction(null)}
          config={fleetFormConfig}
          isPending={isFleetPending}
          submitError={vehicleError}
          onSubmit={handleFleetSubmit}
        />
      ) : null}
    </div>
  )
}
