import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  callReducerBff,
  chooseSelectOptionByLabel,
  expectNoAppError,
  expectSeededText,
  fetchAccountSelectLabelByInternalType,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchDraftInvoiceMoveIdByPartner,
  fetchFirstPricelistId,
  fetchFirstWarehouseId,
  fetchSalesInvoiceJournalLabel,
  fetchSessionOrganizationId,
  gotoModule,
  openAccountingTab,
  scalarQueryId,
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForSaleOrderBillableLines,
  waitForSaleOrderConfirmed,
} from "./helpers"

/**
 * Smoke-level sales → invoice linkage checks.
 *
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`) for the
 * seeded SO/INV tests. The quick-action test does not depend on fixture rows.
 *
 * Seeded records:
 * - Sale order SO/2024/0001 (client ref ACME-2024-001, partner Acme Corporation)
 * - Customer invoice INV/2024/00001 linked via `invoice_origin` to SO/2024/0001
 *
 * Does not exercise full order-to-invoice creation; that path needs journals,
 * partners, and products beyond what a minimal smoke create can guarantee.
 */
test.describe("Sales and invoice flow e2e", { tag: "@dev-fixture" }, () => {
  test("seeded sale order is visible on Sales Orders tab", { tag: "@dev-fixture" }, async ({ page }) => {
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()

    await expectSeededText(page, "SO/2024/0001", "/api/query/sale-orders")
    await expect(page.getByText("ACME-2024-001")).toBeVisible()
    await expectNoAppError(page)
  })

  test("seeded customer invoice linked to sale order appears in Accounting Invoices", { tag: "@dev-fixture" }, async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "invoices")
    await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible({ timeout: 30_000 })

    await expectSeededText(page, "INV/2024/00001", "/api/query/account-moves")
    await expect(page.getByText("Acme Corporation").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /new invoice/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("sales dashboard quick action opens new sale order form", async ({ page }) => {
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-dashboard").click()

    await page.getByTestId("quick-action-create_sale_order").click()
    await expect(page.getByTestId("form-modal-new-sale-order")).toBeVisible()

    await page.getByTestId("form-modal-new-sale-order").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-sale-order")).toBeHidden()
    await expectNoAppError(page)
  })
})

// ── SAL-004: Full SO → Invoice creation ───────────────────────────────────────

/**
 * Helper wrappers for Option<T> encoding used by the BFF reducer call layer.
 * Mirrors the pattern established in accounting-post-reconcile.spec.ts.
 */
const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

/**
 * Poll until the sale-orders query contains the given order id.
 * Returns the newest matching row id.
 */
async function fetchLatestSaleOrderIdByPartnerId(
  page: Parameters<typeof callReducerBff>[0],
  partnerId: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/sale-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; partnerId?: unknown; partner_id?: unknown }>
      }
      const matches = (json.data ?? []).filter(
        (row) => scalarQueryId(row.partnerId ?? row.partner_id) === partnerId,
      )
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`sale order not found for partner id ${partnerId}`)
}

/**
 * Create a customer contact via BFF and poll until it appears in the contacts
 * query. Returns the contact id and name.
 *
 * Uses the same shape as the `createCustomerContact` helper in
 * accounting-post-reconcile.spec.ts so this test stays consistent with the
 * established pattern for contact creation.
 */
async function createSaleTestContact(
  page: Parameters<typeof callReducerBff>[0],
  organizationId: number,
  name: string,
): Promise<{ id: number; name: string }> {
  await callReducerBff(page, "create_contact", [
    organizationId,
    {
      name,
      type: "contact",
      email: some(`${name.toLowerCase().replace(/\s+/g, "-")}@example.test`),
      phone: none,
      mobile: none,
      company_id: none,
      is_customer: true,
      is_vendor: false,
      is_employee: false,
      is_prospect: false,
      is_partner: false,
      customer_rank: 1,
      supplier_rank: 0,
      display_name: none,
      first_name: none,
      last_name: none,
      title: none,
      email_secondary: none,
      fax: none,
      website: none,
      street: none,
      street2: none,
      city: none,
      state_code: none,
      zip: none,
      country_code: some("US"),
      tax_id: none,
      company_registry: none,
      industry: none,
      employees_count: none,
      annual_revenue: none,
      description: none,
      salesperson_id: none,
      assigned_user_id: none,
      parent_id: none,
      user_id: none,
      color: none,
      metadata: some(JSON.stringify({ test: "sal-004-so-invoice" })),
    },
  ])

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/contacts")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((c) => c.name === name)
      const id = scalarQueryId(row?.id)
      if (id != null) return { id, name }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`customer contact not found after create: ${name}`)
}

