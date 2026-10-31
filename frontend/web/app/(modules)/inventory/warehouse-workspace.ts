import type { TFunction } from "i18next";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type {
  EntityColumn,
  EntityDetailConfig,
  EntityRow,
  EntitySurfacePermission,
  EntityViewConfig,
} from "@lumiere/ui/lib/entity-view-types";
import { getRowField, unwrapEntityValue } from "@lumiere/ui/lib/entity-row-values";
import { mergeModuleStates, type ModuleDataState } from "@lumiere/ui/lib/module-data-state";
import type { ModuleConfig } from "@lumiere/ui/lib/module-types";

export const WAREHOUSE_TAB_IDS = [
  "stock", "lots", "serials", "transfers", "stock-moves", "adjustments",
  "cycle-counts", "cycle-wizard", "warehouses", "locations", "replenishment",
] as const;

const CREATE_PERMISSIONS: Readonly<Record<string, EntitySurfacePermission>> = {
  stock: { resource: "stock_quant", action: "create" },
  transfers: { resource: "stock_picking", action: "create" },
  warehouses: { resource: "warehouse", action: "create" },
  locations: { resource: "stock_location", action: "create" },
  adjustments: { resource: "inventory_adjustment", action: "create" },
  replenishment: { resource: "replenishment_rule", action: "create" },
};

// These are presentation gates for existing native owners, never command authority.
const ACTION_PERMISSIONS: Readonly<Record<string, EntitySurfacePermission>> = {
  "csv-warehouse": { resource: "warehouse", action: "create" },
  "edit-warehouse": { resource: "warehouse", action: "write" },
  "delete-warehouse": { resource: "warehouse", action: "delete" },
  "warehouse-geo": { resource: "warehouse_geo", action: "write" },
  "csv-stock-location": { resource: "stock_location", action: "create" },
  "edit-location": { resource: "stock_location", action: "write" },
  "delete-location": { resource: "stock_location", action: "delete" },
  "csv-stock-quant": { resource: "stock_quant", action: "create" },
  "move-stock-quant": { resource: "stock_quant", action: "write" },
  "reserve-qty": { resource: "stock_quant", action: "write" },
  "unreserve-qty": { resource: "stock_quant", action: "write" },
  "set-quant-qty": { resource: "stock_quant", action: "write" },
  "create-stock-inventory": { resource: "stock_inventory", action: "create" },
  "create-stock-inventory-line": { resource: "stock_inventory_line", action: "create" },
  "set-stock-inventory-state": { resource: "stock_inventory", action: "update" },
  "process-adjustment": { resource: "inventory_adjustment", action: "update" },
  "create-stock-move": { resource: "stock_move", action: "create" },
  "confirm-move": { resource: "stock_move", action: "write" },
  "assign-move": { resource: "stock_move", action: "write" },
  "done-move": { resource: "stock_move", action: "write" },
  "cancel-move": { resource: "stock_move", action: "write" },
  "csv-lot": { resource: "stock_production_lot", action: "create" },
  "create-lot": { resource: "stock_production_lot", action: "create" },
  "edit-lot-note": { resource: "stock_production_lot", action: "write" },
  "delete-lot": { resource: "stock_production_lot", action: "delete" },
  "create-serial": { resource: "stock_production_serial", action: "create" },
  "reserve-serial": { resource: "stock_production_serial", action: "write" },
  "use-serial": { resource: "stock_production_serial", action: "write" },
  "edit-serial-note": { resource: "stock_production_serial", action: "write" },
  "delete-serial": { resource: "stock_production_serial", action: "delete" },
  "open-cycle-wizard": { resource: "stock_cycle_count", action: "read" },
  "schedule-replenishment-run": { resource: "replenishment_rule", action: "write" },
  "cancel-replenishment-run": { resource: "replenishment_rule", action: "write" },
  "confirm-picking": { resource: "stock_picking", action: "write" },
  "assign-picking": { resource: "stock_picking", action: "write" },
  "assign-user-picking": { resource: "stock_picking", action: "write" },
  "partial-validate-picking": { resource: "stock_picking", action: "write" },
  "pack-picking": { resource: "stock_picking", action: "update" },
  "validate-picking": { resource: "stock_picking", action: "write" },
  "cancel-picking": { resource: "stock_picking", action: "write" },
};

const rowKey = (value: unknown): string | null => parseStrictU64(value)?.toString() ?? null;
const label = (value: unknown): string | null => {
  const scalar = unwrapEntityValue(value);
  return typeof scalar === "string" && scalar.trim() ? scalar.trim() : null;
};

function recordsById(rows: readonly EntityRow[]): Map<string, EntityRow> {
  const result = new Map<string, EntityRow>();
  for (const row of rows) {
    const id = rowKey(row.id);
    if (id !== null) result.set(id, row);
  }
  return result;
}

