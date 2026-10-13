import { expect, test } from "@playwright/test"
import { saleOrderHref } from "@lumiere/erp-shared/record-links"

import { chooseSelectOptionByLabel, fetchSalesInvoiceJournalLabel, fetchAccountSelectLabelByInternalType, gotoModule, scalarQueryId, selectEntityRowById, signIn, smokeName, submitForm,
  openCreateInvoiceFromOrder,
} from "./helpers"
import { expectCanonicalPickingFocus } from "./inventory-picking-fixtures"
import { clickCanonicalHandoff, openCanonicalHandoffs } from "./cov25-link-navigation"
import { matchesOperationResponse } from "./operation-response"
import {
  addLaptopLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  fetchOrderPickings,
  readyPickingViaUi,
  pickingActionViaUi,
} from "./sales-order-fixtures"

// COV-25 — see docs/plan/erp-cov25-cross-module-links-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const pickingHref = (id: number) => `/inventory?tab=transfers&filter=${encodeURIComponent(`id:${id}`)}`

test.describe("COV-25 sale order → delivery link", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("the order's record sheet links straight to the delivery it generated", async ({ page }) => {
    test.setTimeout(360_000)

    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    const draftId = await createDraftSaleOrder(page, smokeName("cov25-draft"))
    const orderId = await createDraftSaleOrder(page, smokeName("cov25-link"))
    await addLaptopLine(page, orderId, "1")
    await confirmOrderViaUi(page, orderId)
    const [delivery] = await fetchOrderPickings(page, orderId)
    expect(delivery, "confirming the order must generate its delivery").toBeTruthy()

    const source = { module: "sales", tab: "orders", id: orderId }
    const openHandoffs = (id: number) => openCanonicalHandoffs(page, { ...source, id })

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
    await clickCanonicalHandoff(page, source, `sale-order-handoff-picking-${delivery!.id}`, { module: "inventory", tab: "transfers", id: delivery!.id })

    // The invoice must be produced through Sales' existing operator form, then read by FK.
    await readyPickingViaUi(page, delivery!.id)
    await pickingActionViaUi(page, delivery!.id, "entity-action-validate-picking", "validate_stock_picking")
    const journal = await fetchSalesInvoiceJournalLabel(page)
    const income = await fetchAccountSelectLabelByInternalType(page, "income")
    const receivable = await fetchAccountSelectLabelByInternalType(page, "receivable")
    await gotoModule(page, saleOrderHref(orderId), "sales")
    await expect(page.getByTestId("module-tab-sales-orders")).toHaveAttribute("aria-selected", "true")
    await openCreateInvoiceFromOrder(page, orderId)
    await chooseSelectOptionByLabel(page, "journalId", journal)
    await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", income)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivable)
    await expect(
      page.getByTestId("form-submit-create-invoice-from-sale-order"),
      "Governed sales:create-invoice-from-sale-order must be provisioned before the invoice operator path can dispatch",
    ).toBeEnabled({ timeout: 10_000 })
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) => matchesOperationResponse(candidate, "create_invoice_from_sale_order"),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-invoice-from-sale-order"),
    ])
    expect(response.ok()).toBe(true)
    const invoiceIds = async () => {
      const response = await page.request.get("/api/query/account-moves")
      expect(response.ok()).toBe(true)
      const payload = await response.json() as { data: Record<string, unknown>[] }
      return payload.data.filter((row) => scalarQueryId(row.saleOrderId ?? row.sale_order_id) === orderId)
        .map((row) => scalarQueryId(row.id))
    }
    await expect.poll(invoiceIds).toHaveLength(1)
    const [invoiceId] = await invoiceIds()
    if (invoiceId == null) throw new Error("Sale order invoice has no canonical ID")
    const invoicedSheet = await openHandoffs(orderId)
    await expect(invoicedSheet.locator('[data-testid^="sale-order-handoff-invoice-"]')).toHaveCount(1)
    await clickCanonicalHandoff(page, source, `sale-order-handoff-invoice-${invoiceId}`, { module: "accounting", tab: "journal-entries", id: invoiceId })
  })
})
