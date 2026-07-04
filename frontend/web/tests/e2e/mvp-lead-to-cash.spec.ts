import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  assertMoveLinesBalanced,
  expectNoAppError,
  expectOverviewDashboardLive,
  expectSeededText,
  fetchAccountSelectLabelByInternalType,
  fetchDraftInvoiceMoveIdByPartner,
  fetchInvoiceMoveDetails,
  fetchLatestPaymentIdByPartner,
  fetchSalesInvoiceJournalLabel,
  fetchLeadIdByName,
  fetchOpportunityIdByName,
  fetchSaleOrderIdByOpportunityId,
  waitForOpportunityLineExists,
  fetchFulfillmentPickingIdBySaleOrderId,
  fillField,
  gotoModule,
  openEntityCreate,
  openSettingsSection,
  postDraftInvoiceViaUi,
  selectEntityRowById,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  waitForSaleOrderBillableLines,
  waitForSaleOrderConfirmed,
  waitForSaleOrderDraftInQuery,
  waitForSaleOrderLineQtyDelivered,
  waitForPaymentPosted,
  waitForSaleOrderLineExists,
  waitForAuditLogEntry,
} from "./helpers"

/**
 * Golden-path lead → cash workflow (creates data; see docs/MVP_WORKFLOW_CONTRACT.md).
 *
 * Steps 3–12, 13, and 17 use the product UI (CRM lead create/convert, sales, accounting, overview, audit).
 */
