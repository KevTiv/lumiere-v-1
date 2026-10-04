import { expect, test } from "@playwright/test"
import { signIn, smokeName } from "./helpers"
import { clickCanonicalHandoff, openCanonicalHandoffs } from "./cov25-link-navigation"
import {
  addLaptopPurchaseLine, confirmPurchaseOrderViaUi, createDraftPurchaseOrder, createVendorBillViaUi,
  fetchPurchaseOrderInvoiceIds, fetchPurchaseOrderLineIds, fetchPurchaseOrderReceipts, receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

test.describe("COV-25 purchase record links", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("draft has none; generated receipt and vendor bill links survive refresh/back", async ({ page }) => {
    test.setTimeout(360_000)
    await signIn(page, "test@email.com", process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$")
    const orderId = await createDraftPurchaseOrder(page, smokeName("cov25-po"))
    const source = { module: "purchasing", tab: "orders", id: orderId }
    const draft = await openCanonicalHandoffs(page, source)
    await expect(draft.getByTestId("purchase-order-handoff-none")).toBeVisible()
    await addLaptopPurchaseLine(page, orderId)
    await confirmPurchaseOrderViaUi(page, orderId)
    await expect.poll(() => fetchPurchaseOrderReceipts(page, orderId)).toHaveLength(1)
    const [receipt] = await fetchPurchaseOrderReceipts(page, orderId)
    if (!receipt) throw new Error("Confirmed PO has no exact receipt")
    await clickCanonicalHandoff(page, source, `purchase-order-handoff-receipt-${receipt.id}`, { module: "inventory", tab: "transfers", id: receipt.id })
    const lines = await fetchPurchaseOrderLineIds(page, orderId)
    expect(lines).toHaveLength(1)
    await receivePurchaseLineViaUi(page, lines[0]!)
    const created = await createVendorBillViaUi(page, orderId)
    expect(created.ok()).toBe(true)
    await expect.poll(() => fetchPurchaseOrderInvoiceIds(page, orderId)).toHaveLength(1)
    const [billId] = await fetchPurchaseOrderInvoiceIds(page, orderId)
    if (billId == null) throw new Error("PO invoice_ids relation is empty")
    const sheet = await openCanonicalHandoffs(page, source)
    await expect(sheet.locator('[data-testid^="purchase-order-handoff-receipt-"]')).toHaveCount(1)
    await expect(sheet.locator('[data-testid^="purchase-order-handoff-bill-"]')).toHaveCount(1)
    await clickCanonicalHandoff(page, source, `purchase-order-handoff-bill-${billId}`, { module: "accounting", tab: "journal-entries", id: billId })
  })
})
