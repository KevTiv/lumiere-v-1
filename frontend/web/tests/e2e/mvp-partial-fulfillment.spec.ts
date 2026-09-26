import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import { matchesOperationResponse } from "./operation-response"
import {
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"
import {
  ORDER_SUMMARY,
  addLaptopLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  expectOrderSummary,
  fetchOrderDeliveredQty,
  fetchOrderPickings,
  fetchPickingMoves,
  openFulfillmentTab,
  pickingActionViaUi,
  readyPickingViaUi,
  waitForFirstDelivery,
} from "./sales-order-fixtures"

/**
 * INT-04: partial fulfillment and backorder.
 *
 * Order N, ship fewer than N, and the shortfall must stay owed on a backorder that can be
 * delivered later; or be cancelled, in which case the order says it was delivered short.
 * The stale-stock and duplicate-validation rules are proven at the reducer level
 * (`backorder_certification_test.rs`); here the UI must honour them.
 *
 * Orders are kept small (2-3 units) because seeded stock is shared across specs.
 */

/** Ship `quantity` of the picking's only line through the partial-delivery form, keeping a backorder. */
async function shipPartially(page: Page, pickingId: number, quantity: number) {
  const [move] = await fetchPickingMoves(page, pickingId)
  expect(move, `picking ${pickingId} has a move`).toBeTruthy()

  await openFulfillmentTab(page)
  await selectEntityRowById(page, pickingId)
  await waitForEntityActionEnabled(page, "entity-action-partial-validate-picking")
  await page.getByTestId("entity-action-partial-validate-picking").click()
  await expect(page.getByTestId("form-modal-partial-delivery-validate")).toBeVisible()

  const field = page.getByTestId(`form-field-qty_${move!.id}`)
  await field.click()
  await field.fill(String(quantity))
  // "Create backorder" is on by default, so the remainder stays owed.

  const [response] = await Promise.all([
    page.waitForResponse((res) => matchesOperationResponse(res, "validate_stock_picking_backorder"), {
      timeout: 30_000,
    }),
    submitForm(page, "partial-delivery-validate"),
  ])
  expect(response.ok(), `validate_stock_picking_backorder: ${await response.text().catch(() => "")}`).toBe(true)
}

/** The order's backorder picking, once the partial validation has been committed. */
async function waitForBackorder(page: Page, orderId: number, originalPickingId: number) {
  let backorderId = 0
  await expect
    .poll(
      async () => {
        const pickings = await fetchOrderPickings(page, orderId)
        backorderId = pickings.find((p) => p.backorderId === originalPickingId)?.id ?? 0
        return backorderId
      },
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0)
  return backorderId
}

test.describe("MVP partial fulfillment", { tag: "@p0" }, () => {
  test("ships part of an order, keeps the rest on a backorder, and delivers it later", async ({ page }) => {
    test.setTimeout(300_000)
    const orderId = await createDraftSaleOrder(page, smokeName("so-partial-delivery"))
    await addLaptopLine(page, orderId, "3")
    await confirmOrderViaUi(page, orderId)

    const pickingId = await waitForFirstDelivery(page, orderId)
    await readyPickingViaUi(page, pickingId)

    // Ship 2 of 3.
    await shipPartially(page, pickingId, 2)
    await expect.poll(() => fetchOrderDeliveredQty(page, orderId), { timeout: 45_000 }).toBe(2)

    // The shipped picking is done; a backorder for the missing unit exists and is not done.
    const backorderId = await waitForBackorder(page, orderId, pickingId)
    const pickings = await fetchOrderPickings(page, orderId)
    expect(pickings.find((p) => p.id === pickingId)?.state).toBe("done")
    expect(pickings.find((p) => p.id === backorderId)?.state).not.toBe("done")
    const [owed] = await fetchPickingMoves(page, backorderId)
    expect(owed?.demand).toBe(1)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.partial] })

    // A shipped picking cannot be validated again: the UI does not offer it.
    await openFulfillmentTab(page)
    await selectEntityRowById(page, pickingId)
    await expect(page.getByTestId("entity-action-validate-picking")).toBeDisabled()
    await expect(page.getByTestId("entity-action-partial-validate-picking")).toBeDisabled()

    // Deliver the remainder.
    await readyPickingViaUi(page, backorderId)
    await pickingActionViaUi(page, backorderId, "entity-action-validate-picking", "validate_stock_picking")
    await expect.poll(() => fetchOrderDeliveredQty(page, orderId), { timeout: 45_000 }).toBe(3)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.complete], absent: [ORDER_SUMMARY.delivery.partial, ORDER_SUMMARY.delivery.short] })

    // Everything was delivered exactly once: two shipped pickings, no third.
    const finalPickings = await fetchOrderPickings(page, orderId)
    expect(finalPickings.filter((p) => p.state === "done")).toHaveLength(2)
    expect(finalPickings).toHaveLength(2)
  })

  test("cancelling the remainder leaves the order delivered short", async ({ page }) => {
    test.setTimeout(300_000)
    const orderId = await createDraftSaleOrder(page, smokeName("so-cancel-remainder"))
    await addLaptopLine(page, orderId, "2")
    await confirmOrderViaUi(page, orderId)

    const pickingId = await waitForFirstDelivery(page, orderId)
    await readyPickingViaUi(page, pickingId)
    await shipPartially(page, pickingId, 1)
    await expect.poll(() => fetchOrderDeliveredQty(page, orderId), { timeout: 45_000 }).toBe(1)
    const backorderId = await waitForBackorder(page, orderId, pickingId)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.partial] })

    // Assign the remainder (reserving its stock), then cancel it. That the reservation is released
    // is proven by the reducer test; here the UI must show the cancelled remainder as delivered short.
    await readyPickingViaUi(page, backorderId)
    await openFulfillmentTab(page)
    await selectEntityRowById(page, backorderId)
    await waitForEntityActionEnabled(page, "entity-action-cancel-picking")
    await page.getByTestId("entity-action-cancel-picking").click()
    await expect(page.getByTestId("form-modal-cancel-picking-confirm")).toBeVisible()
    await page.getByTestId("form-field-confirmCancel").click()
    const [cancelResponse] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "cancel_stock_picking"), { timeout: 30_000 }),
      submitForm(page, "cancel-picking-confirm"),
    ])
    expect(cancelResponse.ok(), `cancel_stock_picking: ${await cancelResponse.text().catch(() => "")}`).toBe(true)

    await expect
      .poll(async () => (await fetchOrderPickings(page, orderId)).find((p) => p.id === backorderId)?.state, {
        timeout: 45_000,
      })
      .toBe("cancel")

    // What shipped stays shipped, and the order now reads short: nothing more is coming.
    expect(await fetchOrderDeliveredQty(page, orderId)).toBe(1)
    await expectOrderSummary(page, orderId, { present: [ORDER_SUMMARY.delivery.short], absent: [ORDER_SUMMARY.delivery.partial] })
  })
})