test.describe("MVP lead-to-cash workflow", { tag: "@p0" }, () => {
  test("creates CRM lead through payment registration", async ({ page }) => {
    test.setTimeout(240_000)

    const contactName = smokeName("mvp-contact")
    const leadName = smokeName("mvp-lead")

    // Step 3 — contact (UI)
    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await page
      .waitForResponse((res) => res.url().includes("/api/query/contacts") && res.ok(), {
        timeout: 30_000,
      })
      .catch(() => undefined)
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    // Step 4 — lead (UI: must start qualified for conversion)
    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "2500")
    await fillField(page, "probability", "10")
    await chooseSelectOptionByLabel(page, "state", "Qualified")
    const [createLeadRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_lead") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-lead"),
    ])
    expect(createLeadRes.ok()).toBe(true)
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await expect(page.getByText(leadName)).toBeVisible({ timeout: 30_000 })

    // Step 5 — convert lead (UI)
    await selectEntityRowByText(page, leadName)
    await waitForEntityActionEnabled(page, "entity-action-convert-lead")
    await page.getByTestId("entity-action-convert-lead").click()
    await expect(page.getByTestId("form-modal-convert-lead")).toBeVisible()
    await chooseFirstEnabledOption(page, "opportunityStageId")
    const [convertLeadRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/convert_lead_to_customer") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "convert-lead"),
    ])
    expect(convertLeadRes.ok()).toBe(true)
    const leadId = await fetchLeadIdByName(page, leadName)

    const opportunityName = `${leadName} - Opportunity`
    await page.reload()
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await expectSeededText(page, opportunityName, "/api/query/opportunities")
    const opportunityId = await fetchOpportunityIdByName(page, opportunityName)

    // Step 5a — add opportunity line (UI; copied to SO on convert)
    await openEntityCreate(page, "/crm", "crm", "opportunity-lines", "add-opportunity-line")
    await chooseSelectOptionByLabel(page, "opportunityId", opportunityName)
    await page.getByTestId("form-field-productId").click()
    await page.getByRole("option", { name: "Lumiere Dev Laptop" }).click()
    await chooseFirstEnabledOption(page, "uomId")
    await fillField(page, "quantity", "1")
    await fillField(page, "priceUnit", "1200")
    const [oppLineRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_opportunity_line") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "add-opportunity-line"),
    ])
    expect(oppLineRes.ok()).toBe(true)
    await waitForOpportunityLineExists(page, opportunityId)

    // Step 6 — convert opportunity → sale order (UI)
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, opportunityName)
    await waitForEntityActionEnabled(page, "entity-action-convert-opp-order")
    await page.getByTestId("entity-action-convert-opp-order").click()
    await expect(page.getByTestId("form-modal-convert-opportunity-order")).toBeVisible()
    await chooseFirstEnabledOption(page, "pricelistId")
    await chooseFirstEnabledOption(page, "warehouseId")
    const [convertOppRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/call/convert_opportunity_to_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "convert-opportunity-order"),
    ])
    expect(convertOppRes.ok()).toBe(true)
    const orderId = await fetchSaleOrderIdByOpportunityId(page, opportunityId)
    await waitForSaleOrderDraftInQuery(page, orderId)
    await waitForSaleOrderLineExists(page, orderId)

    // Step 7 — confirm sale order (UI; rows show SO reference, not partner name)
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
    const confirmResPromise = page.waitForResponse(
      (res) => res.url().includes("/api/call/confirm_sales_order"),
      { timeout: 30_000 },
    )
    await page.getByTestId("entity-action-confirm-orders").click()
    const confirmRes = await confirmResPromise
    if (!confirmRes.ok()) {
      const body = await confirmRes.text().catch(() => "")
      throw new Error(`confirm_sales_order failed (${confirmRes.status()}): ${body}`)
    }
    await waitForSaleOrderConfirmed(page, orderId)
    await waitForSaleOrderBillableLines(page, orderId)

    // Step 8 — confirm → assign → validate delivery (UI)
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-fulfillment").click()
    await page
      .waitForResponse(
        (res) => res.url().includes("/api/query/stock-pickings") && res.ok(),
        { timeout: 30_000 },
      )
      .catch(() => undefined)
    const pickingId = await fetchFulfillmentPickingIdBySaleOrderId(page, orderId)
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-picking")
    const confirmPickingResPromise = page.waitForResponse(
      (res) => res.url().includes("/api/call/confirm_stock_picking"),
      { timeout: 45_000 },
    )
    await page.getByTestId("entity-action-confirm-picking").click()
    const confirmPickingRes = await confirmPickingResPromise
    if (!confirmPickingRes.ok()) {
      const body = await confirmPickingRes.text().catch(() => "")
      throw new Error(`confirm_stock_picking failed (${confirmPickingRes.status()}): ${body}`)
    }
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-assign-picking")
    const assignPickingResPromise = page.waitForResponse(
      (res) => res.url().includes("/api/call/assign_stock_picking"),
      { timeout: 30_000 },
    )
    await page.getByTestId("entity-action-assign-picking").click()
    const assignPickingRes = await assignPickingResPromise
    if (!assignPickingRes.ok()) {
      const body = await assignPickingRes.text().catch(() => "")
      throw new Error(`assign_stock_picking failed (${assignPickingRes.status()}): ${body}`)
    }
    await selectEntityRowById(page, pickingId)
    await waitForEntityActionEnabled(page, "entity-action-validate-picking")
    const validatePickingResPromise = page.waitForResponse(
      (res) => res.url().includes("/api/call/validate_stock_picking"),
      { timeout: 30_000 },
    )
    await page.getByTestId("entity-action-validate-picking").click()
    const validatePickingRes = await validatePickingResPromise
    if (!validatePickingRes.ok()) {
      const body = await validatePickingRes.text().catch(() => "")
      throw new Error(`validate_stock_picking failed (${validatePickingRes.status()}): ${body}`)
    }
    await waitForSaleOrderLineQtyDelivered(page, orderId)

    // Step 9 — create invoice from sale order (UI)
    const journalLabel = await fetchSalesInvoiceJournalLabel(page)
    const incomeLabel = await fetchAccountSelectLabelByInternalType(page, "income")
    const receivableLabel = await fetchAccountSelectLabelByInternalType(page, "receivable")
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-create-invoice")
    await page.getByTestId("entity-action-create-invoice").click()
    await expect(page.getByTestId("form-modal-create-invoice-from-sale-order")).toBeVisible()
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "defaultIncomeAccountId", incomeLabel)
    await chooseSelectOptionByLabel(page, "receivableAccountId", receivableLabel)
    const [invoiceRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/call/create_invoice_from_sale_order") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "create-invoice-from-sale-order"),
    ])
    expect(invoiceRes.ok()).toBe(true)

    const moveId = await fetchDraftInvoiceMoveIdByPartner(page, leadName)
    await assertMoveLinesBalanced(page, moveId)

    // Step 10 — post invoice (UI — invoices tab → detail modal → Post)
    await postDraftInvoiceViaUi(page, leadName)

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-invoices").click()
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 30_000 })

    // Step 11 — create payment → post → register on invoice (UI)
    const { partnerId, amountTotal, currencyId } = await fetchInvoiceMoveDetails(page, moveId)

    await page.getByTestId("module-tab-accounting-payments").click()
    await page.getByTestId("module-create-accounting-payments").click()
    await expect(page.getByTestId("form-modal-new-account-payment")).toBeVisible()
    await fillField(page, "partnerId", String(partnerId))
    await fillField(page, "amount", String(amountTotal))
    await fillField(page, "currencyId", String(currencyId))
    await chooseFirstEnabledOption(page, "journalId")
    const [createPaymentRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_payment") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-account-payment"),
    ])
    expect(createPaymentRes.ok()).toBe(true)

    const paymentId = await fetchLatestPaymentIdByPartner(page, partnerId, { state: "NotPaid" })
    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-post")
    const [postPaymentRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/post_payment") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-pay-post").click(),
    ])
    expect(postPaymentRes.ok()).toBe(true)
    await waitForPaymentPosted(page, paymentId)

    await selectEntityRowById(page, paymentId)
    await waitForEntityActionEnabled(page, "entity-action-pay-link")
    await page.getByTestId("entity-action-pay-link").click()
    await expect(page.getByTestId("form-modal-register-payment-invoices")).toBeVisible()
    await fillField(page, "invoiceIds", String(moveId))
    const [registerRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/register_payment_on_invoice") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "register-payment-invoices"),
    ])
    expect(registerRes.ok()).toBe(true)
    await expectNoAppError(page)

    // Step 13 — dashboard / report updates (live KPI widgets)
    await expectOverviewDashboardLive(page)

    // Step 17 — audit trail (query + Settings UI)
    await waitForAuditLogEntry(page, "lead", "CREATE")
    await waitForAuditLogEntry(page, "sale_order", "CREATE")
    await openSettingsSection(page, "audit")
    await expect(page.getByTestId("audit-log-panel")).toBeVisible()
    await expect(page.getByTestId("audit-log-list")).toBeVisible()
    await expect(page.locator("[data-testid^='audit-log-entry-']").first()).toBeVisible({
      timeout: 15_000,
    })

    // Sanity: lead id still resolvable after workflow
    expect(leadId).toBeGreaterThan(0)
  })
})
