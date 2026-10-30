import assert from "node:assert/strict"
import test from "node:test"
import { activationChecklist, activationTaskHref, availableActivationTasks, selectedActivationTask } from "./activation-checklist"

const company = { id: 2n, organizationId: 1n, currencyId: 4n, fiscalYearEndMonth: 12, fiscalYearEndDay: 31 }
const customer = { id: 9n, organizationId: 1n, companyId: 2n, isCustomer: true }
const input = { organizationId: 1, companyId: 2, companies: { status: "success" as const, data: [company] }, contacts: { status: "success" as const, data: [customer] } }

test("checks persisted selected-company settings and a saved customer without certifying a workflow", () => {
  assert.deepEqual(activationChecklist(input), { companyState: "ready", currencyState: "ready", fiscalState: "ready", contactState: "ready", customerState: "ready" })
})

test("a company switch cannot reuse another company's customer or settings", () => {
  const result = activationChecklist({ ...input, companyId: 3 })
  assert.deepEqual(result, { companyState: "unavailable", currencyState: "unavailable", fiscalState: "unavailable", contactState: "unavailable", customerState: "unavailable" })
  assert.equal(activationChecklist({ ...input, contacts: { status: "success", data: [{ ...customer, companyId: 3n }] } }).customerState, "missing")
})

test("cross-organization and organization-shared contacts do not satisfy company-specific setup", () => {
  const result = activationChecklist({ ...input, contacts: { status: "success", data: [{ ...customer, organizationId: 3n }, { ...customer, companyId: null }] } })
  assert.equal(result.customerState, "missing")
  assert.equal(activationChecklist({ ...input, companies: { status: "success", data: [{ ...company, organizationId: 3n }] } }).companyState, "unavailable")
})

test("failed reads discard retained data rather than showing fabricated readiness or empty data", () => {
  assert.equal(activationChecklist({ ...input, contacts: { status: "error", data: [customer] } }).customerState, "unavailable")
  assert.equal(activationChecklist({ ...input, companies: { status: "error", data: [company] } }).companyState, "unavailable")
  assert.equal(activationChecklist({ ...input, contacts: { status: "pending", data: [customer] } }).customerState, "loading")
  assert.equal(activationChecklist({ ...input, contacts: { status: "success" } }).customerState, "unavailable")
})

test("masked settings and customer classifications remain unverifiable", () => {
  const result = activationChecklist({ ...input, companies: { status: "success", data: [{ id: 2n, organizationId: 1n }] }, contacts: { status: "success", data: [{ id: 9n, organizationId: 1n, companyId: 2n }] } })
  assert.equal(result.currencyState, "unavailable")
  assert.equal(result.fiscalState, "unavailable")
  assert.equal(result.customerState, "unavailable")
  assert.equal(result.contactState, "ready")
  assert.equal(activationChecklist({ ...input, contacts: { status: "success", data: [{ id: 9n, organizationId: 1n }] } }).contactState, "unavailable")
})

test("an empty successful read asks for setup; a vendor is not a customer", () => {
  assert.equal(activationChecklist({ ...input, contacts: { status: "success", data: [] } }).customerState, "missing")
  assert.equal(activationChecklist({ ...input, contacts: { status: "success", data: [{ ...customer, isCustomer: false }] } }).customerState, "missing")
  assert.equal(activationChecklist({ ...input, contacts: { status: "success", data: [{ ...customer, isCustomer: false }] } }).contactState, "ready")
})

test("invalid recurring fiscal dates and missing currency remain distinct from masked fields", () => {
  const result = activationChecklist({ ...input, companies: { status: "success", data: [{ ...company, currencyId: 0n, fiscalYearEndMonth: 2, fiscalYearEndDay: 29 }] } })
  assert.equal(result.currencyState, "missing")
  assert.equal(result.fiscalState, "missing")
})

test("no selected company blocks scoped checks and malformed identities never match", () => {
  assert.equal(activationChecklist({ ...input, companyId: null }).customerState, "missing")
  assert.equal(activationChecklist({ ...input, companies: { status: "success", data: [{ ...company, id: "02" }] } }).companyState, "unavailable")
  assert.equal(activationChecklist({ ...input, companyId: Number.MAX_SAFE_INTEGER + 1 }).companyState, "missing")
})

test("large exact record identities are compared without numeric conversion", () => {
  const largeId = "9007199254740993"
  const result = activationChecklist({ ...input, companyId: largeId, companies: { status: "success", data: [{ ...company, id: largeId }] }, contacts: { status: "success", data: [{ ...customer, companyId: largeId }] } })
  assert.equal(result.customerState, "ready")
})

test("task discovery narrows to current read and create permissions", () => {
  const permissions = new Set(["contact:read", "sale_order:create", "hr_expense:read", "hr_expense:create", "financial_report:read"])
  const available = availableActivationTasks((resource, action) => permissions.has(`${resource}:${action}`))
  assert.deepEqual(available, ["expense", "reports"])
  assert.equal(selectedActivationTask("contact", available), "expense")
  assert.equal(selectedActivationTask("reports", available), "reports")
  assert.equal(selectedActivationTask("expense", []), null)
})

test("task handoffs use existing workspace routes", () => {
  assert.equal(activationTaskHref("contact"), "/crm?tab=contacts")
  assert.equal(activationTaskHref("quotation"), "/sales?tab=orders")
  assert.equal(activationTaskHref("expense"), "/expenses?tab=expenses")
  assert.equal(activationTaskHref("accounting"), "/accounting")
  assert.equal(activationTaskHref("reports"), "/reports")
})
