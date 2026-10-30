import assert from "node:assert/strict"
import test from "node:test"
import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
import {
  buildManualInvoiceCatalog,
  manualInvoiceAccountChoices,
  manualInvoiceJournalChoices,
  manualInvoiceTaxChoices,
} from "./manual-invoice-catalog"
type Account = ResourceQueryRowMap["account-accounts"]
type Journal = ResourceQueryRowMap["account-journals"]
type Tax = ResourceQueryRowMap["account-taxes"]
type TaxGroup = ResourceQueryRowMap["tax-groups"]
const account = (overrides: Partial<Account> = {}): Account => ({
  id: 1n,
  organizationId: 7n,
  companyId: 9n,
  code: "4000",
  name: "Revenue",
  deprecated: false,
  currencyId: undefined,
  internalType: { tag: "Income" },
  internalGroup: { tag: "Income" },
  ...overrides,
})
const journal = (overrides: Partial<Journal> = {}): Journal => ({
  id: 1n,
  organizationId: 7n,
  companyId: 9n,
  name: "Sales",
  code: "INV",
  active: true,
  type: { tag: "Sale" },
  currencyId: undefined,
  ...overrides,
})
test("manual invoice account choices preserve company, currency, deprecation and type restrictions", () => {
  const options = manualInvoiceAccountChoices({
    accounts: [
      account(),
      account({ id: 2n, companyId: 12n }),
      account({ id: 3n, deprecated: true }),
      account({ id: 4n, currencyId: 2n }),
      account({ id: 5n, internalType: { tag: "Receivable" }, internalGroup: { tag: "Asset" } }),
    ],
    accountTypes: [],
    operatingCompanyId: 9n,
    manualInvoiceCurrencyId: 1n,
  })
  assert.deepEqual(
    options.income.map((row) => row.value),
    ["1"],
  )
  assert.deepEqual(
    options.receivable.map((row) => row.value),
    ["5"],
  )
  assert.deepEqual(options.expense, [])
  assert.deepEqual(options.payable, [])
})
test("manual invoice journals require active matching sales/purchase type and currency", () => {
  const options = manualInvoiceJournalChoices({
    journals: [
      journal(),
      journal({ id: 2n, type: { tag: "Purchase" } }),
      journal({ id: 3n, active: false }),
      journal({ id: 4n, companyId: 12n }),
      journal({ id: 5n, currencyId: 2n }),
    ],
    operatingCompanyId: 9n,
    manualInvoiceCurrencyId: 1n,
  })
  assert.deepEqual(
    options.sales.map((row) => row.value),
    ["1"],
  )
  assert.deepEqual(
    options.purchases.map((row) => row.value),
    ["2"],
  )
})
test("manual invoice tax choices require an eligible current-company posting account and valid percentage", () => {
  const baseTax: Tax = {
    id: 1n,
    organizationId: 7n,
    name: "VAT",
    companyId: 9n,
    active: true,
    hasNegativeFactor: false,
    typeTaxUse: { tag: "Sale" },
    amountType: { tag: "Percent" },
    amount: 20,
    taxGroupId: 10n,
    priceInclude: false,
  }
  const group: TaxGroup = {
    id: 10n,
    organizationId: 7n,
    companyId: 9n,
    taxPayableAccountId: 100n,
  }
  const accounts = [
    account({ id: 100n, internalGroup: { tag: "Liability" }, internalType: { tag: "Other" } }),
  ]
  const args = {
    accounts,
    taxGroups: [group],
    taxes: [
      baseTax,
      { ...baseTax, id: 2n, amount: 101 },
      { ...baseTax, id: 3n, taxGroupId: 20n },
      { ...baseTax, id: 4n, companyId: 12n },
    ],
    operatingCompanyId: 9n,
    manualInvoiceCurrencyId: 1n,
  }
  assert.deepEqual(
    manualInvoiceTaxChoices(args).sales.map((row) => row.value),
    ["1"],
  )
  assert.deepEqual(
    manualInvoiceTaxChoices({
      ...args,
      accounts: [account({ id: 100n, deprecated: true })],
    }).sales,
    [],
  )
  assert.deepEqual(
    manualInvoiceTaxChoices({
      ...args,
      taxGroups: [{ ...group, companyId: 12n }],
    }).sales,
    [],
  )
})
test("invoice and bill catalogs keep distinct partners, journals and commercial accounts", () => {
  const result = buildManualInvoiceCatalog({
    accounts: [
      account(),
      account({ id: 2n, internalGroup: { tag: "Expense" } }),
      account({ id: 3n, internalType: { tag: "Receivable" } }),
      account({ id: 4n, internalType: { tag: "Payable" } }),
    ],
    contacts: [
      {
        id: 11n,
        organizationId: 7n,
        companyId: undefined,
        name: "Customer",
        displayName: "Customer",
        isCustomer: true,
        customerRank: 1,
        isVendor: false,
        supplierRank: 0,
        deletedAt: undefined,
      },
      {
        id: 12n,
        organizationId: 7n,
        companyId: undefined,
        name: "Supplier",
        displayName: "Supplier",
        isCustomer: false,
        customerRank: 0,
        isVendor: true,
        supplierRank: 1,
        deletedAt: undefined,
      },
      {
        id: 13n,
        organizationId: 7n,
        companyId: 12n,
        name: "Other company",
        displayName: "Other company",
        isCustomer: true,
        customerRank: 1,
        isVendor: false,
        supplierRank: 0,
        deletedAt: undefined,
      },
    ],
    journals: [journal(), journal({ id: 2n, type: { tag: "Purchase" } })],
    products: [],
    taxes: [],
    taxGroups: [],
    defaultCurrencyId: 1n,
    operatingCompanyId: 9n,
  })
  assert.deepEqual(
    result.invoice.partners.map((row) => row.value),
    ["11"],
  )
  assert.deepEqual(
    result.bill.partners.map((row) => row.value),
    ["12"],
  )
  assert.deepEqual(
    result.invoice.journals.map((row) => row.value),
    ["1"],
  )
  assert.deepEqual(
    result.bill.journals.map((row) => row.value),
    ["2"],
  )
  assert.deepEqual(
    result.invoice.commercial.map((row) => row.value),
    ["1", "3", "4"],
  )
  assert.deepEqual(
    result.bill.commercial.map((row) => row.value),
    ["2"],
  )
})

test("active catalogs preserve configured journal defaults and exact account currency restrictions", () => {
  const result = buildManualInvoiceCatalog({
    accounts: [account({ id: 9007199254740993n, currencyId: 9007199254740995n })],
    contacts: [],
    journals: [journal({ defaultAccountId: 9007199254740993n })],
    products: [], taxes: [], taxGroups: [], defaultCurrencyId: 1n, operatingCompanyId: 9n,
  })
  assert.equal(result.invoice.journals[0]?.defaultAccountId, "9007199254740993")
  assert.equal(result.invoice.commercial[0]?.currencyId, "9007199254740995")
})
