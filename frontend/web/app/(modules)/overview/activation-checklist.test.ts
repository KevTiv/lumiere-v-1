import assert from "node:assert/strict"
import test from "node:test"
import { activationChecklist, activationForm, activationRecordHref, activationPricelistSetupHref, activationPricelistState, decodeActivationPricelists, activationTaskHref, activationWarehouseState, availableActivationTasks, decodeActivationWarehouses, matchesActivationRecord, parseActivationReceipt, selectedActivationTask } from "./activation-checklist"

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

test("create tasks address only their native editors and link to exact saved records", () => {
  assert.deepEqual(activationForm("contact"), { moduleId: "crm", tabId: "contacts", permission: "contact", resource: "contacts" })
  assert.equal(activationForm("quotation")?.tabId, "orders")
  assert.equal(activationForm("expense")?.tabId, "expenses")
  assert.equal(activationForm("reports"), null)
  assert.equal(activationRecordHref({ task: "expense", recordId: "9" }), "/expenses?tab=expenses&filter=id%3A9")
  assert.equal(activationRecordHref({ task: "quotation", recordId: "9" }), "/sales/orders/9?tab=lines")
})

test("a retained save pointer requires an exact current-scope record", () => {
  const receipt = parseActivationReceipt('{"task":"contact","recordId":"9007199254740993"}')
  assert.ok(receipt)
  const row = { id: receipt.recordId, organization_id: "1", company_id: "2" }
  assert.equal(matchesActivationRecord(row, receipt, 1, 2), true)
  assert.equal(matchesActivationRecord({ ...row, id: "9" }, receipt, 1, 2), false)
  assert.equal(matchesActivationRecord({ ...row, id: Number(receipt.recordId) }, receipt, 1, 2), false)
  assert.equal(matchesActivationRecord({ ...row, company_id: "3" }, receipt, 1, 2), false)
  assert.equal(matchesActivationRecord({ ...row, organization_id: "2" }, receipt, 1, 2), false)
  assert.equal(matchesActivationRecord({ ...row, company_id: null }, receipt, 1, 2), false)
  assert.equal(parseActivationReceipt('{"task":"reports","recordId":"9"}'), null)
  assert.equal(parseActivationReceipt('{"task":"contact","recordId":"../9"}'), null)
})

test("quotation warehouse readiness requires a confirmed active warehouse in the exact company", () => {
  const context = { organizationId: 1, companyId: 2, companyState: "ready" as const }
  const warehouse = { id: "11", organizationId: "1", companyId: "2", active: true }
  const state = (data: unknown) => activationWarehouseState({
    ...context,
    warehouses: { status: "success", data: decodeActivationWarehouses({ data }) },
  })
  assert.equal(state([warehouse]), "ready")
  assert.equal(state([{ ...warehouse, active: 1 }]), "unavailable")
  assert.equal(state([{ ...warehouse, active: false }, { ...warehouse, companyId: "3" }, { ...warehouse, organizationId: "3" }]), "missing")
  assert.equal(state([]), "missing")
  assert.equal(state([{ ...warehouse, active: undefined }]), "unavailable")
  assert.equal(state([{ ...warehouse, companyId: undefined }]), "unavailable")
  assert.equal(activationWarehouseState(context), "unavailable")
  assert.equal(activationWarehouseState({ ...context, warehouses: { status: "success", data: [], isFetching: true } }), "loading")
  assert.equal(activationWarehouseState({ ...context, warehouses: { status: "pending" } }), "loading")
  assert.equal(activationWarehouseState({ ...context, warehouses: { status: "error", data: [warehouse] } }), "unavailable")
  assert.equal(activationWarehouseState({ ...context, companyId: null, companyState: "missing" }), "unavailable")
  assert.throws(() => decodeActivationWarehouses({}))
  assert.throws(() => decodeActivationWarehouses({ data: [null] }))
})

const priceContext = { organizationId: "1", companyId: "2", companyState: "ready" as const }
const pricelist = { id: "9007199254740993", organizationId: "1", companyId: "2", currencyId: "8", isActive: true }
const priceRead = (data: readonly Record<string, unknown>[]) => ({ status: "success" as const, data })

test("quotation price readiness uses active company and shared lists with a current currency", () => {
  const state = (rows: readonly Record<string, unknown>[], currency: Record<string, unknown> = { id: "8" }) =>
    activationPricelistState({ ...priceContext, pricelists: priceRead(rows), currencies: priceRead([currency]) })
  assert.equal(state([pricelist]), "ready")
  assert.equal(state([{ ...pricelist, companyId: null }]), "ready")
  assert.equal(state([{ ...pricelist, companyId: { none: [] } }]), "ready")
  assert.equal(state([{ id: "5", organization_id: "1", company_id: "2", currency_id: "8", is_active: true }]), "ready")
  assert.equal(state([{ ...pricelist, companyId: "3" }, { ...pricelist, organizationId: "3" }]), "missing")
  assert.equal(state([{ ...pricelist, isActive: false }]), "missing")
  assert.equal(state([pricelist], { id: "8", is_active: false }), "missing")
  assert.equal(state([pricelist], { id: "9" }), "missing")
})

test("price setup appears only on verified emptiness and with native setup permissions", () => {
  const reads = { pricelists: priceRead([]), currencies: priceRead([{ id: "8" }]) }
  assert.equal(activationPricelistState({ ...priceContext, ...reads }), "missing")
  assert.equal(activationPricelistState({ ...priceContext, ...reads, pricelists: priceRead([{ ...pricelist, companyId: undefined }]) }), "unavailable")
  assert.equal(activationPricelistState({ ...priceContext, ...reads, pricelists: priceRead([{ ...pricelist, currencyId: undefined }]) }), "unavailable")
  assert.equal(activationPricelistState({ ...priceContext, ...reads, currencies: { status: "error", data: [{ id: "8" }] } }), "unavailable")
  assert.equal(activationPricelistState({ ...priceContext, ...reads, currencies: { ...reads.currencies, isFetching: true } }), "loading")
  assert.equal(activationPricelistState({ ...priceContext, pricelists: reads.pricelists }), "unavailable")
  assert.deepEqual(decodeActivationPricelists({ data: [pricelist] }), [pricelist])
  assert.throws(() => decodeActivationPricelists({ unchecked: true }))
  assert.equal(activationPricelistSetupHref("missing", "2", () => true), "/sales?tab=pricelists&companyId=2")
  assert.equal(activationPricelistSetupHref("unavailable", "2", () => true), null)
  assert.equal(activationPricelistSetupHref("loading", "2", () => true), null)
  for (const denied of ["product_pricelist", "pricelist", "module:sales"]) {
    assert.equal(activationPricelistSetupHref("missing", "2", resource => resource !== denied), null)
  }
})
