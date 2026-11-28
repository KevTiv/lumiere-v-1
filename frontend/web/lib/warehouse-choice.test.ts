import test from "node:test"
import assert from "node:assert/strict"
import { companyWarehouseOptions, warehouseSetupAccess, warehouseSetupHref } from "./warehouse-choice"
import { companyHandoff } from "./company-handoff"

test("warehouse choices accept only active, canonical records in the chosen company", () => {
  const warehouse = { id: "9007199254740997", organizationId: "4", companyId: "22", name: "Central", code: "CEN", active: true }
  assert.deepEqual(companyWarehouseOptions([
    { ...warehouse, companyId: "24" }, { ...warehouse, organizationId: "5" },
    { ...warehouse, active: false }, { ...warehouse, id: 0 }, warehouse,
  ], 4n, 22n), [{ value: "9007199254740997", label: "CEN — Central" }])
  assert.deepEqual(companyWarehouseOptions([], 4n, 22n), [])
  assert.equal(companyWarehouseOptions([{ ...warehouse, active: undefined }], 4n, 22n), null)
})

test("setup links retain company through cross-route handoff and respect admitted scopes", () => {
  const href = warehouseSetupHref(22n)
  assert.deepEqual(companyHandoff(href, [21, 22]), { companyId: 22, href: "/warehouse?tab=warehouses" })
  assert.equal(companyHandoff(href, [21]), null)
  assert.deepEqual(warehouseSetupAccess(() => ({ allowed: true })), { warehouse: true, location: true })
  assert.deepEqual(warehouseSetupAccess((resource, action) => ({ allowed: resource !== "stock_location" || action !== "create" })), { warehouse: true, location: false })
  assert.deepEqual(warehouseSetupAccess((resource) => ({ allowed: resource !== "stock_location" })), { warehouse: false, location: false })
})