/**
 * Fetch the first service product id from the products query.
 *
 * Service products (type = "service") do not require stock, allowing the sale
 * order to be confirmed and invoiced on the "order" policy without fulfillment.
 * Falls back to the first available product if no service product is found.
 */
async function fetchFirstServiceProduct(
  page: Parameters<typeof callReducerBff>[0],
): Promise<{ id: number; uomId: number }> {
  const res = await page.request.get("/api/query/products")
  if (!res.ok()) throw new Error(`products query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; type?: string; type_?: string; uomId?: unknown; uom_id?: unknown }>
  }
  const rows = json.data ?? []
  if (rows.length === 0) throw new Error("no products in seed data")

  // Prefer service products — they skip stock reservation on confirm.
  const serviceRow = rows.find((p) => {
    const t = String(p.type ?? p.type_ ?? "").toLowerCase()
    return t === "service"
  })
  const row = serviceRow ?? rows[0]
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error("product row missing id")
  // Use the product's own configured UoM — a mismatched UoM (e.g. the first
  // UoM in seed data) can belong to a different UoM category with no
  // conversion factor to the product's UoM, which fails at invoice time.
  const uomId = scalarQueryId(row?.uomId ?? row?.uom_id)
  if (uomId == null) throw new Error("product row missing uomId")
  return { id, uomId }
}

/**
 * SAL-004: Full SO → Invoice flow in browser.
 *
 * Strategy:
 *   1. Create a customer contact via BFF.
 *   2. Resolve required refs (pricelist, warehouse, UoM, currency, product) via BFF queries.
 *   3. Create a sale order via BFF `create_sale_order` with invoice_policy="order" so lines
 *      are immediately billable on confirmation without stock fulfillment. A service-type
 *      product is preferred to avoid the stock-reservation path entirely.
 *   4. Confirm via BFF `confirm_sales_order`.
 *   5. Navigate to Sales → Orders tab in the browser.
 *   6. Select the SO row and click the "Create Invoice" action.
 *   7. Fill the invoice form (journal, income account, receivable account).
 *   8. Assert the draft invoice was created via the BFF account-moves query.
 *
 * The UI-driven assertions focus on steps 5-8 (the browser "Create Invoice" path),
 * matching the acceptance criterion: "Full SO → Invoice flow passes in browser".
 */
test.describe("SAL-004: Full SO → Invoice creation flow", { tag: "@p0" }, () => {
  test(
    "creates sale order via BFF, confirms it, then creates invoice via UI",
    async ({ page }) => {
      test.setTimeout(240_000)

      // ── Step 1: Resolve org and company ──────────────────────────────────────
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)

      // ── Step 2: Create customer contact ──────────────────────────────────────
      const customerName = smokeName("sal004-customer")
      const customer = await createSaleTestContact(page, organizationId, customerName)

      // ── Step 3: Resolve reference data ───────────────────────────────────────
      const pricelistId = await fetchFirstPricelistId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const currencyId = await fetchCurrencyIdByCode(page, "USD")
      const { id: productId, uomId } = await fetchFirstServiceProduct(page)

      // ── Step 4: Create sale order via BFF ────────────────────────────────────
      // invoice_policy = "order" makes lines billable immediately on confirm
      // without requiring delivery quantity. Combined with a service product
      // (which skips stock reservation), this avoids the full fulfillment chain.
      await callReducerBff(page, "create_sale_order", [
        organizationId,
        {
          company_id: some(companyId),
          partner_id: customer.id,
          partner_invoice_id: customer.id,
          partner_shipping_id: customer.id,
          pricelist_id: pricelistId,
          currency_id: currencyId,
          warehouse_id: warehouseId,
          order_lines: [
            {
              product_id: productId,
              quantity: 1.0,
              uom_id: uomId,
              price_unit: some(500.0),
              discount: 0.0,
              tax_ids: [],
              name: none,
              sequence: 10,
              is_downpayment: false,
              display_type: none,
              product_variant_id: none,
              packaging_id: none,
              route_id: none,
              analytic_tag_ids: [],
              customer_lead: none,
              metadata: none,
            },
          ],
          origin: none,
          client_order_ref: none,
          payment_term_id: none,
          fiscal_position_id: none,
          team_id: none,
          opportunity_id: none,
          proposal_id: none,
          note: none,
          terms_and_conditions: none,
          validity_days: none,
          shipping_policy: none,
          picking_policy: none,
          campaign_id: none,
          medium_id: none,
          source_id: none,
          commitment_date: none,
          expected_date: none,
          incoterm_id: none,
          incoterm: none,
          incoterm_location: none,
          carrier_id: none,
          customer_lead: none,
          analytic_account_id: none,
          user_id: none,
          is_printed: none,
          is_locked: none,
          is_dropship: none,
          invoice_policy: some("order"),
          message_follower_ids: none,
          message_partner_ids: none,
          message_channel_ids: none,
          activity_ids: none,
          metadata: some(JSON.stringify({ test: "sal-004-so-invoice" })),
        },
      ])

      // Poll until the new SO appears in the query for this partner.
      const orderId = await fetchLatestSaleOrderIdByPartnerId(page, customer.id)

      // ── Step 5: Confirm sale order via BFF ───────────────────────────────────
      await callReducerBff(page, "confirm_sales_order", [
        organizationId,
        companyId,
        orderId,
      ])

      // Wait for state + billable lines (qty_to_invoice > 0) to propagate.
      await waitForSaleOrderConfirmed(page, orderId)
      await waitForSaleOrderBillableLines(page, orderId)

      // ── Step 6: Resolve invoice form labels ──────────────────────────────────
      const journalLabel = await fetchSalesInvoiceJournalLabel(page)
      const incomeLabel = await fetchAccountSelectLabelByInternalType(page, "income")
      const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")

      // ── Step 7: Navigate to Sales → Orders and select the SO ─────────────────
      await gotoModule(page, "/sales", "sales")
      await page.getByTestId("module-tab-sales-orders").click()

      await selectEntityRowById(page, orderId)

      // ── Step 8: Click "Create Invoice" action ─────────────────────────────────
      await waitForEntityActionEnabled(page, "entity-action-create-invoice")
      await page.getByTestId("entity-action-create-invoice").click()
      await expect(page.getByTestId("form-modal-create-invoice-from-sale-order")).toBeVisible({
        timeout: 15_000,
      })

      // ── Step 9: Fill and submit the invoice creation form ─────────────────────
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", incomeLabel)
      await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)

      const [invoiceRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            matchesOperationResponse(res, "create_invoice_from_sale_order") && res.ok(),
          { timeout: 30_000 },
        ),
        submitForm(page, "create-invoice-from-sale-order"),
      ])
      expect(invoiceRes.ok()).toBe(true)

      // ── Step 10: Assert draft invoice was created ─────────────────────────────
      // fetchDraftInvoiceMoveIdByPartner matches by invoicePartnerDisplayName which
      // the create_invoice_from_sale_order reducer copies from the SO partner.
      const invoiceMoveId = await fetchDraftInvoiceMoveIdByPartner(page, customerName)
      expect(invoiceMoveId).toBeGreaterThan(0)

      // Verify the draft invoice appears in the account-moves query with residual > 0,
      // confirming it was created with line amounts (not just a zero-value stub).
      await expect
        .poll(
          async () => {
            const res = await page.request.get("/api/query/account-moves")
            if (!res.ok()) return null
            const json = (await res.json()) as {
              data?: Array<{
                id?: unknown
                state?: unknown
                amountTotal?: unknown
                amount_total?: unknown
              }>
            }
            const move = (json.data ?? []).find((m) => scalarQueryId(m.id) === invoiceMoveId)
            if (!move) return null
            return Number(move.amountTotal ?? move.amount_total ?? 0)
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0)

      await expectNoAppError(page)
    },
  )
})
