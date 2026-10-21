import assert from "node:assert/strict"
import test from "node:test"
import type { FormField, FormValues } from "@lumiere/ui/lib/form-types"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { assetEditDefaults, DEPRECIATION_METHODS, toAssetCreateParams, toAssetUpdateParams } from "./asset-actions"
import { withAssetAuthoringVisibility } from "./asset-authoring-fields"

const labels = { disposalAccounts: "Show disposal account settings (optional)", disposalAccountsHint: "Hiding keeps your selections." }

function fieldsFor(disposalId = ""): FormField[] {
  return [
    { id: "method", name: "method", type: "select", defaultValue: "Linear", options: DEPRECIATION_METHODS.map((value) => ({ value, label: value })) },
    { id: "methodProgressFactor", name: "methodProgressFactor", type: "number", defaultValue: 30, min: 0, max: 100 },
    { id: "gainAccountId", name: "gainAccountId", type: "select", defaultValue: disposalId, options: [{ value: "", label: "None" }, { value: "4", label: "Disposal gains", disabled: false }] },
    { id: "lossAccountId", name: "lossAccountId", type: "select", defaultValue: "", options: [{ value: "", label: "None" }] },
    { id: "accountDisposalId", name: "accountDisposalId", type: "select", defaultValue: "", options: [{ value: "", label: "None" }] },
  ]
}

test("the factor appears for the two supported degressive methods without changing its value", () => {
  const fields = fieldsFor()
  const result = withAssetAuthoringVisibility(fields, labels)
  const factor = result.find((field) => field.name === "methodProgressFactor")!
  assert.deepEqual(factor.visibleWhen, { field: "method", oneOf: ["Degressive", "DegressiveThenLinear"] })
  assert.equal(factor.defaultValue, 30)
  assert.equal(fields[1]!.visibleWhen, undefined)
  assert.equal(result[0], fields[0])
})

test("new disposal settings start collapsed and keep their original lookup options", () => {
  const fields = fieldsFor()
  const result = withAssetAuthoringVisibility(fields, labels)
  const disclosureIndex = result.findIndex((field) => field.name === "showDisposalAccounts")
  assert.equal(result[disclosureIndex]!.type, "switch")
  assert.equal(result[disclosureIndex]!.defaultValue, false)
  assert.equal(result[disclosureIndex + 1]!.name, "gainAccountId")
  for (const name of ["gainAccountId", "lossAccountId", "accountDisposalId"]) {
    const before = fields.find((field) => field.name === name)!
    const after = result.find((field) => field.name === name)!
    assert.deepEqual(after.visibleWhen, { field: "showDisposalAccounts", equals: "true" })
    assert.equal(after.defaultValue, before.defaultValue)
    assert.ok("options" in before && "options" in after)
    assert.equal(after.options, before.options)
  }
})

test("editing an asset with existing disposal settings expands the group and retains stale choices", () => {
  const fields = fieldsFor("4")
  const account = fields[2]!
  assert.ok("options" in account)
  account.options = [{ value: "4", label: "Existing gain account (unavailable)", disabled: true }]
  const result = withAssetAuthoringVisibility(fields, labels)
  assert.equal(result.find((field) => field.name === "showDisposalAccounts")!.defaultValue, true)
  const retained = result.find((field) => field.name === "gainAccountId")!
  assert.equal(retained.defaultValue, "4")
  assert.ok("options" in retained)
  assert.deepEqual(retained.options, account.options)
})

const accounts = [
  { id: 1, code: "ASSET", name: "Asset", companyId: 9, deprecated: false, internalGroup: { tag: "Asset" } },
  { id: 2, code: "ACCDEP", name: "Accumulated depreciation", companyId: 9, deprecated: false, internalGroup: { tag: "Asset" } },
  { id: 3, code: "EXP", name: "Expense", companyId: 9, deprecated: false, internalGroup: { tag: "Expense" } },
  { id: 4, code: "GAIN", name: "Gain", companyId: 9, deprecated: false, internalGroup: { tag: "Income" } },
]
const lookups = { companyId: 9n, accounts, journals: [{ id: 20, code: "GEN", name: "General", companyId: 9, active: true, type: { tag: "General" } }] }
const createValues: FormValues = {
  code: "ASSET-1", name: "Laptop", assetType: "Purchase", currencyId: "3",
  originalValue: 1200, salvageValue: 0, method: "Linear", methodNumber: 5, methodPeriod: 12,
  methodProgressFactor: 27, acquisitionDate: "2026-10-20", firstDepreciationDate: "", prorata: false,
  journalId: "20", accountAssetId: "1", accountDepreciationId: "2", accountDepreciationExpenseId: "3",
  gainAccountId: "4", lossAccountId: "", accountDisposalId: "", showDisposalAccounts: false,
}

test("hidden local factor and disposal values use the existing create mapper correctly after method switches", () => {
  for (const method of DEPRECIATION_METHODS) {
    const result = toAssetCreateParams({ ...createValues, method }, lookups, "create-account-asset:visibility-test")
    assert.equal(result.ok, true)
    if (!result.ok) continue
    const wire = stdbParamsToJson(result.params as object)
    assert.equal(wire.method_progress_factor, method === "Linear" ? 0 : 27)
    assert.deepEqual(wire.gain_account_id, { some: 4 })
    assert.equal("show_disposal_accounts" in wire, false)
  }
})

test("hiding existing disposal fields during an edit does not clear their saved settings", () => {
  const asset = { id: 40, companyId: 9, state: { tag: "Draft" }, ...createValues, method: { tag: "Degressive" } }
  const result = toAssetUpdateParams({ ...assetEditDefaults(asset), name: "Laptop Pro", showDisposalAccounts: false }, asset, lookups)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const wire = stdbParamsToJson(result.params as object, "UpdateAccountAssetParams")
  assert.deepEqual(wire.name, { some: "Laptop Pro" })
  assert.deepEqual(wire.method_progress_factor, { none: [] })
  assert.deepEqual(wire.gain_account_id, { none: [] })
  assert.deepEqual(wire.loss_account_id, { none: [] })
  assert.deepEqual(wire.account_disposal_id, { none: [] })
  assert.equal("show_disposal_accounts" in wire, false)
})
