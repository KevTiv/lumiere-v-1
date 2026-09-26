import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import {
  callReducerBffResult,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  smokeName,
  waitForEntityActionEnabled,
  waitForSaleOrderConfirmed,
  waitForSaleOrderLineQtyDelivered,
} from "./helpers"
import { loseNextResponse, openOwnerPages } from "./pretenant-support"
import {
  ORDER_SUMMARY,
  addLaptopLine,
  createDraftSaleOrder,
  expectOrderSummary,
  fetchOrderPickings,
  pickingActionViaUi,
  readyPickingViaUi,
  waitForFirstDelivery,
} from "./sales-order-fixtures"

/**
 * INT-08: order-to-cash adversarial certification.
 *
 * The happy path (lead → cash, with the order summary converging at every step) lives in
 * `mvp-lead-to-cash.spec.ts`; partial delivery and backorders in `mvp-partial-fulfillment.spec.ts`.
 * This spec attacks the seams: a duplicate submit, a reply lost after the server committed, a
 * stale second session, another tenant's identifiers, and refreshing at every major state.
 *
 * Covered elsewhere (not repeated here):
 *   - stock changed between view and fulfillment, duplicate validation, duplicate invoicing,
 *     duplicate opportunity conversion, cross-tenant invoicing: reducer tests in
 *     `spacetimedb/tests/sales` (run through `run_sales_backorder_test`).
 *   - duplicate / retried payment posting, overpayment: `pretenant-payment-adversarial.spec.ts`
 *     and `spacetimedb/tests/pretenant/payments_cert.rs`.
 *   - permission grant/revoke cycles: `auth-permission-enforcement.spec.ts`.
 *
 * Orders are small (1 unit) because seeded stock is shared across specs.
 */

async function saleOrderState(page: Page, orderId: number): Promise<string> {
  const res = await page.request.get("/api/query/sale-orders")
  if (!res.ok()) return ""
  const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
  const row = (json.data ?? []).find((candidate) => scalarQueryId(candidate.id) === orderId)
  return scalarQueryString(row?.state)
}

async function draftOrder(page: Page, label: string): Promise<number> {
  const orderId = await createDraftSaleOrder(page, smokeName(label))
  await addLaptopLine(page, orderId, "1")
  return orderId
}

async function selectOrderForConfirm(page: Page, orderId: number) {
  await gotoModule(page, "/sales", "sales")
  await page.getByTestId("module-tab-sales-orders").click()
  await selectEntityRowById(page, orderId)
  await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
}

test.describe("O2C adversarial certification", { tag: "@p0" }, () => {
  test("refreshing at every major state shows the same canonical summary", async ({ page }) => {
    test.setTimeout(300_000)
    const orderId = await draftOrder(page, "so-o2c-refresh")

    // Draft: nothing has started.
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.invoice.none], reload: true })

    // Confirmed: waiting to deliver, and the same after a reload.
    await selectOrderForConfirm(page, orderId)
    await page.getByTestId("entity-action-confirm-orders").click()
    await waitForSaleOrderConfirmed(page, orderId)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.pending] })
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.pending], reload: true })

    // Delivered: complete, and the same after a reload.
    const pickingId = await waitForFirstDelivery(page, orderId)
    await readyPickingViaUi(page, pickingId)
    await pickingActionViaUi(page, pickingId, "entity-action-validate-picking", "validate_stock_picking")
    await waitForSaleOrderLineQtyDelivered(page, orderId)
    const delivered = {
      present: [ORDER_SUMMARY.delivery.complete],
      absent: [ORDER_SUMMARY.delivery.pending, ORDER_SUMMARY.delivery.partial],
    }
    await expectOrderSummary(page, orderId, delivered)
    await expectOrderSummary(page, orderId, { ...delivered, reload: true })
  })

  test("a double click confirms once: one request, one delivery", async ({ page }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-double-click")
    await selectOrderForConfirm(page, orderId)

    let requests = 0
    await page.route(
      (url) => url.pathname.includes("confirm_sales_order"),
      async (route) => {
        requests += 1
        await route.continue()
      },
    )
    await page.getByTestId("entity-action-confirm-orders").dblclick()
    await waitForSaleOrderConfirmed(page, orderId)
    // Give any second request time to surface before counting.
    await page.waitForTimeout(2_000)

    expect(requests, "confirm_sales_order requests from one double click").toBe(1)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("a reply lost after the server committed reports an unknown outcome, refreshes, and offers no retry", async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-lost-response")
    await selectOrderForConfirm(page, orderId)

    const injected = await loseNextResponse(page, "confirm_sales_order")
    await page.getByTestId("entity-action-confirm-orders").click()

    // The user is told the result is unknown, not that it failed or worked.
    await expect(page.getByText(/Result unknown/i).first()).toBeVisible({ timeout: 30_000 })
    expect(injected.lost()).toBe(true)

    // The write did commit, exactly once, and re-issuing it is not offered.
    await waitForSaleOrderConfirmed(page, orderId)
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)

    // The list converged on the committed state, so confirm is no longer offered for the order.
    await selectEntityRowById(page, orderId)
    await expect(page.getByTestId("entity-action-confirm-orders")).toBeDisabled({ timeout: 30_000 })
  })

  test("a stale second session cannot confirm an order again", async ({ page, browser }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-stale-session")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const args = [organizationId, companyId, orderId]

    const { pages, close } = await openOwnerPages(browser, 2)
    try {
      const [first, second] = pages as [Page, Page]
      const confirmed = await callReducerBffResult(first, "confirm_sales_order", args)
      expect(confirmed.ok, `first confirm: ${confirmed.error ?? ""}`).toBe(true)
      await waitForSaleOrderConfirmed(page, orderId)

      // The second session still believes the order is a draft.
      const stale = await callReducerBffResult(second, "confirm_sales_order", args)
      expect(stale.ok, "a stale second confirm must be refused").toBe(false)
      expect(stale.error ?? "").not.toBe("")
    } finally {
      await close()
    }
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("two sessions confirming at the same moment produce one delivery", async ({ page, browser }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-concurrent-confirm")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const args = [organizationId, companyId, orderId]

    const { pages, close } = await openOwnerPages(browser, 2)
    try {
      const results = await Promise.all(pages.map((session) => callReducerBffResult(session, "confirm_sales_order", args)))
      expect(results.filter((result) => result.ok), "exactly one confirm may win").toHaveLength(1)
    } finally {
      await close()
    }
    await waitForSaleOrderConfirmed(page, orderId)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
  })

  test("another tenant's organization id cannot confirm this order", async ({ page }) => {
    test.setTimeout(240_000)
    const orderId = await draftOrder(page, "so-o2c-cross-tenant")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    const foreign = await callReducerBffResult(page, "confirm_sales_order", [
      organizationId + 1_000_000,
      companyId,
      orderId,
    ])
    expect(foreign.ok, "a foreign organization id must be refused").toBe(false)

    // Nothing changed for the real owner.
    expect(await saleOrderState(page, orderId)).toMatch(/draft/i)
    expect(await fetchOrderPickings(page, orderId)).toHaveLength(0)
  })
})
