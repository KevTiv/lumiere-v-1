import { expect, test } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { matchesOperationResponse } from "./operation-response"
import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectFormModalVisible,
  expectNoAppError,
  expectSeededText,
  fetchDefaultCompanyId,
  fetchFirstPricelistId,
  fetchFirstWarehouseId,
  fetchOpportunityIdByName,
  fetchSaleOrderIdByOpportunityId,
  fetchSaleOrderIdsByOpportunityId,
  fillField,
  gotoModule,
  openEntityCreate,
  selectEntityRowByText,
  signIn,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
  waitForOpportunityLineExists,
  waitForSaleOrderLineExists,
} from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

test.describe("COV-01d/COV-03 opportunity → sale-order effect certification", { tag: ["@p0", "@cov03", "@unauthenticated"] }, () => {
  test("sales persona resolves one exact order, replay does not redispatch, and reader is denied", async ({ browser }) => {
    test.setTimeout(180_000)

    const salesContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await salesContext.newPage()
    await signIn(page, "fixture.sales@example.test", PERSONA_PASSWORD)

    const leadName = smokeName("cov01d-lead")
    const opportunityName = `${leadName} - Opportunity`
    const companyId = await fetchDefaultCompanyId(page)
    const pricelistId = await fetchFirstPricelistId(page)
    const warehouseId = await fetchFirstWarehouseId(page)

    // Setup stays on the normal CRM operator path so the conversion is tested
    // with the same persisted opportunity shape a first-org user sees.
    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "2500")
    await fillField(page, "probability", "20")
    await chooseSelectOptionByLabel(page, "state", "Qualified")
    await submitForm(page, "new-lead")

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await expectSeededText(page, leadName, "/api/query/leads")
    await waitForBffQueryMinRows(page, "/api/query/opportunity-stages")
    await selectEntityRowByText(page, leadName)
    await waitForEntityActionEnabled(page, "entity-action-convert-lead")
    await page.getByTestId("entity-action-convert-lead").click()
    await expectFormModalVisible(page, "convert-lead")
    await chooseFirstEnabledOption(page, "opportunityStageId")
    await submitForm(page, "convert-lead")

    await page.reload({ waitUntil: "domcontentloaded" })
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await expectSeededText(page, opportunityName, "/api/query/opportunities")
    const opportunityId = await fetchOpportunityIdByName(page, opportunityName)

    // Add a real commercial line so the converted Sales record is useful, not
    // just an empty shell created for the test.
    await openEntityCreate(page, "/crm", "crm", "opportunity-lines", "add-opportunity-line")
    await chooseSelectOptionByLabel(page, "opportunityId", opportunityName)
    await page.getByTestId("form-field-productId").click()
    await page.getByRole("option", { name: "Lumiere Dev Laptop" }).click()
    await chooseFirstEnabledOption(page, "uomId")
    await fillField(page, "quantity", "1")
    await fillField(page, "priceUnit", "1200")
    await submitForm(page, "add-opportunity-line")
    await waitForOpportunityLineExists(page, opportunityId)

    // First conversion must dispatch through the real CRM action and resolve to
    // one exact sale_order(opportunity_id, company_id) effect.
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, opportunityName)
    await waitForEntityActionEnabled(page, "entity-action-convert-opp-order")
    await page.getByTestId("entity-action-convert-opp-order").click()
    await expectFormModalVisible(page, "convert-opportunity-order")
    await chooseFirstEnabledOption(page, "pricelistId")
    await chooseFirstEnabledOption(page, "warehouseId")

    const firstDispatch = page.waitForResponse(
      (response) =>
        matchesOperationResponse(response, "convert_opportunity_to_sale_order") && response.ok(),
      { timeout: 30_000 },
    )
    await submitForm(page, "convert-opportunity-order")
    await firstDispatch

    const orderId = await fetchSaleOrderIdByOpportunityId(page, opportunityId, companyId)
    expect(orderId).toBeGreaterThan(0)
    await expect
      .poll(
        async () => fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId),
        { timeout: 30_000 },
      )
      .toEqual([orderId])
    await waitForSaleOrderLineExists(page, orderId)

    // Replay the same operator action. COV-01b must pre-read the exact effect,
    // return AlreadyApplied, close with semantic feedback, and never dispatch a
    // second consequential operation.
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, opportunityName)
    await waitForEntityActionEnabled(page, "entity-action-convert-opp-order")
    await page.getByTestId("entity-action-convert-opp-order").click()
    await expectFormModalVisible(page, "convert-opportunity-order")
    await chooseFirstEnabledOption(page, "pricelistId")
    await chooseFirstEnabledOption(page, "warehouseId")

    let replayDispatches = 0
    const countReplayDispatch = (request: { url(): string }) => {
      if (matchesOperationResponse(request, "convert_opportunity_to_sale_order")) {
        replayDispatches += 1
      }
    }
    page.on("request", countReplayDispatch)
    try {
      await submitForm(page, "convert-opportunity-order")
    } finally {
      page.off("request", countReplayDispatch)
    }

    expect(replayDispatches).toBe(0)
    await expect(
      page.getByText("This opportunity already has a sales order.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 })

    const replayIds = await fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId)
    expect(replayIds).toEqual([orderId])
    await expectNoAppError(page)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const { urlPath, init } = stdbBffCommandPost("convert_opportunity_to_sale_order", {
        companyId,
        opportunityId,
        params: stdbParamsToJson(
          { pricelistId: BigInt(pricelistId), warehouseId: BigInt(warehouseId) },
          "ConvertOpportunityParams",
        ),
      })
      const denial = await readerPage.request.post(urlPath, {
        headers: { "Content-Type": "application/json" },
        data: JSON.parse(String(init.body)),
      })
      expect(denial.status()).toBe(403)
      expect(await fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId)).toEqual([
        orderId,
      ])
    } finally {
      await readerContext.close()
      await salesContext.close()
    }
  })
})
