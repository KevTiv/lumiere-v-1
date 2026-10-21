import assert from "node:assert/strict"
import test from "node:test"
import { fleetDetailsParams, pickingHeaderParams, resolveUpdatedRecord } from "./pass9-record-actions"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect } from "./operation-effect"

test("fleet detail patches encode explicit clears as nested options", () => {
  assert.deepEqual(fleetDetailsParams({ name: "  Van  ", vehicleType: "  van ", licensePlate: null, driverName: "Alex", odometerKm: 0, fuelLevel: null }), {
    name: { some: "Van" }, vehicle_type: { some: "van" }, license_plate: { some: { none: [] } },
    driver_name: { some: { some: "Alex" } }, odometer_km: { some: { some: 0 } }, fuel_level: { some: { none: [] } }, metadata: { none: [] },
  })
})

test("transfer patches encode company scope and empty text without changing partner or date", () => {
  assert.deepEqual(pickingHeaderParams(17n, { origin: "", note: "Updated" }), {
    company_id: { some: 17 }, origin: { some: "" }, note: { some: "Updated" }, partner_id: { none: [] }, scheduled_date: { none: [] },
  })
})

test("readback requires one exact record, company and changed value", () => {
  const matches = (row: object) => Reflect.get(row, "state") === "confirmed"
  const row = { id: "42", company_id: "17", state: "confirmed" }
  const resolve = (rows: object[]) => resolveUpdatedRecord(rows, 42n, 17n, "stock-pickings", matches)
  assert.deepEqual(resolve([row]), { resource: "stock-pickings", id: "42" })
  assert.equal(resolve([{ ...row, id: "43" }]), null)
  assert.equal(resolve([{ ...row, company_id: "18" }]), null)
  assert.equal(resolve([{ ...row, state: "assigned" }]), null)
  assert.throws(() => resolve([row, row]), /ambiguous/i)
})

test("acknowledgement without matching readback fails and never repeats dispatch", async () => {
  let calls = 0
  const effect = await executeOperationWithCanonicalReadback({
    resolveBeforeDispatch: false,
    dispatch: async () => { calls += 1; return { kind: "accepted" } },
    wait: async () => {},
    resolveEffect: async () => null,
  })
  assert.throws(() => requireResolvedOperationEffect(effect), /unresolved|could not|confirm/i)
  assert.equal(calls, 1)
})
