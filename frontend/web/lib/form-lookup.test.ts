import { companyCustomerDestination, usableQuotationPricelists } from "./first-sale-readiness"
import assert from "node:assert/strict"
import test from "node:test"

import {
  accountJournalRowsToSelectOptions,
  contactRowsToAccountingPartnerSelectOptions,
  paymentJournalRowsToSelectOptions,
  taxRowsToSelectOptions,
} from "./form-lookup"
import { idListTokens, parseU64IdList } from "./id-list"

test("payment journal options include only reducer-compatible journal types", () => {
  const options = paymentJournalRowsToSelectOptions([
    { id: 1n, code: "SAL", name: "Sales", type: { tag: "Sale" } },
    { id: 2n, code: "BNK", name: "Bank", type: { bank: [] } },
    { id: 3n, code: "CSH", name: "Cash", type_: "Cash" },
    { id: 4n, code: "CHK", name: "Check", type: { tag: "Check" } },
    { id: 5n, code: "GEN", name: "General", type: { general: [] } },
  ])

  assert.deepEqual(options, [
    { value: "2", label: "BNK — Bank" },
    { value: "3", label: "CSH — Cash" },
    { value: "4", label: "CHK — Check" },
  ])
})

test("journal options tolerate omitted projection fields", () => {
  assert.deepEqual(
    accountJournalRowsToSelectOptions([
      { id: 1n },
      { id: 2n, code: "BNK" },
      { id: 3n, name: "Cash" },
    ]),
    [
      { value: "1", label: "1" },
      { value: "2", label: "BNK" },
      { value: "3", label: "Cash" },
    ],
  )
  assert.deepEqual(paymentJournalRowsToSelectOptions([{ id: 1n }]), [])
})

test("accounting payment partner options include customers and suppliers", () => {
  assert.deepEqual(
    contactRowsToAccountingPartnerSelectOptions([
      { id: 1n, displayName: "Customer", isCustomer: true },
      { id: 2n, displayName: "Supplier", isVendor: true },
    ]),
    [
      { value: "1", label: "Customer" },
      { value: "2", label: "Supplier" },
    ],
  )
})

test("tax options keep active taxes for the requested side or scope None", () => {
  const rows = [
    { id: 1n, name: "VAT 18%", active: true, typeTaxUse: { tag: "Sale" } },
    { id: 2n, name: "Input VAT", active: true, typeTaxUse: { tag: "Purchase" } },
    { id: 3n, name: "Exempt", active: true, type_tax_use: "None" },
    { id: 4n, name: "Old VAT", active: false, typeTaxUse: { tag: "Sale" } },
  ]
  assert.deepEqual(taxRowsToSelectOptions(rows, "Sale"), [
    { value: "1", label: "VAT 18%" },
    { value: "3", label: "Exempt" },
  ])
  assert.deepEqual(taxRowsToSelectOptions(rows, "Purchase").map((option) => option.value), ["2", "3"])
})

test("id lists accept picked arrays and the older comma-separated text alike", () => {
  assert.deepEqual(parseU64IdList(["1", "4", "7"]), [1n, 4n, 7n])
  assert.deepEqual(parseU64IdList("1, 4 7;9"), [1n, 4n, 7n, 9n])
  assert.deepEqual(parseU64IdList(""), [])
  assert.deepEqual(parseU64IdList(undefined), [])
  assert.deepEqual(idListTokens([" 2 ", ""]), ["2"])
  assert.throws(() => parseU64IdList("1, x"))
})

test("quotation price lists require an active currency and exact selected company or shared ownership", () => {
  const row = { id: "1", companyId: "7", organizationId: "4", isActive: true, currencyId: "2" }
  const cases = [
    row,
    { ...row, id: "2", companyId: null },
    { ...row, id: "3", companyId: "8" },
    { ...row, id: "4", organizationId: "5" },
    { ...row, id: "5", isActive: false },
    { ...row, id: "6", currencyId: "3" },
    { ...row, id: "7", currencyId: "0" },
    { id: "8", organizationId: "4", isActive: true, currencyId: "2" },
  ]
  assert.deepEqual(usableQuotationPricelists(cases, [{ id: "2" }, { id: "3", isActive: false }], 4n, 7n).map(({ id }) => id), ["1", "2"])
  assert.deepEqual(usableQuotationPricelists(cases, [], 4n, 7n), [])
})

test("delivery guidance accepts only active customer destinations in the order's company", () => {
  const destination = { id: "1", companyId: "7", organizationId: "4", active: true, usage: "customer" }
  assert.equal(companyCustomerDestination([], 4n, 7n), "not-listed")
  assert.equal(companyCustomerDestination([destination], 4n, 7n), "present")
  assert.equal(companyCustomerDestination([{ ...destination, active: false }], 4n, 7n), "not-listed")
  assert.equal(companyCustomerDestination([{ ...destination, usage: "internal" }], 4n, 7n), "not-listed")
  assert.equal(companyCustomerDestination([{ ...destination, companyId: "8" }], 4n, 7n), "not-listed")
  assert.equal(companyCustomerDestination([{ ...destination, companyId: undefined }], 4n, 7n), "unknown")
})