/** Add display references only: never calculate stock, change units, or replace command IDs. */
export function warehouseRows(
  rows: readonly EntityRow[],
  products: readonly EntityRow[],
  locations: readonly EntityRow[],
  units: readonly EntityRow[] = [],
): EntityRow[] {
  const productById = recordsById(products);
  const locationById = recordsById(locations);
  const unitById = recordsById(units);
  const locationName = (id: string | null) => {
    const location = id === null ? undefined : locationById.get(id);
    return location ? label(getRowField(location, "completeName")) ?? label(location.name) : null;
  };
  return rows.map((row) => {
    const productId = rowKey(getRowField(row, "productId"));
    const product = productId === null ? undefined : productById.get(productId);
    const locationId = rowKey(getRowField(row, "locationId"));
    const destinationId = rowKey(getRowField(row, "locationDestId"));
    // Historical movement/count units take priority over the product's current default.
    const unitId = rowKey(
      getRowField(row, "productUom") ?? getRowField(row, "uomId") ??
      (product ? getRowField(product, "uomId") : undefined),
    );
    const unit = unitId === null ? undefined : unitById.get(unitId);
    return {
      ...row,
      warehouseProductName: product ? label(product.name) : null,
      warehouseProductCode: product ? label(getRowField(product, "defaultCode")) : null,
      warehouseLocationId: locationId,
      warehouseLocationName: locationName(locationId),
      warehouseDestinationName: locationName(destinationId),
      warehouseUnitName: unit ? label(unit.name) : null,
      warehouseCountedQuantity: unwrapEntityValue(getRowField(row, "inventoryQuantitySet")) === true
        ? getRowField(row, "inventoryQuantity") ?? null
        : null,
    };
  });
}

const REFERENCE_COLUMNS: Readonly<Record<string, string>> = {
  productId: "warehouseProductName",
  locationId: "warehouseLocationName",
  locationDestId: "warehouseDestinationName",
};

/** Named stock references and location filtering retain the source table's operation owners. */
export function warehouseTable(
  config: EntityViewConfig,
  tabId: string,
  locations: readonly EntityRow[],
  t: TFunction,
): EntityViewConfig {
  if (config.view.mode !== "table") return config;
  const view = config.view;
  const unavailable = t("inventory.warehouseWorkspace.referenceUnavailable", { defaultValue: "Unavailable" });
  const referenceColumn = (column: EntityColumn): EntityColumn => {
    const key = REFERENCE_COLUMNS[column.key];
    if (!key) return column;
    return {
      ...column,
      key,
      label: column.key === "productId" ? t("inventory.byRecord.product") : column.label,
      type: "text",
      width: "min-w-36",
      inlineEdit: undefined,
      render: (value) => label(value) ?? unavailable,
    };
  };
  let columns = view.columns.map(referenceColumn);
  if (tabId === "stock") {
    const product = columns.find((column) => column.key === "warehouseProductName");
    const location = columns.find((column) => column.key === "warehouseLocationName");
    const counted = columns.find((column) => column.key === "inventoryQuantity");
    columns = [
      ...(product ? [product] : []),
      { key: "warehouseProductCode", label: t("inventory.products.columns.defaultCode"), width: "min-w-24" },
      ...(location ? [location] : []),
      { key: "warehouseUnitName", label: t("inventory.byRecord.uom"), render: (value) => label(value) ?? unavailable },
      { key: "quantity", label: t("inventory.stockOnHand.columns.inventoryQuantity"), type: "number", align: "right", sortable: true },
      ...columns.filter((column) => !["warehouseProductName", "warehouseLocationName", "inventoryQuantity", "quantity"].includes(column.key)),
      ...(counted ? [{
        ...counted,
        key: "warehouseCountedQuantity",
        label: t("inventory.warehouseWorkspace.counted", { defaultValue: "Counted" }),
        render: (value: unknown) => value == null ? unavailable : String(unwrapEntityValue(value)),
      }] : []),
    ];
  } else if (tabId === "stock-moves") {
    columns = [...columns, { key: "warehouseUnitName", label: t("inventory.byRecord.uom"), render: (value) => label(value) ?? unavailable }];
  }
  const namedReferences = view.columns.some((column) => column.key in REFERENCE_COLUMNS);
  const locationOptions = [...recordsById(locations)].flatMap(([value, location]) => {
    const name = label(getRowField(location, "completeName")) ?? label(location.name);
    return name ? [{ value, label: name }] : [];
  });
  return {
    ...config,
    view: {
      ...view,
      columns,
      searchable: namedReferences || view.searchable,
      searchPlaceholder: tabId === "stock"
        ? t("inventory.warehouseWorkspace.searchStock", { defaultValue: "Search products, SKU or locations…" })
        : view.searchPlaceholder,
      searchKeys: namedReferences
        ? [...new Set([...(view.searchKeys ?? []), "warehouseProductName", "warehouseProductCode", "warehouseLocationName", "warehouseDestinationName"])]
        : view.searchKeys,
      filters: tabId === "stock"
        ? [...(view.filters ?? []), { key: "warehouseLocationId", label: t("inventory.byRecord.location"), type: "select", faceted: true, options: locationOptions }]
        : view.filters,
      // Native `execute` is not yet an Action in the shared RBAC presentation model.
      // Keep immediate execution out of this bounded workspace until its exact gate exists.
      actions: view.actions?.filter((action) => action.id !== "execute-replenishment-rule").map((action) => {
        const permission = action.permission ?? ACTION_PERMISSIONS[action.id];
        return permission ? { ...action, permission } : action;
      }),
    },
  };
}

