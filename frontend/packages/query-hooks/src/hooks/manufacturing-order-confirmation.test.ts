import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolveManufacturingOrderState } from "./manufacturing-order-confirmation"

test("resolves only the exact company-scoped MO at the expected state", () => {
  assert.deepEqual(
    resolveManufacturingOrderState(
      [
        {
          id: 41,
          companyId: 7,
          state: { tag: "Confirmed" },
          bomId: 12,
        },
        {
          id: 42,
          companyId: 7,
          state: "Confirmed",
          bomId: 13,
        },
      ],
      41n,
      7n,
      "Confirmed",
    ),
    {
      resource: "mrp-productions",
      id: "41",
      companyId: "7",
      bomId: "12",
    },
  )
})

test("wrong id, company, or state never resolves as the confirmation effect", () => {
  const rows = [
    {
      id: 41,
      company_id: 7,
      state: { tag: "Draft" },
      bom_id: 12,
    },
  ]

  assert.equal(resolveManufacturingOrderState(rows, 41n, 7n, "Confirmed"), null)
  assert.equal(resolveManufacturingOrderState(rows, 42n, 7n, "Draft"), null)
  assert.equal(resolveManufacturingOrderState(rows, 41n, 8n, "Draft"), null)
})

test("duplicate canonical rows fail closed instead of selecting one", () => {
  assert.throws(
    () =>
      resolveManufacturingOrderState(
        [
          { id: 41, companyId: 7, state: "Confirmed", bomId: 12 },
          { id: 41, companyId: 7, state: "Confirmed", bomId: 12 },
        ],
        41n,
        7n,
        "Confirmed",
      ),
    AmbiguousOperationEffectError,
  )
})
