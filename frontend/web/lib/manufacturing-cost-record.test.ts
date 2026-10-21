import assert from "node:assert/strict"
import test from "node:test"
import { manufacturingCostAmount, manufacturingCostLinks, manufacturingCostRecord } from "./manufacturing-cost-record"
import { toManufacturingValuationParams } from "./manufacturing-cost-params"

test("cost readback binds to the exact order, organization and company without selecting a newer row", () => {
  const own = { organizationId: 1n, companyId: 2n, productionId: 3n, totalValue: 75 }
  assert.equal(manufacturingCostRecord([{ ...own, companyId: 9n }, { ...own, productionId: 8n }, own], 1n, 2n, 3n), own)
  assert.equal(manufacturingCostRecord([own], 1n, 9n, 3n), undefined)
  assert.throws(() => manufacturingCostRecord([own, own], 1n, 2n, 3n), /Multiple/)
})

test("actual cost amounts retain zero and variance sign; missing or invalid amounts are unavailable", () => {
  assert.equal(manufacturingCostAmount(0), "0")
  assert.equal(manufacturingCostAmount(-12.5), "-12.5")
  for (const value of [undefined, null, Number.NaN, Infinity, "12.5"]) assert.equal(manufacturingCostAmount(value), "Unavailable")
})

test("cost outputs and posted journal navigate by exact large identities", () => {
  const id = 18446744073709551615n
  assert.deepEqual(manufacturingCostLinks({ outputMoveIds: [id], accountMoveId: id }), {
    outputs: [{ id: String(id), href: `/inventory?tab=stock-moves&filter=id%3A${id}` }],
    journal: { id: String(id), href: `/accounting?tab=journal-entries&filter=id%3A${id}` },
  })
  assert.equal(manufacturingCostLinks({}).journal, undefined)
})

test("valuation configuration preserves u64 account IDs and rejects incomplete selections", () => {
  const values = { journalId: "18446744073709551615", materialAccountId: "2", outputAccountId: "3", workcenterAccountId: "4", varianceAccountId: "5" }
  assert.equal(toManufacturingValuationParams(values).journalId, 18446744073709551615n)
  for (const bad of ["", "0", "-1", "3.5", "18446744073709551616"]) assert.throws(() => toManufacturingValuationParams({ ...values, varianceAccountId: bad }))
})
