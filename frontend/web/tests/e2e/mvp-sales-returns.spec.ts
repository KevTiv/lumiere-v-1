import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectFormModalVisible,
  fetchAccountSelectLabelByInternalType,
  fetchDraftCreditNoteMoveIdForReturnOrder,
  fetchOpportunityIdByName,
  fetchReturnOrderIdBySaleOrderId,
  fetchSaleOrderIdByOpportunityId,
  fetchSaleOrderSelectLabel,
  fetchSalesInvoiceJournalLabel,
  fetchFulfillmentPickingIdBySaleOrderId,
  fillField,
  gotoModule,
  openEntityCreate,
  postDraftCreditNoteMove,
  postDraftInvoiceViaUi,
  selectEntityRowById,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForAuditLogEntry,
  waitForEntityActionEnabled,
  waitForOpportunityLineExists,
  waitForReturnOrderState,
  waitForSaleOrderBillableLines,
  waitForSaleOrderConfirmed,
  waitForSaleOrderDraftInQuery,
  waitForSaleOrderLineExists,
  waitForSaleOrderLineQtyDelivered,
  fetchDraftInvoiceMoveIdForSaleOrder,
  openCreateInvoiceFromOrder,
} from "./helpers"

async function fetchExactExchangeOrderId(page: import("@playwright/test").Page, returnOrderId: number) {
  const deadline = Date.now() + 30_000
  let lastMatches: Array<Record<string, unknown>> = []

  while (Date.now() < deadline) {
    const response = await page.request.get("/api/query/sale-orders")
    expect(response.ok()).toBe(true)
    const json = (await response.json()) as { data?: Array<Record<string, unknown>> }
    lastMatches = (json.data ?? []).filter((row) => {
      const origin = String(row.origin ?? "")
      if (origin === `exchange:RMA/${returnOrderId}`) return true
      if (typeof row.metadata !== "string") return false
      try {
        return String((JSON.parse(row.metadata) as { exchange_return_id?: unknown }).exchange_return_id) === String(returnOrderId)
      } catch {
        return false
      }
    })
    if (lastMatches.length === 1) {
      const id = Number(lastMatches[0]?.id)
      expect(Number.isSafeInteger(id) && id > 0).toBe(true)
      return id
    }
    expect(lastMatches.length, "at most one exact exchange order for the return").toBeLessThan(2)
    await page.waitForTimeout(250)
  }

  expect(lastMatches, "one exact exchange order for the return").toHaveLength(1)
  throw new Error("unreachable")
}

/**
 * Sales RMA workflow: return order from delivered SO → receive → credit note → post.
 */
