import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INVENTORY_WORKSPACE_RESOURCE_KEYS,
  inventoryWorkspaceResourceKeys,
  isInventoryWorkspaceReadEnabled,
} from "./inventory-workspace";

test("Warehouse keeps stock/count/form prerequisites without subscribing to excluded WMS surfaces", () => {
  const resources = inventoryWorkspaceResourceKeys("warehouse");
  for (const key of ["products", "uoms", "stock-locations", "stock-quants", "stock-pickings", "stock-moves", "stock-inventories", "adjustment-reasons", "stock-cycle-counts", "replenishment-rules", "warehouses"]) {
    assert.ok(resources.some((resource) => resource === key), key);
    assert.equal(isInventoryWorkspaceReadEnabled("warehouse", key), true, key);
  }
  for (const key of ["quality-checks", "picking-waves", "warehouse-tasks", "stock-routes", "barcode-rules", "inventory-valuations", "warehouse-3d-zones"]) {
    assert.ok(!resources.some((resource) => resource === key), key);
    assert.equal(isInventoryWorkspaceReadEnabled("warehouse", key), false, key);
  }
});

test("Products activates catalog and record references without stock operations", () => {
  assert.deepEqual(inventoryWorkspaceResourceKeys("products"), ["products", "product-categories", "uoms"]);
  assert.equal(isInventoryWorkspaceReadEnabled("products", "product-supplier-infos"), true);
  assert.equal(isInventoryWorkspaceReadEnabled("products", "product-packagings"), true);
  for (const resource of ["stock-quants", "stock-pickings", "stock-locations", "warehouses", "quality-checks"]) {
    assert.equal(isInventoryWorkspaceReadEnabled("products", resource), false);
  }
});

test("existing Inventory callers keep their full subscription and HTTP reads", () => {
  assert.equal(inventoryWorkspaceResourceKeys(), INVENTORY_WORKSPACE_RESOURCE_KEYS);
  assert.equal(inventoryWorkspaceResourceKeys("inventory"), INVENTORY_WORKSPACE_RESOURCE_KEYS);
  assert.equal(isInventoryWorkspaceReadEnabled("inventory", "inventory-valuations"), true);
  assert.equal(new Set(inventoryWorkspaceResourceKeys("warehouse")).size, inventoryWorkspaceResourceKeys("warehouse").length);
});
