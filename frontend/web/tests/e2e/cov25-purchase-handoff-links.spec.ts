import { expect, test, type Page } from "@playwright/test"
import { accountMoveHref, stockPickingHref } from "@lumiere/erp-shared/record-links"
import { activeTabEntityTable, gotoModule, signIn, smokeName } from "./helpers"
import { expectCanonicalPickingFocus } from "./inventory-picking-fixtures"
import {
  addLaptopPurchaseLine, confirmPurchaseOrderViaUi, createDraftPurchaseOrder,
  createVendorBillViaUi, fetchPurchaseOrderInvoiceIds, fetchPurchaseOrderLineIds,
  fetchPurchaseOrderReceipts, receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

const PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function openHandoffs(page: Page, orderId: number) {
  await gotoModule(page, `/purchasing?tab=orders&filter=${encodeURIComponent(`id:${orderId}`)}`, "purchasing")
  const row = activeTabEntityTable(page).getByTestId(`entity-row-${orderId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  const sheet = page.locator('[data-slot="sheet-content"]:visible')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId("entity-record-sheet-tab-handoffs").click()
  await expect(sheet.getByTestId("purchase-order-handoffs")).toBeVisible()
  return sheet
}

async function expectBillFocus(page: Page, billId: number) {
  await expect(page).toHaveURL((url) => url.pathname === "/accounting"
    && url.searchParams.get("tab") === "journal-entries"
    && url.searchParams.getAll("filter").length === 1
    && url.searchParams.get("filter") === `id:${billId}`)
  await expect(page.getByTestId("module-tab-accounting-journal-entries")).toHaveAttribute("aria-selected", "true")
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${billId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
}

test.describe("COV-25 purchase order → receipt and vendor bill links",
  { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
    test("links only the selected order's receipts and bills, preserving exact focus after refresh", async ({ page }) => {
      test.setTimeout(300_000)
      await signIn(page, "test@email.com", PASSWORD)
      const draftId = await createDraftPurchaseOrder(page, smokeName("cov25-po-draft"))
      const orderId = await createDraftPurchaseOrder(page, smokeName("cov25-po-links"))
      await addLaptopPurchaseLine(page, orderId, "1")
      await confirmPurchaseOrderViaUi(page, orderId)
      const receipts = await fetchPurchaseOrderReceipts(page, orderId)
      expect(receipts).toHaveLength(1)
      const receipt = receipts[0]!
      const lines = await fetchPurchaseOrderLineIds(page, orderId)
      expect(lines).toHaveLength(1)
      await receivePurchaseLineViaUi(page, lines[0]!)
      await createVendorBillViaUi(page, orderId)
      await expect.poll(() => fetchPurchaseOrderInvoiceIds(page, orderId)).toHaveLength(1)
      const [billId] = await fetchPurchaseOrderInvoiceIds(page, orderId)
      if (billId == null) throw new Error("Expected one PO-owned vendor bill")

      const draft = await openHandoffs(page, draftId)
      await expect(draft.getByTestId("purchase-order-handoff-none")).toBeVisible()

      const sheet = await openHandoffs(page, orderId)
      const receiptLink = sheet.getByTestId(`purchase-order-handoff-picking-${receipt.id}`)
      await expect(receiptLink).toHaveAttribute("href", stockPickingHref(receipt.id))
      await expect(sheet.locator('[data-testid^="purchase-order-handoff-picking-"]')).toHaveCount(1)
      await expect(sheet.locator('[data-testid^="purchase-order-handoff-invoice-"]')).toHaveCount(1)
      await receiptLink.click()
      await expectCanonicalPickingFocus(page, receipt.id)
      await page.reload()
      await expectCanonicalPickingFocus(page, receipt.id)

      const reopened = await openHandoffs(page, orderId)
      const billLink = reopened.getByTestId(`purchase-order-handoff-invoice-${billId}`)
      await expect(billLink).toHaveAttribute("href", accountMoveHref(billId))
      await billLink.click()
      await expectBillFocus(page, billId)
      await page.reload()
      await expectBillFocus(page, billId)
    })
  })
