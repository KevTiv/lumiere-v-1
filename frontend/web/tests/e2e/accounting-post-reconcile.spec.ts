import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchAccountIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  postDraftInvoiceViaUi,
  scalarQueryId,
  smokeName,
  waitForMovePosted,
} from "./helpers"

/**
 * ACC-003: journal entry create -> post -> reconcile against a posted invoice.
 *
 * Backend: `post_account_move` (spacetimedb/src/accounting/journal_entries.rs) for the
 * plain journal entry post; `reconcile_payment_with_invoice` for the reconcile step, which
 * matches receivable/payable lines by `account_internal_type` between two POSTED moves.
 *
 * Setup (invoice + the entry's own balanced lines) goes through the reducer BFF directly —
 * matching the pattern already used in auth-permission-enforcement.spec.ts — so the UI
 * interaction under test stays focused on posting the journal entry and running the
 * reconcile flow, not on re-proving generic invoice-line-entry forms.
 */

function stdbTimestampMicros(isoDate: string): { __timestamp_micros_since_unix_epoch__: number } {
  const micros = BigInt(new Date(isoDate).getTime()) * 1000n
  return { __timestamp_micros_since_unix_epoch__: Number(micros) }
}

// Far-future date so posting is never blocked by a closed/seeded fiscal period.
const POSTABLE_MOVE_DATE = "2099-06-01T00:00:00.000Z"

const moveLineBase = {
  quantity: 1,
  price_unit: 0,
  discount: 0,
  tax_ids: [] as number[],
  partner_id: null,
  product_id: null,
  product_uom_id: null,
  product_category_id: null,
  analytic_account_id: null,
  analytic_tag_ids: [] as number[],
  display_type: null,
  is_downpayment: false,
  exclude_from_invoice_tab: false,
  blocked: false,
  group_tax_id: null,
  tax_line_id: null,
  tax_group_id: null,
  tax_repartition_line_id: null,
  tax_audit: null,
  reconcile_model_id: null,
  payment_id: null,
  statement_line_id: null,
  matching_number: null,
  matching_label: null,
  expected_pay_date: null,
  expected_pay_date_currency_id: null,
  expected_pay_date_amount: 0,
  expected_pay_date_residual: 0,
  metadata: null,
}

async function fetchJournalIdByCode(page: Page, code: string): Promise<number> {
  const res = await page.request.get("/api/query/account-journals")
  if (!res.ok()) throw new Error(`account-journals query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; code?: string }> }
  const row = (json.data ?? []).find((j) => String(j.code ?? "").toUpperCase() === code.toUpperCase())
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`journal not found: ${code}`)
  return id
}

async function fetchCustomerPartnerId(page: Page): Promise<{ id: number; name: string }> {
  const res = await page.request.get("/api/query/contacts")
  if (!res.ok()) throw new Error(`contacts query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; name?: string; isCustomer?: boolean }>
  }
  const row = (json.data ?? []).find((c) => c.isCustomer !== false && c.name)
  const id = scalarQueryId(row?.id)
  if (id == null || !row?.name) throw new Error("no customer contact in seed data")
  return { id, name: row.name }
}

