import assert from "node:assert/strict";
import test from "node:test";
import type { TFunction } from "i18next";
import type { EntityViewConfig } from "@lumiere/ui/lib/entity-view-types";
import { moduleCollection, type ModuleDataState } from "@lumiere/ui/lib/module-data-state";
import type { ModuleConfig } from "@lumiere/ui/lib/module-types";
import { moduleTabDestination } from "@/lib/module-tab-navigation";
import { WAREHOUSE_TAB_IDS, warehouseDataStates, warehouseRows, warehouseStockDetail, warehouseTable, warehouseWorkspace } from "./warehouse-workspace";

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction;
const ready: ModuleDataState = { status: "ready" };

test("warehouse joins preserve exact identifiers, source quantities and historical units", () => {
  const source = {
    id: 4n,
    product_id: "90071992547409931",
    location_id: { some: "90071992547409932" },
    location_dest_id: 7n,
    product_uom: 3n,
    quantity: "0.000001",
    inventory_quantity: 0,
    inventory_quantity_set: true,
    available_quantity: "-2.125",
    product_uom_qty: "24.75",
  };
  const [row] = warehouseRows(
    [source],
    [{ id: "90071992547409931", name: "Coffee", default_code: "COF-01", uom_id: 2n }],
    [{ id: "90071992547409932", complete_name: "Main / Shelf 1" }, { id: 7n, name: "Packing" }],
    [{ id: 2n, name: "Kilogram" }, { id: 3n, name: "Gram" }],
  );
  assert.equal(row?.id, source.id);
  assert.equal(row?.product_id, source.product_id);
  assert.equal(row?.location_id, source.location_id);
  assert.equal(row?.warehouseProductName, "Coffee");
  assert.equal(row?.warehouseProductCode, "COF-01");
  assert.equal(row?.warehouseLocationId, "90071992547409932");
  assert.equal(row?.warehouseLocationName, "Main / Shelf 1");
  assert.equal(row?.warehouseDestinationName, "Packing");
  assert.equal(row?.warehouseUnitName, "Gram");
  assert.equal(row?.warehouseCountedQuantity, 0);
  for (const key of ["quantity", "inventory_quantity", "available_quantity", "product_uom_qty"] as const) {
    assert.equal(row?.[key], source[key]);
  }
  assert.equal("warehouseProductName" in source, false);
});

test("missing references stay unavailable and never manufacture a zero quantity or default unit", () => {
  const [row] = warehouseRows([{ id: 1n, productId: 9n, locationId: 10n, productUom: 99n }], [], [], []);
  assert.equal(row?.warehouseProductName, null);
  assert.equal(row?.warehouseLocationName, null);
  assert.equal(row?.warehouseUnitName, null);
  assert.equal(row?.quantity, undefined);
  assert.equal(row?.warehouseCountedQuantity, null);
  const [uncounted] = warehouseRows([{ id: 2n, inventoryQuantity: 0, inventoryQuantitySet: false }], [], []);
  assert.equal(uncounted?.inventoryQuantity, 0);
  assert.equal(uncounted?.warehouseCountedQuantity, null);
  const [malformed] = warehouseRows([{ id: 1n, productId: Number.MAX_SAFE_INTEGER + 1 }], [{ id: "9007199254740992", name: "Must not join rounded ID" }], []);
  assert.equal(malformed?.warehouseProductName, null);
});

test("denied and failed dependencies cannot supply cached labels or a ready stock view", () => {
  const denied = moduleCollection({ isLoading: false, isError: true, error: { status: 403 }, data: [{ id: 2n, name: "Cached secret product" }], refetch: () => undefined });
  const [row] = warehouseRows([{ id: 1n, productId: 2n }], denied.rows, []);
  assert.equal(row?.warehouseProductName, null);
  const states = { stock: ready, products: denied.state, locations: ready, uoms: ready, transfers: ready };
  assert.equal(warehouseDataStates(states).stock.status, "denied");
  assert.equal(warehouseDataStates(states).transfers, ready);
  assert.equal(warehouseDataStates({ ...states, products: { status: "partial" } as ModuleDataState }).stock.status, "error");
  assert.equal(warehouseDataStates({ stock: ready, products: ready, locations: ready }).stock.status, "error");
  assert.equal(warehouseDataStates({ ...states, products: { status: "loading" } as ModuleDataState }).stock.status, "loading");
});

test("stock view leads with named identity and filters by exact location without relabeling counts as on-hand", () => {
  const execute = () => undefined;
  const table: EntityViewConfig = {
    id: "stock-quants-table", title: "Stock", view: {
      mode: "table", rowKey: "id", columns: [
        { key: "productId", label: "Product ID" }, { key: "locationId", label: "Location" },
        { key: "availableQuantity", label: "Available", type: "number" },
        { key: "inventoryQuantity", label: "On hand", type: "number" },
      ], actions: [{ id: "move-stock-quant", label: "Move", onClick: execute }],
    },
  };
  const result = warehouseTable(table, "stock", [{ id: 1n, name: "Shelf" }, { id: 2n, name: "Shelf" }], t);
  if (result.view.mode !== "table") assert.fail("Expected stock table");
  assert.deepEqual(result.view.columns.slice(0, 5).map((column) => column.key), ["warehouseProductName", "warehouseProductCode", "warehouseLocationName", "warehouseUnitName", "quantity"]);
  assert.equal(result.view.columns.find((column) => column.key === "warehouseCountedQuantity")?.label, "Counted");
  assert.deepEqual(result.view.filters?.[0]?.options, [{ value: "1", label: "Shelf" }, { value: "2", label: "Shelf" }]);
  assert.equal(result.view.actions?.[0]?.onClick, execute);
  assert.deepEqual(result.view.actions?.[0]?.permission, { resource: "stock_quant", action: "write" });
  assert.equal(result.view.columns[0]?.render?.(null, {}), "Unavailable");
  assert.equal(table.view.mode === "table" && table.view.columns[0]?.key, "productId");
});

