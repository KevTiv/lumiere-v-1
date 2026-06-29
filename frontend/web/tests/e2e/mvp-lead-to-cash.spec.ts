import { expect, test } from "@playwright/test"

import {
  callReducerBff,
  chooseFirstOption,
  expectNoAppError,
  expectSeededText,
  fetchDraftInvoiceMoveIdByPartner,
  fetchFirstOpportunityStageId,
  fetchFirstPricelistId,
  fetchFirstWarehouseId,
  fetchLeadIdByName,
  fetchOpportunityIdByName,
  fetchProductIdByName,
  fetchSaleOrderIdByOpportunityId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  openEntityCreate,
  selectEntityRowById,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"

/**
 * Golden-path lead → cash workflow (creates data; see docs/MVP_WORKFLOW_CONTRACT.md).
 *
 * Uses BFF `/api/call` for qualified lead create, sale order line add, and invoice post
 * where UI gaps exist.
 */
test.describe("MVP lead-to-cash workflow", { tag: "@p0" }, () => {
  test("creates CRM lead through invoice post", async ({ page }) => {
    test.setTimeout(180_000)

    const contactName = smokeName("mvp-contact")
    const leadName = smokeName("mvp-lead")
    const orgId = await fetchSessionOrganizationId(page)

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

    // Step 4 — lead (BFF: must start qualified for conversion)
    await callReducerBff(page, "create_lead", [
      orgId,
      {
        name: leadName,
        contactName: leadName,
        email: `${leadName}@example.test`,
        expectedRevenue: 2500,
        probability: 10,
        priority: "Medium",
        state: "qualified",
        tagIds: [],
      },
    ])
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await expect(page.getByText(leadName)).toBeVisible()

    // Step 5 — convert lead (BFF — stage select may not be hydrated when modal opens)
    const leadId = await fetchLeadIdByName(page, leadName)
    const stageId = await fetchFirstOpportunityStageId(page)
    await callReducerBff(page, "convert_lead_to_customer", [
      orgId,
      leadId,
      {
        createContact: true,
        createOpportunity: true,
        opportunityStageId: stageId,
      },
    ])

    // Step 6 — convert opportunity → sale order (BFF — pricelist select may be empty on legacy DBs)
    const opportunityName = `${leadName} - Opportunity`
    await page.reload()
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await expectSeededText(page, opportunityName, "/api/query/opportunities")
    const opportunityId = await fetchOpportunityIdByName(page, opportunityName)
    const pricelistId = await fetchFirstPricelistId(page)
    const warehouseId = await fetchFirstWarehouseId(page)
    await callReducerBff(
      page,
      "convert_opportunity_to_sale_order",
      [opportunityId, { pricelistId, warehouseId }],
      { withCompany: true },
    )
    const orderId = await fetchSaleOrderIdByOpportunityId(page, opportunityId)

    // Step 7 — add sale order line (BFF — no create form on order-lines tab)
    const productId = await fetchProductIdByName(page, "Lumiere Dev Laptop")
    await callReducerBff(page, "create_sale_order_line", [
      orgId,
      orderId,
      {
        productId,
        quantity: 1,
        uomId: 1,
        priceUnit: 1200,
        discount: 0,
        taxIds: [],
        name: "MVP smoke line",
        sequence: 10,
        isDownpayment: false,
        analyticTagIds: [],
      },
    ])

    // Step 8 — confirm sale order (UI; rows show SO reference, not partner name)
    await gotoModule(page, "/sales", "sales")
    await page.getByTestId("module-tab-sales-orders").click()
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-confirm-orders")
    await page.getByTestId("entity-action-confirm-orders").click()
    const confirmRes = await page.waitForResponse(
      (res) => res.url().includes("/api/call/confirm_sales_order") && res.ok(),
      { timeout: 30_000 },
    )
    expect(confirmRes.ok()).toBe(true)

    // Step 10 — create invoice from sale order (UI)
    await selectEntityRowById(page, orderId)
    await waitForEntityActionEnabled(page, "entity-action-create-invoice")
    await page.getByTestId("entity-action-create-invoice").click()
    await expect(page.getByTestId("form-modal-create-invoice-from-order")).toBeVisible()
    await chooseFirstOption(page, "journalId")
    await chooseFirstOption(page, "defaultIncomeAccountId")
    await submitForm(page, "create-invoice-from-order")

    // Step 11 — post invoice (BFF — invoices tab uses custom list, not entity-table)
    const moveId = await fetchDraftInvoiceMoveIdByPartner(page, leadName)
    await callReducerBff(page, "post_account_move", [orgId, moveId])

    await gotoModule(page, "/accounting", "accounting")
    await page.getByTestId("module-tab-accounting-invoices").click()
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)

    // Sanity: lead id still resolvable after workflow
    expect(leadId).toBeGreaterThan(0)
  })
})
