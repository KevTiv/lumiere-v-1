/**
 * Requires `seed_dev_data` (via `make e2e-smoke` / `pnpm run e2e-seed-fixture`) for the
 * seeded PO visibility test. Other tests create their own data or only open modals.
 *
 * Seeded records: purchase order `PO/2024/0001`.
 */
import { expect, test, type Page } from "@playwright/test"

/** @dev-fixture — excluded from E2E_SUITE=p0; requires seed_dev_data fixture rows. */

import {
  callReducerBff,
  expectNoAppError,
  expectSeededText,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchFirstUomId,
  fetchLatestPurchaseOrderLineIdByOrder,
  fetchLatestPurchaseOrderIdByPartner,
  fetchProductIdByName,
  fetchSessionOrganizationId,
  fetchVendorPartnerIdByName,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  smokeName,
  waitForPurchaseOrderState,
} from "./helpers"

const PURCHASING_TAB_IDS = [
  "dashboard",
  "orders",
  "lines",
  "requisitions",
  "vendors",
  "partner-banks",
  "landed-costs",
  "supplier-intakes",
] as const

async function openPurchasingTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-purchasing-${tabId}`).click()
}

async function assertPurchasingTabRenders(page: Page, tabId: string) {
  await openPurchasingTab(page, tabId)
  await expectNoAppError(page)

  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-create_purchase_order")).toBeVisible()
      await expect(page.getByTestId("quick-action-view_vendors")).toBeVisible()
      break
    case "orders":
      await expect(page.getByTestId("module-create-purchasing-orders")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "lines":
      await expect(page.getByTestId("entity-table")).toBeVisible({ timeout: 30_000 })
      break
    case "requisitions":
      await expect(page.getByTestId("module-create-purchasing-requisitions")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "vendors":
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "partner-banks":
      await expect(page.getByTestId("module-create-purchasing-partner-banks")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "landed-costs":
      await expect(page.getByTestId("module-create-purchasing-landed-costs")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    case "supplier-intakes":
      await expect(page.getByTestId("module-create-purchasing-supplier-intakes")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Purchasing module e2e", { tag: "@dev-fixture" }, () => {
  test("renders purchasing shell and key tabs without errors", async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")

    for (const tabId of PURCHASING_TAB_IDS) {
      await assertPurchasingTabRenders(page, tabId)
    }
  })

  test("dashboard quick action opens purchase order form", async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")
    await openPurchasingTab(page, "dashboard")

    await page.getByTestId("quick-action-create_purchase_order").click()
    await expect(page.getByTestId("form-modal-new-purchase-order")).toBeVisible()

    await page.getByTestId("form-modal-new-purchase-order").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-new-purchase-order")).toBeHidden()
    await expectNoAppError(page)
  })

  test("seeded purchase order appears on Purchase Orders tab", { tag: "@dev-fixture" }, async ({ page }) => {
    await gotoModule(page, "/purchasing", "purchasing")
    await openPurchasingTab(page, "orders")

    await expectSeededText(page, "PO/2024/0001", "/api/query/purchase-orders")
    await expectNoAppError(page)
  })

  test("landed costs create modal opens and cancel", async ({ page }) => {
    await openEntityCreate(page, "/purchasing", "purchasing", "landed-costs", "new-landed-cost")

    await page
      .getByTestId("form-modal-new-landed-cost")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-landed-cost")).toBeHidden()
    await expectNoAppError(page)
  })

  test("supplier intakes create modal opens and cancel", async ({ page }) => {
    await openEntityCreate(page, "/purchasing", "purchasing", "supplier-intakes", "new-supplier-intake")

    await page
      .getByTestId("form-modal-new-supplier-intake")
      .getByRole("button", { name: /^cancel$/i })
      .click()
    await expect(page.getByTestId("form-modal-new-supplier-intake")).toBeHidden()
    await expectNoAppError(page)
  })
})

// ── PUR-007: PO → Receipt → Landed Cost flow ──────────────────────────────────

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

function stdbTimestampMicros(isoDate: string): { __timestamp_micros_since_unix_epoch__: number } {
  const micros = BigInt(new Date(isoDate).getTime()) * 1000n
  return { __timestamp_micros_since_unix_epoch__: Number(micros) }
}

const PUR007_VENDOR_NAME = "Globex Corp"
const PUR007_PRODUCT_NAME = "Lumiere Dev Laptop"

async function fetchPurchaseOrderPickingIds(page: Page, orderId: number): Promise<number[]> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/purchase-orders")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; pickingIds?: unknown; picking_ids?: unknown }>
      }
      const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === orderId)
      const raw = row?.pickingIds ?? row?.picking_ids
      if (Array.isArray(raw) && raw.length > 0) {
        const ids = raw.map((r) => scalarQueryId(r)).filter((id): id is number => id != null)
        if (ids.length > 0) return ids
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`purchase order ${orderId} has no pickings`)
}

async function fetchLatestLandedCostId(page: Page, description: string): Promise<number> {
  const deadline = Date.now() + 30_000
  let lastStatus = 0
  let lastDescriptions: string[] = []
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/landed-costs")
    lastStatus = res.status()
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; description?: string }>
      }
      lastDescriptions = (json.data ?? []).slice(0, 5).map((r) => scalarQueryString(r.description))
      const matches = (json.data ?? []).filter(
        (r) => scalarQueryString(r.description) === description,
      )
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(
    `landed cost not found for description: ${description}; query status=${lastStatus}; latest descriptions=${JSON.stringify(lastDescriptions)}`,
  )
}

async function fetchLandedCostState(page: Page, landedCostId: number): Promise<string> {
  const res = await page.request.get("/api/query/landed-costs")
  if (!res.ok()) throw new Error(`landed-costs query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
  const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === landedCostId)
  return scalarQueryString(row?.state)
}

