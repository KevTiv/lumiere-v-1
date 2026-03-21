import type { MapLayerConfig } from "./map-types"

export const warehouseLayer: MapLayerConfig = {
  id: "warehouse",
  label: "Warehouses",
  color: "#3b82f6",
  icon: "Warehouse",
  defaultVisible: true,
  fields: [
    { key: "name", label: "Name", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "total_products", label: "SKUs", type: "number" },
    { key: "stock_value", label: "Stock Value", type: "currency" },
    { key: "manager", label: "Manager", type: "text" },
  ],
}

export const vehicleLayer: MapLayerConfig = {
  id: "vehicle",
  label: "Vehicles",
  color: "#f59e0b",
  icon: "Truck",
  defaultVisible: true,
  fields: [
    { key: "name", label: "Vehicle", type: "text" },
    { key: "driver", label: "Driver", type: "text" },
    {
      key: "status",
      label: "Status",
      type: "badge",
      badgeVariants: { active: "default", idle: "secondary", maintenance: "destructive" },
      badgeLabels: { active: "Active", idle: "Idle", maintenance: "Maintenance" },
    },
    { key: "speed", label: "Speed (km/h)", type: "number" },
    { key: "last_updated", label: "Last Update", type: "text" },
  ],
}

export const posLayer: MapLayerConfig = {
  id: "pos",
  label: "POS Terminals",
  color: "#10b981",
  icon: "Monitor",
  defaultVisible: true,
  fields: [
    { key: "name", label: "Terminal", type: "text" },
    { key: "location", label: "Location", type: "text" },
    {
      key: "status",
      label: "Status",
      type: "badge",
      badgeVariants: { open: "default", closed: "secondary", error: "destructive" },
      badgeLabels: { open: "Open", closed: "Closed", error: "Error" },
    },
    { key: "daily_revenue", label: "Today's Revenue", type: "currency" },
    { key: "open_orders", label: "Open Orders", type: "number" },
  ],
}

export const defaultMapLayers: MapLayerConfig[] = [warehouseLayer, vehicleLayer, posLayer]
