import { expect, test } from "@playwright/test"

import { activeTabEntityTable, gotoModule, signIn, smokeName } from "./helpers"
import { expectCanonicalPickingFocus } from "./inventory-picking-fixtures"
import {
  addLaptopLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  fetchOrderPickings,
} from "./sales-order-fixtures"

// COV-25 — see docs/plan/erp-cov25-cross-module-links-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const pickingHref = (id: number) => `/inventory?tab=transfers&filter=${encodeURIComponent(`id:${id}`)}`

test.describe("COV-25 sale order → delivery link", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("the order's record sheet links straight to the delivery it generated", async ({ page }) => {
    test.setTimeout(240_000)

    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    const draftId = await createDraftSaleOrder(page, smokeName("cov25-draft"))
    const orderId = await createDraftSaleOrder(page, smokeName("cov25-link"))
    await addLaptopLine(page, orderId, "1")
    await confirmOrderViaUi(page, orderId)
    const [delivery] = await fetchOrderPickings(page, orderId)
    expect(delivery, "confirming the order must generate its delivery").toBeTruthy()

    const openHandoffs = async (id: number) => {
      await gotoModule(page, "/sales", "sales")
      await page.getByTestId("module-tab-sales-orders").click()
      const row = activeTabEntityTable(page).getByTestId(`entity-row-${id}`)
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.click()
      const sheet = page.locator('[data-slot="sheet-content"]:visible')
      await expect(sheet).toBeVisible({ timeout: 15_000 })
      await page.getByTestId("entity-record-sheet-tab-handoffs").click()
      await expect(sheet.getByTestId("sale-order-handoffs")).toBeVisible()
      return sheet
    }

    // A draft order has generated nothing yet.
    const draftSheet = await openHandoffs(draftId)
    await expect(draftSheet.getByTestId("sale-order-handoff-none")).toBeVisible()

    // The confirmed order lists exactly its own delivery, linking to that transfer.
    const sheet = await openHandoffs(orderId)
    const link = sheet.getByTestId(`sale-order-handoff-picking-${delivery!.id}`)
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute("href", pickingHref(delivery!.id))
    await expect(sheet.locator('[data-testid^="sale-order-handoff-picking-"]')).toHaveCount(1)
    await link.click()
    await expectCanonicalPickingFocus(page, delivery!.id)
  })
})