/**
 * PUR-007: Full purchase order → goods receipt → landed cost flow.
 *
 * Setup (PO create + line + confirm + receive) runs through BFF reducer calls so
 * the interaction under test stays focused on the landed-cost lifecycle: create
 * the landed cost against the receipt picking, add a cost line, compute, post,
 * and apply valuation adjustments to the related stock quants.
 */
test.describe("PUR-007: PO → Receipt → Landed Cost flow", { tag: "@p0" }, () => {
  test("creates PO, receives goods, applies landed costs", async ({ page }) => {
    test.setTimeout(180_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const vendorPartnerId = await fetchVendorPartnerIdByName(page, PUR007_VENDOR_NAME)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")
    const productId = await fetchProductIdByName(page, PUR007_PRODUCT_NAME)
    const uomId = await fetchFirstUomId(page)
    const origin = smokeName("pur007-po")

    await callReducerBff(page, "create_purchase_order", [
      organizationId,
      {
        company_id: some(companyId),
        partner_id: vendorPartnerId,
        currency_id: currencyId,
        origin: some(origin),
        partner_ref: none,
        notes: none,
        date_planned: some(stdbTimestampMicros(new Date(Date.now() + 7 * 86400000).toISOString())),
        payment_term_id: none,
        fiscal_position_id: none,
        incoterm_id: none,
        incoterm_location: none,
        user_id: none,
        invoice_ids: [],
        picking_ids: [],
        message_follower_ids: [],
        message_ids: [],
        activity_ids: [],
        is_quantity_copy: none,
        metadata: some(JSON.stringify({ test: "pur-007-po-receipt-landed-cost" })),
      },
    ])

    const orderId = await fetchLatestPurchaseOrderIdByPartner(page, vendorPartnerId)

    await callReducerBff(page, "add_purchase_order_line", [
      organizationId,
      orderId,
      {
        product_id: productId,
        quantity: 5.0,
        uom_id: uomId,
        price_unit: 500.0,
        discount: 0.0,
        tax_ids: [],
        name: none,
        sequence: some(10),
        display_type: none,
        product_variant_id: none,
        account_analytic_id: none,
        date_planned: none,
        propagate_cancel: none,
        lot_id: none,
        metadata: none,
      },
    ])

    const lineId = await fetchLatestPurchaseOrderLineIdByOrder(page, orderId)

    await callReducerBff(page, "confirm_purchase_order", [organizationId, orderId])
    await waitForPurchaseOrderState(page, orderId, "Purchase")

    const pickingIds = await fetchPurchaseOrderPickingIds(page, orderId)

    await callReducerBff(page, "receive_po_line", [
      organizationId,
      lineId,
      5.0,
      none,
    ])

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/purchase-order-lines")
          if (!res.ok()) return null
          const json = (await res.json()) as {
            data?: Array<{ id?: unknown; qtyReceived?: unknown; qty_received?: unknown }>
          }
          const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === lineId)
          return Number(row?.qtyReceived ?? row?.qty_received ?? 0)
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(5)

    const lcDescription = smokeName("pur007-landed-cost")
    await callReducerBff(page, "create_landed_cost", [
      organizationId,
      companyId,
      {
        date: stdbTimestampMicros(new Date().toISOString()),
        target_move: "receipt",
        currency_id: currencyId,
        amount_total: 0.0,
        picking_ids: pickingIds,
        cost_lines: [],
        valuation_adjustment_lines: [],
        account_move_id: none,
        account_journal_id: none,
        vendor_bill_id: none,
        description: some(lcDescription),
        activity_ids: [],
        message_follower_ids: [],
        message_ids: [],
        metadata: some(JSON.stringify({ test: "pur-007-po-receipt-landed-cost" })),
      },
    ])

    const landedCostId = await fetchLatestLandedCostId(page, lcDescription)

    await callReducerBff(page, "add_landed_cost_line", [
      organizationId,
      landedCostId,
      {
        product_id: productId,
        price_unit: 250.0,
        split_method: { tag: "Equal" },
        currency_id: currencyId,
        metadata: none,
      },
    ])

    await callReducerBff(page, "compute_landed_costs", [organizationId, landedCostId])

    await expect
      .poll(async () => fetchLandedCostState(page, landedCostId), { timeout: 30_000 })
      .toMatch(/draft/i)

    await callReducerBff(page, "post_landed_costs", [organizationId, landedCostId])

    await expect
      .poll(async () => fetchLandedCostState(page, landedCostId), { timeout: 30_000 })
      .toMatch(/posted/i)

    await callReducerBff(page, "apply_landed_costs", [
      organizationId,
      companyId,
      landedCostId,
    ])

    await gotoModule(page, "/purchasing", "purchasing")
    await page.getByTestId("module-tab-purchasing-orders").click()
    await selectEntityRowById(page, orderId)

    await page.getByTestId("module-tab-purchasing-landed-costs").click()
    await expect(page.getByTestId("entity-table")).toBeVisible({ timeout: 30_000 })
    await selectEntityRowById(page, landedCostId)

    await expectNoAppError(page)
  })
})