test.describe("MVP sales returns (RMA)", { tag: "@p0" }, () => {
  test("creates partial return, receives goods, and posts credit note", async ({ page }) => {
    test.setTimeout(360_000)

    const contactName = smokeName("rma-contact")
    const leadName = smokeName("rma-lead")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "4800")
    await fillField(page, "probability", "10")
    await chooseSelectOptionByLabel(page, "state", "Qualified")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_lead") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-lead"),
    ])

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await selectEntityRowByText(page, leadName)
    await waitForEntityActionEnabled(page, "entity-action-convert-lead")
    await page.getByTestId("entity-action-convert-lead").click()
    await expectFormModalVisible(page, "convert-lead")
    await chooseFirstEnabledOption(page, "opportunityStageId")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "convert_lead_to_customer") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "convert-lead"),
    ])

    const opportunityName = `${leadName} - Opportunity`
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    const opportunityId = await fetchOpportunityIdByName(page, opportunityName)

    await openEntityCreate(page, "/crm", "crm", "opportunity-lines", "add-opportunity-line")
    await chooseSelectOptionByLabel(page, "opportunityId", opportunityName)
    await page.getByTestId("form-field-productId").click()
    await page.getByRole("option", { name: "Lumiere Dev Laptop" }).click()
    await chooseFirstEnabledOption(page, "uomId")
    await fillField(page, "quantity", "2")
    await fillField(page, "priceUnit", "1200")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_opportunity_line") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "add-opportunity-line"),
    ])
    await waitForOpportunityLineExists(page, opportunityId)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, opportunityName)
    await waitForEntityActionEnabled(page, "entity-action-convert-opp-order")
    await page.getByTestId("entity-action-convert-opp-order").click()
    await chooseFirstEnabledOption(page, "pricelistId")
    await chooseFirstEnabledOption(page, "warehouseId")
    await Promise.all([
      page.waitForResponse(
        (res) =>
          matchesOperationResponse(res, "convert_opportunity_to_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "convert-opportunity-order"),
    ])
    const orderId = await fetchSaleOrderIdByOpportunityId(page, opportunityId)
    await waitForSaleOrderDraftInQuery(page, orderId)
    await waitForSaleOrderLineExists(page, orderId)

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "confirm_sales_order") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-confirm-orders").click(),
    ])
    await waitForSaleOrderConfirmed(page, orderId)
    await waitForSaleOrderBillableLines(page, orderId)

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-fulfillment").click()
    const pickingId = await fetchFulfillmentPickingIdBySaleOrderId(page, orderId)
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-picking")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "confirm_stock_picking") && res.ok(),
        { timeout: 45_000 },
      ),
      page.getByTestId("entity-action-confirm-picking").click(),
    ])
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-assign-picking")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "assign_stock_picking") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-assign-picking").click(),
    ])
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-validate-picking")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "validate_stock_picking") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-validate-picking").click(),
    ])
    await waitForSaleOrderLineQtyDelivered(page, orderId)

    const journalLabel = await fetchSalesInvoiceJournalLabel(page)
    const incomeLabel = await fetchAccountSelectLabelByInternalType(page, "income")
    const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await openCreateInvoiceFromOrder(page, orderId)
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", incomeLabel)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    await Promise.all([
      page.waitForResponse(
        (res) =>
          matchesOperationResponse(res, "create_invoice_from_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-invoice-from-sale-order"),
    ])
    const invoiceMoveId = await fetchDraftInvoiceMoveIdForSaleOrder(page, orderId)
    await postDraftInvoiceViaUi(page, invoiceMoveId)

    const saleOrderLabel = await fetchSaleOrderSelectLabel(page, orderId)

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-returns").click()
    await page.getByTestId("module-create-sales-returns").click()
    await expect(page.getByTestId("form-modal-new-return-order")).toBeVisible()
    await chooseSelectOptionByLabel(page, "partnerId", new RegExp(leadName, "i"))
    await chooseSelectOptionByLabel(page, "saleOrderId", saleOrderLabel)
    await fillField(page, "returnReason", "E2E partial return — defective unit")
    await page.getByTestId("form-field-productId").click()
    await page.getByRole("option", { name: "Lumiere Dev Laptop" }).click()
    await chooseFirstEnabledOption(page, "uomId")
    await fillField(page, "productUomQty", "1")
    await fillField(page, "priceUnit", "1200")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_return_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-return-order"),
    ])

    const returnOrderId = await fetchReturnOrderIdBySaleOrderId(page, orderId)
    await selectEntityRowById(page, returnOrderId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-return")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "confirm_return_order") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-confirm-return").click(),
    ])
    await waitForReturnOrderState(page, returnOrderId, "confirmed")

    await selectEntityRowById(page, returnOrderId)
    await waitForEntityActionEnabled(page, "entity-action-receive-return")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "validate_stock_picking") && res.ok(),
        { timeout: 60_000 },
      ),
      page.getByTestId("entity-action-receive-return").click(),
    ])
    await waitForReturnOrderState(page, returnOrderId, "received")

    await selectEntityRowById(page, returnOrderId)
    await waitForEntityActionEnabled(page, "entity-action-create-exchange-order")
    await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_exchange_order_from_return") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-create-exchange-order").click(),
    ])
    const exchangeOrderId = await fetchExactExchangeOrderId(page, returnOrderId)
    await expect(page).toHaveURL((url) =>
      url.pathname === "/sales" &&
      url.searchParams.get("tab") === "orders" &&
      url.searchParams.get("filter") === `id:${exchangeOrderId}`,
    )

    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-returns").click()
    await selectEntityRowById(page, returnOrderId)
    await waitForEntityActionEnabled(page, "entity-action-create-return-credit-note")
    await page.getByTestId("entity-action-create-return-credit-note").click()
    await expectFormModalVisible(page, "create-invoice-from-sale-order")
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", incomeLabel)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    await Promise.all([
      page.waitForResponse(
        (res) =>
          matchesOperationResponse(res, "create_credit_note_from_return_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-invoice-from-sale-order"),
    ])
    await waitForReturnOrderState(page, returnOrderId, "refunded")

    const creditNoteId = await fetchDraftCreditNoteMoveIdForReturnOrder(page, returnOrderId)
    await postDraftCreditNoteMove(page, creditNoteId)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/account-moves")
        if (!res.ok()) return false
        const json = (await res.json()) as {
          data?: Array<{ id?: unknown; moveType?: unknown; state?: unknown }>
        }
        return (json.data ?? []).some((row) => {
          const id = Number(row.id)
          const type = String(row.moveType ?? "")
            .toLowerCase()
            .includes("refund")
          const posted = String(row.state ?? "")
            .toLowerCase()
            .includes("posted")
          return id === creditNoteId && type && posted
        })
      }, { timeout: 30_000 })
      .toBe(true)

    await waitForAuditLogEntry(page, "return_order", "CREATE")
    await waitForAuditLogEntry(page, "account_move", "CREATE")
  })
})