async function fetchDraftMoveIdByRef(page: Page, ref: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; ref?: string }> }
      const row = (json.data ?? []).find((m) => m.ref === ref)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft account move not found for ref: ${ref}`)
}

/** Create a draft OutInvoice move (AR debit / Revenue credit) via the reducer BFF. */
async function createDraftInvoice(
  page: Page,
  args: {
    organizationId: number
    companyId: number
    partnerId: number
    partnerName: string
    journalId: number
    arAccountId: number
    revenueAccountId: number
    amount: number
    ref: string
  },
): Promise<void> {
  await callReducerBff(page, "create_account_move", [
    args.organizationId,
    {
      company_id: args.companyId,
      journal_id: args.journalId,
      move_type: { tag: "OutInvoice" },
      date: stdbTimestampMicros(POSTABLE_MOVE_DATE),
      name: "",
      ref: args.ref,
      auto_post: false,
      to_check: false,
      is_storno: false,
      partner_id: args.partnerId,
      partner_bank_id: null,
      fiscal_position_id: null,
      invoice_date: stdbTimestampMicros(POSTABLE_MOVE_DATE),
      invoice_date_due: stdbTimestampMicros(POSTABLE_MOVE_DATE),
      invoice_payment_term_id: null,
      payment_reference: null,
      invoice_origin: null,
      invoice_partner_display_name: args.partnerName,
      invoice_cash_rounding_id: null,
      partner_shipping_id: null,
      sale_order_id: null,
      invoice_incoterm_id: null,
      incoterm_location: null,
      campaign_id: null,
      source_id: null,
      medium_id: null,
      secure_sequence_number: null,
      metadata: JSON.stringify({ test: "acc-003-post-reconcile" }),
    },
  ])

  const moveId = await fetchDraftMoveIdByRef(page, args.ref)

  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.arAccountId,
      name: "AR",
      debit: args.amount,
      credit: 0,
      sequence: 1,
      ...moveLineBase,
    },
  ])
  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.revenueAccountId,
      name: "Revenue",
      debit: 0,
      credit: args.amount,
      sequence: 2,
      ...moveLineBase,
    },
  ])
}

/** Create a draft plain Entry move (AR credit / Bank debit) via the reducer BFF. */
async function createDraftJournalEntry(
  page: Page,
  args: {
    organizationId: number
    companyId: number
    journalId: number
    arAccountId: number
    bankAccountId: number
    amount: number
    ref: string
  },
): Promise<void> {
  await callReducerBff(page, "create_account_move", [
    args.organizationId,
    {
      company_id: args.companyId,
      journal_id: args.journalId,
      move_type: { tag: "Entry" },
      date: stdbTimestampMicros(POSTABLE_MOVE_DATE),
      name: "",
      ref: args.ref,
      auto_post: false,
      to_check: false,
      is_storno: false,
      partner_id: null,
      partner_bank_id: null,
      fiscal_position_id: null,
      invoice_date: null,
      invoice_date_due: null,
      invoice_payment_term_id: null,
      payment_reference: null,
      invoice_origin: null,
      invoice_partner_display_name: null,
      invoice_cash_rounding_id: null,
      partner_shipping_id: null,
      sale_order_id: null,
      invoice_incoterm_id: null,
      incoterm_location: null,
      campaign_id: null,
      source_id: null,
      medium_id: null,
      secure_sequence_number: null,
      metadata: JSON.stringify({ test: "acc-003-post-reconcile" }),
    },
  ])

  const moveId = await fetchDraftMoveIdByRef(page, args.ref)

  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.bankAccountId,
      name: "Bank receipt",
      debit: args.amount,
      credit: 0,
      sequence: 1,
      ...moveLineBase,
    },
  ])
  await callReducerBff(page, "add_account_move_line", [
    args.organizationId,
    moveId,
    {
      account_id: args.arAccountId,
      name: "AR settlement",
      debit: 0,
      credit: args.amount,
      sequence: 2,
      ...moveLineBase,
    },
  ])
}

test.describe("Accounting journal entry post + reconcile", { tag: "@p0" }, () => {
  test("posts a draft journal entry via UI, then reconciles it against a posted invoice", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const arAccountId = await fetchAccountIdByCode(page, "1100")
    const revenueAccountId = await fetchAccountIdByCode(page, "4000")
    const bankAccountId = await fetchAccountIdByCode(page, "1200")
    const invJournalId = await fetchJournalIdByCode(page, "INV")
    const miscJournalId = await fetchJournalIdByCode(page, "MISC")
    const customer = await fetchCustomerPartnerId(page)

    const amount = 250
    const invoiceRef = smokeName("acc003-inv")
    const entryRef = smokeName("acc003-je")

    // Posted invoice to reconcile against (setup via reducer BFF, not UI —
    // this test's UI-driven assertions are the entry post and the reconcile).
    await createDraftInvoice(page, {
      organizationId,
      companyId,
      partnerId: customer.id,
      partnerName: customer.name,
      journalId: invJournalId,
      arAccountId,
      revenueAccountId,
      amount,
      ref: invoiceRef,
    })
    const invoiceMoveId = await postDraftInvoiceViaUi(page, customer.name)

    // Draft journal entry with balanced AR/Bank lines already attached — only the
    // post action itself is exercised via UI below.
    await createDraftJournalEntry(page, {
      organizationId,
      companyId,
      journalId: miscJournalId,
      arAccountId,
      bankAccountId,
      amount,
      ref: entryRef,
    })
    const entryMoveId = await fetchDraftMoveIdByRef(page, entryRef)

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-journal-entries").click()
    const entryRow = page.locator("tbody tr").filter({ hasText: entryRef }).first()
    await expect(entryRow).toBeVisible({ timeout: 30_000 })
    await entryRow.click()

    const postButton = page.getByRole("dialog").getByRole("button", { name: /post/i })
    await expect(postButton).toBeVisible({ timeout: 15_000 })
    const [postRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/post_account_move") && res.ok(),
        { timeout: 30_000 },
      ),
      postButton.click(),
    ])
    expect(postRes.ok()).toBe(true)
    await waitForMovePosted(page, entryMoveId)

    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("entity-action-pay-reconcile-moves").click()
    await expect(page.getByTestId("form-modal-reconcile-payment-invoice")).toBeVisible({
      timeout: 15_000,
    })

    await page.getByTestId("form-field-paymentMoveId").click()
    await page
      .locator('[role="listbox"]:visible')
      .getByRole("option", { name: new RegExp(entryRef) })
      .first()
      .click()

    await page.getByTestId("form-field-invoiceMoveId").click()
    await page
      .locator('[role="listbox"]:visible')
      .getByRole("option", { name: new RegExp(invoiceRef) })
      .first()
      .click()

    const [reconcileRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/reconcile_payment_with_invoice") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("form-submit-reconcile-payment-invoice").click(),
    ])
    expect(reconcileRes.ok()).toBe(true)
    await expect(page.getByTestId("form-modal-reconcile-payment-invoice")).toBeHidden({
      timeout: 15_000,
    })

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/account-move-lines")
          if (!res.ok()) return null
          const json = (await res.json()) as {
            data?: Array<{
              moveId?: unknown
              accountId?: unknown
              amountResidual?: unknown
              isMatching?: unknown
            }>
          }
          const line = (json.data ?? []).find(
            (l) => scalarQueryId(l.moveId) === invoiceMoveId && scalarQueryId(l.accountId) === arAccountId,
          )
          if (!line) return null
          return { residual: Number(line.amountResidual ?? -1), matching: Boolean(line.isMatching) }
        },
        { timeout: 30_000 },
      )
      .toEqual({ residual: 0, matching: true })
  })
})
