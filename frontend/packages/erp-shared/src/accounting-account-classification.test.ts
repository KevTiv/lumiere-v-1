import assert from "node:assert/strict"
import test from "node:test"

import {
  accountIsEligibleManualInvoiceTaxPosting,
  accountMatchesManualInvoiceLineType,
} from "./accounting-account-classification"

const base = {
  organizationId: 1,
  companyId: 2,
  userTypeId: 10,
}

test("explicit account type is authoritative over broader classifications", () => {
  assert.equal(
    accountMatchesManualInvoiceLineType(
      { ...base, internalType: "Receivable", internalGroup: "Income" },
      [{ id: 10, organizationId: 1, companyId: 2, internalGroup: "Income" }],
      "Income",
    ),
    false,
  )
})

test("invoice line classification falls back through group then account type", () => {
  assert.equal(
    accountMatchesManualInvoiceLineType(
      { ...base, internalGroup: { tag: "Expense" } },
      [],
      "Expense",
    ),
    true,
  )
  assert.equal(
    accountMatchesManualInvoiceLineType(
      base,
      [{ id: 10, organizationId: 1, companyId: 2, type: "income" }],
      "Income",
    ),
    true,
  )
})

test("account type fallback enforces tenant, company, and active scope", () => {
  for (const accountType of [
    { id: 10, organizationId: 9, companyId: 2, internalGroup: "Income" },
    { id: 10, organizationId: 1, companyId: 9, internalGroup: "Income" },
    { id: 10, organizationId: 1, companyId: 2, internalGroup: "Income", isDeprecated: true },
  ]) {
    assert.equal(
      accountMatchesManualInvoiceLineType(base, [accountType], "Income"),
      false,
    )
  }
})

test("tax posting eligibility accepts group-only accounts and rejects explicit receivable/payable", () => {
  assert.equal(
    accountIsEligibleManualInvoiceTaxPosting(
      {
        companyId: 2,
        deprecated: false,
        internalType: undefined,
        internalGroup: "Liability",
        currencyId: null,
      },
      2,
      5,
    ),
    true,
  )

  for (const internalType of ["Receivable", { tag: "Payable" }]) {
    assert.equal(
      accountIsEligibleManualInvoiceTaxPosting(
        { companyId: 2, deprecated: false, internalType, currencyId: 5 },
        2,
        5,
      ),
      false,
    )
  }
})

test("tax posting eligibility enforces company, active, and currency scope", () => {
  for (const account of [
    { companyId: 9, deprecated: false, currencyId: 5 },
    { companyId: 2, deprecated: true, currencyId: 5 },
    { companyId: 2, deprecated: false, currencyId: 9 },
  ]) {
    assert.equal(accountIsEligibleManualInvoiceTaxPosting(account, 2, 5), false)
  }
})