test("warehouse projection keeps existing operation and record owners, and its groups cannot resurrect excluded tabs", () => {
  const transferHref = (row: Record<string, unknown>) => `/inventory/transfers/${String(row.id)}`;
  const source: ModuleConfig = {
    id: "inventory", title: "Inventory", defaultTab: "dashboard",
    tabs: [...WAREHOUSE_TAB_IDS, "products", "dashboard", "3d-view", "quality", "routes", "warehouse-tasks"].map((id) => ({
      id, label: id, type: "entity" as const,
      ...(id === "transfers" ? { createAction: "createStockPicking", recordSheet: { titleKey: "name", detailConfig: { mode: "detail" as const, sections: [] }, openHref: transferHref } } : {}),
      ...(id === "locations" ? { createAction: "createStockLocation" } : {}),
    })),
    tabGroups: [{ label: "Old", tabIds: ["products", "3d-view"] }],
    workspaceNav: { workspaces: [{ id: "old", label: "Old", tabIds: ["warehouse-tasks"] }] },
  };
  const result = warehouseWorkspace(source, t);
  assert.equal(result.id, "warehouse");
  assert.equal(result.defaultTab, "stock");
  assert.deepEqual(result.tabs.map((tab) => tab.id), WAREHOUSE_TAB_IDS);
  assert.deepEqual(result.workspaceNav?.workspaces.flatMap((group) => group.tabIds), WAREHOUSE_TAB_IDS);
  assert.equal(result.tabGroups, undefined);
  assert.equal(result.workBoard, undefined);
  assert.equal(result.tabs.find((tab) => tab.id === "transfers")?.recordSheet?.openHref, transferHref);
  assert.equal(result.tabs.find((tab) => tab.id === "locations")?.createAction, "createStockLocation");
  assert.deepEqual(result.tabs.find((tab) => tab.id === "locations")?.createPermission, { resource: "stock_location", action: "create" });
  assert.deepEqual(result.tabs.find((tab) => tab.id === "warehouses")?.createPermission, { resource: "warehouse", action: "create" });
  assert.equal(source.defaultTab, "dashboard");
  for (const tab of ["products", "dashboard", "3d-view", "quality", "routes", "warehouse-tasks", "unknown"]) {
    assert.equal(moduleTabDestination({ pathname: "/warehouse", query: "", tab, defaultTab: "stock", validTabs: WAREHOUSE_TAB_IDS }), null);
  }
  assert.equal(moduleTabDestination({ pathname: "/warehouse", query: "company=4&filter=id:1", tab: "transfers", defaultTab: "stock", validTabs: WAREHOUSE_TAB_IDS }), "/warehouse?company=4&tab=transfers");
});

test("sparse projections only navigate tabs that the source actually supplies", () => {
  const result = warehouseWorkspace({ id: "inventory", title: "Inventory", tabs: [{ id: "stock", label: "Stock", type: "entity" }] }, t);
  assert.deepEqual(result.workspaceNav?.workspaces.map((group) => group.tabIds), [["stock"]]);
});

test("bounded replenishment keeps native scheduling owners and withholds execution without its exact permission gate", () => {
  const schedule = () => undefined;
  const table: EntityViewConfig = {
    id: "replenishment", title: "Replenishment", view: {
      mode: "table", columns: [], actions: [
        { id: "execute-replenishment-rule", label: "Execute", onClick: () => undefined },
        { id: "schedule-replenishment-run", label: "Schedule", onClick: schedule },
        { id: "cancel-replenishment-run", label: "Cancel", onClick: schedule },
      ],
    },
  };
  const result = warehouseTable(table, "replenishment", [], t);
  if (result.view.mode !== "table" || table.view.mode !== "table") assert.fail("Expected replenishment table");
  assert.deepEqual(result.view.actions?.map((action) => action.id), ["schedule-replenishment-run", "cancel-replenishment-run"]);
  assert.ok(result.view.actions?.every((action) => action.onClick === schedule));
  assert.ok(result.view.actions?.every((action) => action.permission?.resource === "replenishment_rule" && action.permission.action === "write"));
  assert.equal(table.view.actions?.length, 3);
});

test("Warehouse stock detail matches the list's on-hand/count distinction without changing legacy detail", () => {
  const otherSection = { id: "other", fields: [{ key: "value", label: "Value" }] };
  const source = {
    mode: "detail" as const, sections: [
      { id: "stock", fields: [{ key: "productId", label: "Product ID" }, { key: "locationId", label: "Location" }, { key: "inventoryQuantity", label: "On hand" }] },
      otherSection,
    ],
  };
  const result = warehouseStockDetail(source, t);
  assert.deepEqual(result.sections[0]?.fields.map((field) => field.key), ["warehouseProductName", "warehouseLocationName", "warehouseUnitName", "quantity", "warehouseCountedQuantity"]);
  assert.equal(result.sections[0]?.fields.find((field) => field.key === "warehouseCountedQuantity")?.label, "Counted");
  assert.equal(result.sections[0]?.fields[2]?.render?.(null, {}), "Unavailable");
  assert.equal(result.sections[1], otherSection);
  assert.equal(source.sections[0]?.fields[2]?.key, "inventoryQuantity");
});
