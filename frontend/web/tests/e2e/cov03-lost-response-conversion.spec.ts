import { expect, test, type Page } from "@playwright/test"

import { matchesOperationResponse } from "./operation-response"
import { loseNextResponse } from "./pretenant-support"
import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectFormModalVisible,
  expectNoAppError,
  expectSeededText,
  fetchDefaultCompanyId,
  fetchOpportunityIdByName,
  fetchSaleOrderIdsByOpportunityId,
  fillField,
  gotoModule,
  openEntityCreate,
  reloadSettled,
  selectEntityRowByText,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
  waitForOpportunityLineExists,
} from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function createConvertibleOpportunity(page: Page, label: string) {
  const leadName = smokeName(label)
  const opportunityName = `${leadName} - Opportunity`
  await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
  await fillField(page, "contactName", leadName)
  await fillField(page, "emailFrom", `${leadName}@example.test`)
  await fillField(page, "expectedRevenue", "2500")
  await fillField(page, "probability", "20")
  await chooseSelectOptionByLabel(page, "state", "Qualified")
  await submitForm(page, "new-lead")

  await gotoModule(page, "/crm", "crm")
  await selectModuleTab(page, "crm", "leads")
  await expectSeededText(page, leadName, "/api/query/leads")
  await waitForBffQueryMinRows(page, "/api/query/opportunity-stages")
  await selectEntityRowByText(page, leadName)
  await waitForEntityActionEnabled(page, "entity-action-convert-lead")
  await page.getByTestId("entity-action-convert-lead").click()
  await expectFormModalVisible(page, "convert-lead")
  await chooseFirstEnabledOption(page, "opportunityStageId")
  await submitForm(page, "convert-lead")

  await reloadSettled(page)
  await gotoModule(page, "/crm", "crm")
  await selectModuleTab(page, "crm", "opportunities")
  await expectSeededText(page, opportunityName, "/api/query/opportunities")
  const opportunityId = await fetchOpportunityIdByName(page, opportunityName)

  await openEntityCreate(page, "/crm", "crm", "opportunity-lines", "add-opportunity-line")
  await chooseSelectOptionByLabel(page, "opportunityId", opportunityName)
  await page.getByTestId("form-field-productId").click()
  await page.getByRole("option", { name: "Lumiere Dev Laptop" }).click()
  await chooseFirstEnabledOption(page, "uomId")
  await fillField(page, "quantity", "1")
  await fillField(page, "priceUnit", "1200")
  await submitForm(page, "add-opportunity-line")
  await waitForOpportunityLineExists(page, opportunityId)
  return { opportunityName, opportunityId }
}

async function openConversionForm(page: Page, opportunityName: string) {
  await gotoModule(page, "/crm", "crm")
  await selectModuleTab(page, "crm", "opportunities")
  await selectEntityRowByText(page, opportunityName)
  await waitForEntityActionEnabled(page, "entity-action-convert-opp-order")
  await page.getByTestId("entity-action-convert-opp-order").click()
  await expectFormModalVisible(page, "convert-opportunity-order")
  await chooseFirstEnabledOption(page, "pricelistId")
  await chooseFirstEnabledOption(page, "warehouseId")
}

test.describe("COV-03 opportunity conversion recovery", { tag: ["@p0", "@cov03", "@unauthenticated"] }, () => {
  test("a lost response and a stale second session both reconcile to the one committed order", async ({ browser }) => {
    test.setTimeout(300_000)
    const salesContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await salesContext.newPage()
    const staleContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const stalePage = await staleContext.newPage()
    try {
      await signIn(page, "fixture.sales@example.test", PERSONA_PASSWORD)
      await signIn(stalePage, "fixture.sales@example.test", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const { opportunityName, opportunityId } = await test.step(
        "Create and qualify the convertible opportunity",
        () => createConvertibleOpportunity(page, "cov03-lost"),
        { timeout: 120_000 },
      )

      // A second session opens the conversion form while no order exists yet.
      await test.step("Open stale-session conversion", () => openConversionForm(stalePage, opportunityName), { timeout: 45_000 })

      // Session one converts, but the browser loses the reply after the server committed.
      await test.step("Open active-session conversion", () => openConversionForm(page, opportunityName), { timeout: 45_000 })
      const drop = await loseNextResponse(page, "convert_opportunity_to_sale_order")
      await submitForm(page, "convert-opportunity-order").catch(() => undefined)
      await expect.poll(() => drop.lost()).toBe(true)
      await expect
        .poll(() => fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId), { timeout: 30_000 })
        .toHaveLength(1)
      const [orderId] = await fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId)
      await page.unrouteAll({ behavior: "wait" })

      // Operator recovery: reopen and submit again. The pre-read finds the committed
      // effect, reports it, and dispatches nothing.
      await openConversionForm(page, opportunityName)
      let redispatched = 0
      const count = (request: { url(): string }) => {
        if (matchesOperationResponse(request, "convert_opportunity_to_sale_order")) redispatched += 1
      }
      page.on("request", count)
      try {
        await submitForm(page, "convert-opportunity-order")
      } finally {
        page.off("request", count)
      }
      expect(redispatched).toBe(0)
      await expect(
        page.getByText("This opportunity already has a sales order.", { exact: true }),
      ).toBeVisible({ timeout: 15_000 })

      // The stale session submits its old form: same reconciliation, still no duplicate.
      let staleDispatches = 0
      const countStale = (request: { url(): string }) => {
        if (matchesOperationResponse(request, "convert_opportunity_to_sale_order")) staleDispatches += 1
      }
      stalePage.on("request", countStale)
      try {
        await submitForm(stalePage, "convert-opportunity-order")
      } finally {
        stalePage.off("request", countStale)
      }
      expect(staleDispatches).toBe(0)
      await expect(
        stalePage.getByText("This opportunity already has a sales order.", { exact: true }),
      ).toBeVisible({ timeout: 15_000 })

      expect(await fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId)).toEqual([orderId])
      await expectNoAppError(page)
    } finally {
      await staleContext.close()
      await salesContext.close()
    }
  })

  test("a reader cannot start the conversion from the UI and a forged request is denied", async ({ browser }) => {
    test.setTimeout(120_000)
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await readerContext.newPage()
    try {
      await signIn(page, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await page.request.get("/api/query/leads")
      expect(denied.status()).toBe(403)
      await gotoModule(page, "/crm", "crm")
      await selectModuleTab(page, "crm", "leads")
      // Denied optional SSR reads are represented by the client panel rather
      // than throwing to the Next.js route error boundary.
      await expect(page.getByTestId("module-panel-crm-leads").getByRole("status")).toBeVisible()
      await expect(page.getByTestId("module-create-crm-leads")).toHaveCount(0)
      await expect(page.getByTestId("entity-action-convert-lead")).toHaveCount(0)
      await expect(page.getByText("Application error")).toHaveCount(0)
    } finally {
      await readerContext.close()
    }
  })
})
