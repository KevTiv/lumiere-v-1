import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveAccountAssetStateEffect } from "./accounting/assets"
import { AmbiguousOperationEffectError } from "./operation-effect"

const row = { id: "41", companyId: "8", state: { tag: "Running" } }

describe("resolveAccountAssetStateEffect", () => {
  it("returns the exact asset in the expected state", () => {
    assert.deepEqual(resolveAccountAssetStateEffect([row], 8n, 41n, "Running"), {
      resource: "account-assets",
      id: "41",
    })
    assert.deepEqual(
      resolveAccountAssetStateEffect([{ ...row, company_id: 8n, companyId: undefined, state: "Close" }], 8n, 41n, "Close"),
      { resource: "account-assets", id: "41" },
    )
  })

  it("fails closed for scope, state or identity mismatch", () => {
    assert.equal(resolveAccountAssetStateEffect([{ ...row, companyId: "9" }], 8n, 41n, "Running"), null)
    assert.equal(resolveAccountAssetStateEffect([{ ...row, state: { tag: "Draft" } }], 8n, 41n, "Running"), null)
    assert.equal(resolveAccountAssetStateEffect([row], 8n, 42n, "Running"), null)
  })

  it("rejects duplicate exact assets", () => {
    assert.throws(
      () => resolveAccountAssetStateEffect([row, { ...row }], 8n, 41n, "Running"),
      AmbiguousOperationEffectError,
    )
  })
})
