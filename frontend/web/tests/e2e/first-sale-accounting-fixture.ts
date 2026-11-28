import { expect, type Page } from "@playwright/test"

import { create, id } from "./cov-scheduler-manufacturing-fixtures"
import { postGeneratedOperationOk } from "./generated-operation"
import { scalarQueryId, scalarQueryString } from "./helpers"
import { rows } from "./cov08-support"

const none = { none: [] }
const some = <T,>(value: T) => ({ some: value })

function scoped(companyId: number, row: Record<string, unknown>) {
  return scalarQueryId(row.companyId ?? row.company_id) === companyId
}

function timestamp(iso: string) {
  return { __timestamp_micros_since_unix_epoch__: new Date(iso).getTime() * 1000 }
}

/** Fixture prerequisite only. The invoice, posting, payment and settlement are operated in the browser. */
export async function seedFirstSaleAccounting(page: Page, companyId: number, currencyId: number) {
  const accounts = [
    { internalType: "receivable", group: "asset", code: "1100", name: "Fixture receivable", reconcile: true },
    { internalType: "income", group: "income", code: "4000", name: "Fixture income", reconcile: false },
    { internalType: "liquidity", group: "asset", code: "1200", name: "Fixture liquidity", reconcile: true },
    { internalType: "expense", group: "expense", code: "5000", name: "Cost of Goods Sold", reconcile: false },
    { internalType: "asset", group: "asset", code: "1400", name: "Inventory Valuation", reconcile: false },
  ] as const
  const accountIds = new Map<string, number>()
  for (const account of accounts) {
    const { internalType, group, code, name, reconcile } = account
    const accountType = await create(page, "account-account-types", "create_account_account_type", {
      params: {
        name, type: internalType, internal_group: { [group]: [] }, include_initial_balance: true,
        company_id: some(companyId), metadata: none,
      },
    }, (row) => row.name === name && scoped(companyId, row))
    const saved = await create(page, "account-accounts", "create_account_account", {
      params: {
        company_id: some(companyId), code, name, user_type_id: id(accountType), currency_id: none,
        internal_type: some({ [internalType]: [] }), internal_group: some({ [group]: [] }), group_id: none,
        reconcile, tax_ids: [], note: none, opening_debit: 0, opening_credit: 0,
        allowed_journal_ids: [], non_trade: false, is_off_balance: false, metadata: none,
      },
    }, (row) => row.code === code && scoped(companyId, row))
    accountIds.set(internalType, id(saved))
  }

  for (const journal of [{ type: "sale", code: "INV", account: "income" }, { type: "bank", code: "BNK", account: "liquidity" }] as const) {
    const defaultAccountId = accountIds.get(journal.account)!
    await create(page, "account-journals", "create_account_journal", {
      params: {
        company_id: some(companyId), name: `Fixture ${journal.type}`, code: journal.code,
        type: { [journal.type]: [] }, currency_id: some(currencyId), default_account_id: some(defaultAccountId),
        suspense_account_id: none, loss_account_id: none, profit_account_id: none,
        bank_account_id: journal.type === "bank" ? some(defaultAccountId) : none,
        payment_credit_account_id: none, payment_debit_account_id: none, invoice_reference_type: none,
        invoice_reference_model: none, sequence_id: none, refund_sequence_id: none, sequence_override_regex: none,
        secure_sequence_id: none, alias_name: none, alias_domain: none, sale_activity_type_id: none,
        sale_activity_user_id: none, sale_activity_note: none, sale_activity_date_deadline: none,
        restrict_mode_hash_table: false, active: true, at_least_one_inbound: false,
        at_least_one_outbound: false, dedicated_payment_method_ids: [], sale_activity_done: false, metadata: none,
      },
    }, (row) => row.code === journal.code && scoped(companyId, row))
  }

  const year = new Date().getUTCFullYear()
  const dateFrom = timestamp(`${year}-01-01T00:00:00.000Z`)
  const dateTo = timestamp(`${year}-12-31T23:59:59.999Z`)
  const name = `Fixture FY ${year}`
  const fiscalYear = await create(page, "fiscal-years", "create_fiscal_year", {
    companyId,
    params: {
      name, date_from: dateFrom, date_to: dateTo, type: "normal",
      is_adjustment: false, notes: none, metadata: none,
    },
  }, (row) => row.name === name && scoped(companyId, row))
  const fiscalYearId = id(fiscalYear)
  await postGeneratedOperationOk(page, "open_fiscal_year", { companyId, fiscalYearId })

  const code = `FY${year}`
  const period = await create(page, "account-periods", "create_account_period", {
    companyId,
    params: {
      name, code, date_from: dateFrom, date_to: dateTo, fiscal_year_id: fiscalYearId,
      is_adjustment: false, notes: none, metadata: none,
    },
  }, (row) => row.code === code && scoped(companyId, row))
  const periodId = id(period)
  if (scalarQueryString(period.state).toLowerCase() === "draft") {
    await postGeneratedOperationOk(page, "open_account_period", { companyId, periodId })
  }
  await expect.poll(async () => {
    const saved = (await rows(page, "account-periods")).find((row) => scalarQueryId(row.id) === periodId)
    return scalarQueryString(saved?.state).toLowerCase()
  }).toBe("open")
}