/** Stock detail uses the same source quantity/count distinction and references as its list. */
export function warehouseStockDetail(config: EntityDetailConfig, t: TFunction): EntityDetailConfig {
  const unavailable = t("inventory.warehouseWorkspace.referenceUnavailable", { defaultValue: "Unavailable" });
  return {
    ...config,
    sections: config.sections.map((section) => section.id !== "stock" ? section : {
      ...section,
      fields: section.fields.flatMap((field): EntityDetailConfig["sections"][number]["fields"] => {
        if (field.key === "productId") return [{
          ...field,
          key: "warehouseProductName",
          label: t("inventory.byRecord.product"),
          type: "text" as const,
          render: (value: unknown) => label(value) ?? unavailable,
        }];
        if (field.key === "locationId") return [
          { ...field, key: "warehouseLocationName", type: "text" as const, render: (value: unknown) => label(value) ?? unavailable },
          { key: "warehouseUnitName", label: t("inventory.byRecord.uom"), type: "text" as const, render: (value: unknown) => label(value) ?? unavailable },
        ];
        if (field.key === "inventoryQuantity") return [
          { key: "quantity", label: t("inventory.stockOnHand.columns.inventoryQuantity"), type: "number" as const },
          {
            ...field,
            key: "warehouseCountedQuantity",
            label: t("inventory.warehouseWorkspace.counted", { defaultValue: "Counted" }),
            render: (value: unknown) => value == null ? unavailable : String(unwrapEntityValue(value)),
          },
        ];
        return [field];
      }),
    }),
  };
}

/** Bounded operational view of Inventory; no new persistence or workflow owner. */
export function warehouseWorkspace(
  config: ModuleConfig,
  t: TFunction,
  locations: readonly EntityRow[] = [],
): ModuleConfig {
  const tabs = WAREHOUSE_TAB_IDS.flatMap((id) => {
    const source = config.tabs.find((tab) => tab.id === id);
    if (!source) return [];
    return [{
      ...source,
      createPermission: source.createPermission ?? CREATE_PERMISSIONS[id],
      entityConfig: source.entityConfig ? warehouseTable(source.entityConfig, id, locations, t) : undefined,
    }];
  });
  const groups = [
    { id: "stock", label: t("modules.tabGroups.stock"), tabIds: ["stock", "lots", "serials"] },
    { id: "movements", label: t("modules.tabGroups.movements"), tabIds: ["transfers", "stock-moves"] },
    { id: "counts", label: t("inventory.warehouseWorkspace.counts", { defaultValue: "Counts" }), tabIds: ["adjustments", "cycle-counts", "cycle-wizard"] },
    { id: "setup", label: t("modules.tabGroups.setup"), tabIds: ["warehouses", "locations", "replenishment"] },
  ].map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => tabs.some((tab) => tab.id === id)) }))
    .filter((group) => group.tabIds.length > 0);
  return {
    ...config,
    id: "warehouse",
    title: t("modules.tabGroups.warehouse"),
    description: t("inventory.warehouseWorkspace.description", { defaultValue: "Stock by location, movements, counts and restocking" }),
    defaultTab: "stock",
    tabs,
    tabGroups: undefined,
    tabNavigation: undefined,
    workspaceNav: { label: t("modules.tabGroups.warehouse"), workspaces: groups },
    workBoard: undefined,
  };
}

/** Every joined workspace fails closed if a required source is absent, denied or failed. */
export function warehouseDataStates<T extends Record<string, ModuleDataState>>(states: T): T {
  const dependencies: Readonly<Record<string, readonly string[]>> = {
    stock: ["products", "locations", "uoms"],
    "stock-moves": ["products", "locations", "uoms"],
    lots: ["products"],
    serials: ["products", "locations"],
    adjustments: ["products", "locations", "uoms", "adjustment-reasons"],
    "cycle-counts": ["locations"],
    "cycle-wizard": ["products", "locations", "uoms", "cycle-counts"],
    replenishment: ["products", "locations", "uoms", "warehouses"],
  };
  const result = { ...states };
  for (const [tab, sources] of Object.entries(dependencies)) {
    if (!(tab in states)) continue;
    result[tab as keyof T] = mergeModuleStates(
      [tab, ...sources].map((source) => states[source] ?? { status: "error" }),
    ) as T[keyof T];
  }
  return result;
}
