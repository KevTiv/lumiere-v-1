import assert from "node:assert/strict"
import { test } from "node:test"
import { isAgentAvailableForCompany } from "./agent-company-scope"

const agent = { id: 2n, organizationId: 4097n, companyId: 4097n, isActive: true }
const available = (candidate: Parameters<typeof isAgentAvailableForCompany>[0], company = "4097") =>
  isAgentAvailableForCompany(candidate, 4097n, company)

test("company-bound agent is offered only in its organization and company", () => {
  assert.equal(available(agent), true)
  assert.equal(available(agent, "4098"), false)
  assert.equal(available({ ...agent, organizationId: 1n }), false)
  assert.equal(available({ ...agent, isActive: false }), false)
})

test("omitted or redacted company binding is never treated as organization-wide", () => {
  const { companyId: _, ...missing } = agent
  assert.equal(available(missing), false)
  assert.equal(available({ ...agent, companyId: undefined }), false)
  assert.equal(available({ ...agent, companyId: "" }), false)
  assert.equal(available({ ...agent, companyId: 0 }), false)
})

test("explicit organization-wide binding still requires matching organization and valid company", () => {
  assert.equal(available({ ...agent, companyId: null }), true)
  assert.equal(available({ ...agent, companyId: null }, "4098"), true)
  assert.equal(available({ ...agent, organizationId: 1, companyId: null }), false)
  for (const company of ["", "0", "-1", "NaN", "1.5", "18446744073709551616"]) {
    assert.equal(available({ ...agent, companyId: null }, company), false)
  }
})

test("JSON number/string IDs and native bigint IDs match without precision loss", () => {
  assert.equal(available({ ...agent, id: 2, organizationId: "4097", companyId: 4097 }), true)
  assert.equal(isAgentAvailableForCompany({ ...agent, organizationId: "9007199254740993", companyId: "4097" }, 9007199254740993n, "4097"), true)
  assert.equal(available({ ...agent, organizationId: Number.MAX_SAFE_INTEGER + 1 }), false)
  for (const id of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, "9007199254740993", 9007199254740993n, "18446744073709551616"]) {
    assert.equal(available({ ...agent, id }), false)
  }
})

test("company choices outside the Number request contract cannot enable dispatch", () => {
  assert.equal(available({ ...agent, companyId: "9007199254740993" }, "9007199254740993"), false)
  assert.equal(available({ ...agent, companyId: null }, "9007199254740993"), false)
  assert.equal(available({ ...agent, companyId: BigInt(Number.MAX_SAFE_INTEGER) }, String(Number.MAX_SAFE_INTEGER)), true)
})
