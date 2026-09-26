import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveClosedPeriodEffect } from "./accounting/fiscal-periods"
import { AmbiguousOperationEffectError } from "./operation-effect"

const row = { id: "51", organizationId: 7n, companyId: "8", state: { tag: "Closed" } }

describe("resolveClosedPeriodEffect", () => {
  it("returns the exact closed period", () => {
    assert.deepEqual(resolveClosedPeriodEffect([row], 7n, 8n, 51n), {
      resource: "account-periods",
      id: "51",
    })
  })

  it("fails closed for scope or state mismatch", () => {
    assert.equal(resolveClosedPeriodEffect([{ ...row, companyId: 9n }], 7n, 8n, 51n), null)
    assert.equal(resolveClosedPeriodEffect([{ ...row, state: "Open" }], 7n, 8n, 51n), null)
  })

  it("rejects duplicate exact periods", () => {
    assert.throws(() => resolveClosedPeriodEffect([row, { ...row }], 7n, 8n, 51n), AmbiguousOperationEffectError)
  })
})
