import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  toUpdateContactParams,
  toUpdateLeadDetailsParams,
  toUpdateOpportunityStageParams,
} from "./crm-update-params"

describe("toUpdateContactParams", () => {
  it("returns null for an empty form", () => {
    assert.equal(toUpdateContactParams({}), null)
  })

  it("returns null when all fields are blank", () => {
    assert.equal(
      toUpdateContactParams({
        name: "",
        email: "   ",
        phone: null,
      }),
      null,
    )
  })

  it("includes only changed non-empty fields in the patch", () => {
    assert.deepEqual(toUpdateContactParams({ name: "Jane Doe" }), {
      name: "Jane Doe",
    })
    assert.deepEqual(
      toUpdateContactParams({
        name: "Jane Doe",
        email: "jane@example.com",
        isCustomer: true,
      }),
      {
        name: "Jane Doe",
        email: "jane@example.com",
        isCustomer: true,
      },
    )
  })

  it("omits keys not present in the form", () => {
    const patch = toUpdateContactParams({ phone: "+1 555 0100" })
    assert.deepEqual(patch, { phone: "+1 555 0100" })
    assert.ok(patch && !("name" in patch))
    assert.ok(patch && !("email" in patch))
  })
})

describe("toUpdateLeadDetailsParams", () => {
  it("returns null for an empty form", () => {
    assert.equal(toUpdateLeadDetailsParams({}), null)
  })

  it("returns a patch when at least one lead detail field is set", () => {
    assert.deepEqual(toUpdateLeadDetailsParams({ contactName: "Acme Corp" }), {
      contactName: "Acme Corp",
    })
    assert.deepEqual(
      toUpdateLeadDetailsParams({
        contactName: "Acme Corp",
        industry: "Software",
        description: "Inbound referral",
      }),
      {
        contactName: "Acme Corp",
        industry: "Software",
        description: "Inbound referral",
      },
    )
  })
})

describe("toUpdateOpportunityStageParams", () => {
  it("returns null when stageId is missing", () => {
    assert.equal(toUpdateOpportunityStageParams({}), null)
    assert.equal(toUpdateOpportunityStageParams({ stageId: "" }), null)
    assert.equal(toUpdateOpportunityStageParams({ stageId: "   " }), null)
  })

  it("returns null for invalid stageId values", () => {
    assert.equal(toUpdateOpportunityStageParams({ stageId: "not-a-number" }), null)
    assert.equal(toUpdateOpportunityStageParams({ stageId: "-1" }), null)
  })

  it("requires a valid stageId in the patch", () => {
    assert.deepEqual(toUpdateOpportunityStageParams({ stageId: "42" }), {
      stageId: 42n,
    })
    assert.deepEqual(toUpdateOpportunityStageParams({ stageId: 7 }), {
      stageId: 7n,
    })
  })
})
