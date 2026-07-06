import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectFormModalVisible,
  fetchAccountSelectLabelByInternalType,
  fetchDraftCreditNoteMoveIdForInvoice,
  fetchDraftInvoiceMoveIdByPartner,
  fetchFulfillmentPickingIdBySaleOrderId,
  fetchLeadIdByName,
  fetchOpportunityIdByName,
  fetchSaleOrderIdByOpportunityId,
  fetchSalesInvoiceJournalLabel,
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
  waitForMovePosted,
  waitForOpportunityLineExists,
  waitForSaleOrderBillableLines,
  waitForSaleOrderConfirmed,
  waitForSaleOrderDraftInQuery,
  waitForSaleOrderLineExists,
  waitForSaleOrderLineQtyDelivered,
} from "./helpers"

/**
 * Invoice correction: credit note (OutRefund) from a posted customer invoice.
 * Extends lead-to-cash through step 10, then exercises Accounting credit note UI.
 */
test.describe("MVP invoice correction", { tag: "@p0" }, () => {
  test("creates and posts credit note from posted invoice", async ({ page }) => {
    test.setTimeout(300_000)

    const contactName = smokeName("inv-corr-contact")
    const leadName = smokeName("inv-corr-lead")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "2500")
    await fillField(page, "probability", "10")
    await chooseSelectOptionByLabel(page, "state", "Qualified")
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_lead") && res.ok(),
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
        (res) => res.url().includes("/api/call/convert_lead_to_customer") && res.ok(),
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
    await fillField(page, "quantity", "1")
    await fillField(page, "priceUnit", "1200")
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_opportunity_line") && res.ok(),
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
          res.url().includes("/api/call/convert_opportunity_to_sale_order") && res.ok(),
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
        (res) => res.url().includes("/api/call/confirm_sales_order") && res.ok(),
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
        (res) => res.url().includes("/api/call/confirm_stock_picking") && res.ok(),
        { timeout: 45_000 },
      ),
      page.getByTestId("entity-action-confirm-picking").click(),
    ])
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-assign-picking")
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/assign_stock_picking") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-assign-picking").click(),
    ])
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-validate-picking")
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/validate_stock_picking") && res.ok(),
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
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-create-invoice")
    await page.getByTestId("entity-action-create-invoice").click()
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", incomeLabel)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/call/create_invoice_from_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-invoice-from-sale-order"),
    ])

    await fetchDraftInvoiceMoveIdByPartner(page, leadName)
    const invoiceMoveId = await postDraftInvoiceViaUi(page, leadName)
    expect(invoiceMoveId).toBeGreaterThan(0)

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-invoices").click()
    const invoiceRow = page.locator("table tbody tr").filter({ hasText: leadName }).first()
    await expect(invoiceRow).toBeVisible({ timeout: 30_000 })
    await invoiceRow.click()
    await expect(page.getByTestId("invoice-detail-modal")).toBeVisible({ timeout: 15_000 })
    await page.getByTestId("invoice-detail-create-credit-note").click()
    await expect(page.getByTestId("form-modal-create-credit-note")).toBeVisible()
    await fillField(page, "reason", "E2E pricing correction")
    await page.getByTestId("form-field-confirmed").click()
    const [creditNoteRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/call/create_credit_note_from_invoice") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-credit-note"),
    ])
    expect(creditNoteRes.ok()).toBe(true)

    const creditNoteId = await fetchDraftCreditNoteMoveIdForInvoice(page, invoiceMoveId)
    await postDraftCreditNoteMove(page, creditNoteId)
    await waitForMovePosted(page, creditNoteId)

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

    await waitForAuditLogEntry(page, "account_move", "CREATE")
    expect(await fetchLeadIdByName(page, leadName)).toBeGreaterThan(0)
  })
})
