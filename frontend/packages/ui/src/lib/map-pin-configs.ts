import { i18n as uiI18n } from "@lumiere/i18n"
import type { MapLayerConfig } from "./map-types"

export const warehouseLayer: MapLayerConfig = {
  id: "warehouse",
  get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.warehouse.label", { defaultValue: "Warehouses" }) },
  color: "#3b82f6",
  icon: "Warehouse",
  defaultVisible: true,
  fields: [
    { key: "name", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.name.label", { defaultValue: "Name" }) }, type: "text" },
    { key: "city", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.city.label", { defaultValue: "City" }) }, type: "text" },
    { key: "total_products", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.totalProducts.label", { defaultValue: "SKUs" }) }, type: "number" },
    { key: "stock_value", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.stockValue.label", { defaultValue: "Stock Value" }) }, type: "currency" },
    { key: "manager", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.warehouseLayer.manager.label", { defaultValue: "Manager" }) }, type: "text" },
  ],
}

export const vehicleLayer: MapLayerConfig = {
  id: "vehicle",
  get label() { return uiI18n.t("map.fleet.subtitle", { defaultValue: "Vehicles" }) },
  color: "#f59e0b",
  icon: "Truck",
  defaultVisible: true,
  fields: [
    { key: "name", get label() { return uiI18n.t("map.fleet.lifecycle.vehicle", { defaultValue: "Vehicle" }) }, type: "text" },
    { key: "driver", get label() { return uiI18n.t("map.fleet.table.driverName", { defaultValue: "Driver" }) }, type: "text" },
    {
      key: "status",
      get label() { return uiI18n.t("map.fleet.table.status", { defaultValue: "Status" }) },
      type: "badge",
      badgeVariants: { active: "default", idle: "secondary", maintenance: "destructive" },
      badgeLabels: { get active() { return uiI18n.t("common.active", { defaultValue: "Active" }) }, get idle() { return uiI18n.t("map.fleet.status.idle", { defaultValue: "Idle" }) }, get maintenance() { return uiI18n.t("map.fleet.status.maintenance", { defaultValue: "Maintenance" }) } },
    },
    { key: "speed", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.vehicleLayer.speed.label", { defaultValue: "Speed (km/h)" }) }, type: "number" },
    { key: "last_updated", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.vehicleLayer.lastUpdated.label", { defaultValue: "Last Update" }) }, type: "text" },
  ],
}

export const posLayer: MapLayerConfig = {
  id: "pos",
  get label() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.pos.label", { defaultValue: "POS Terminals" }) },
  color: "#10b981",
  icon: "Monitor",
  defaultVisible: true,
  fields: [
    { key: "name", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.name.label", { defaultValue: "Terminal" }) }, type: "text" },
    { key: "location", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.location.label", { defaultValue: "Location" }) }, type: "text" },
    {
      key: "status",
      get label() { return uiI18n.t("map.fleet.table.status", { defaultValue: "Status" }) },
      type: "badge",
      badgeVariants: { open: "default", closed: "secondary", error: "destructive" },
      badgeLabels: { get open() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.badgeLabels.open", { defaultValue: "Open" }) }, get closed() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.badgeLabels.closed", { defaultValue: "Closed" }) }, get error() { return uiI18n.t("common.error.title", { defaultValue: "Error" }) } },
    },
    { key: "daily_revenue", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.dailyRevenue.label", { defaultValue: "Today's Revenue" }) }, type: "currency" },
    { key: "open_orders", get label() { return uiI18n.t("map.builtIn.mapPinConfigs.posLayer.openOrders.label", { defaultValue: "Open Orders" }) }, type: "number" },
  ],
}

export const defaultMapLayers: MapLayerConfig[] = [warehouseLayer, vehicleLayer, posLayer]
