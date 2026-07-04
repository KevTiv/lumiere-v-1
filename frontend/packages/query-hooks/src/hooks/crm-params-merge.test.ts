import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  finalizeCreateLeadParams,
  finalizeCreateOpportunityParams,
  finalizeCreateContactParams,
  finalizeUpdateContactAddressParams,
  finalizeUpdateContactBusinessParams,
  finalizeUpdateContactDetailsParams,
  finalizeUpdateContactParams,
  finalizeUpdateLeadAddressParams,
  finalizeUpdateLeadDetailsParams,
  finalizeUpdateLeadRevenueParams,
  finalizeUpdateOpportunityParams,
} from "./crm-params-merge"

describe("finalizeCreateLeadParams", () => {
  it("fills required defaults for partial lead input", () => {
    const params = finalizeCreateLeadParams({ name: "Acme Lead" })
    assert.equal(params.name, "Acme Lead")
    assert.equal(params.priority, "Medium")
    assert.equal(params.state, "new")
    assert.equal(params.expectedRevenue, 0)
    assert.equal(params.probability, 0)
    assert.deepEqual(params.tagIds, [])
  })
})

describe("finalizeCreateOpportunityParams", () => {
  it("fills required defaults for partial opportunity input", () => {
    const params = finalizeCreateOpportunityParams({
      name: "Big Deal",
      stageId: 42n,
    })
    assert.equal(params.name, "Big Deal")
    assert.equal(params.stageId, 42n)
    assert.equal(params.priority, "Medium")
    assert.equal(params.isWon, false)
    assert.equal(params.isLost, false)
    assert.deepEqual(params.tagIds, [])
  })
})

describe("finalizeCreateContactParams", () => {
  it("defaults prospect flags for CRM contacts", () => {
    const params = finalizeCreateContactParams({ name: "Jane Doe" })
    assert.equal(params.name, "Jane Doe")
    assert.equal(params.type, "contact")
    assert.equal(params.isProspect, true)
    assert.equal(params.isCustomer, false)
  })
})

describe("finalizeUpdateContactParams", () => {
  it("includes only explicitly provided contact fields", () => {
    const params = finalizeUpdateContactParams({ name: "X" })
    assert.deepEqual(params, { name: "X" })
    assert.ok(!("email" in params))
    assert.ok(!("phone" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateContactParams({}), {})
  })
})

describe("finalizeUpdateOpportunityParams", () => {
  it("includes only explicitly provided opportunity fields", () => {
    const params = finalizeUpdateOpportunityParams({ stageId: 42n })
    assert.deepEqual(params, { stageId: 42n })
    assert.ok(!("name" in params))
    assert.ok(!("expectedRevenue" in params))
  })
})

describe("finalizeUpdateContactAddressParams", () => {
  it("includes only explicitly provided address fields", () => {
    const params = finalizeUpdateContactAddressParams({ city: "Paris" })
    assert.deepEqual(params, { city: "Paris" })
    assert.ok(!("street" in params))
    assert.ok(!("zip" in params))
  })
})

describe("finalizeUpdateContactBusinessParams", () => {
  it("includes only explicitly provided business fields", () => {
    const params = finalizeUpdateContactBusinessParams({ industry: "Tech" })
    assert.deepEqual(params, { industry: "Tech" })
    assert.ok(!("annualRevenue" in params))
  })
})

describe("finalizeUpdateContactDetailsParams", () => {
  it("includes only explicitly provided detail fields", () => {
    const params = finalizeUpdateContactDetailsParams({ title: "CEO" })
    assert.deepEqual(params, { title: "CEO" })
    assert.ok(!("firstName" in params))
  })
})

describe("finalizeUpdateLeadDetailsParams", () => {
  it("includes only explicitly provided lead detail fields", () => {
    const params = finalizeUpdateLeadDetailsParams({ contactName: "Jane" })
    assert.deepEqual(params, { contactName: "Jane" })
    assert.ok(!("title" in params))
  })
})

describe("finalizeUpdateLeadAddressParams", () => {
  it("includes only explicitly provided lead address fields", () => {
    const params = finalizeUpdateLeadAddressParams({ city: "Lyon" })
    assert.deepEqual(params, { city: "Lyon" })
    assert.ok(!("street" in params))
  })
})

describe("finalizeUpdateLeadRevenueParams", () => {
  it("includes only explicitly provided revenue fields", () => {
    const params = finalizeUpdateLeadRevenueParams({ expectedRevenue: 5000 })
    assert.deepEqual(params, { expectedRevenue: 5000 })
    assert.ok(!("probability" in params))
  })
})
