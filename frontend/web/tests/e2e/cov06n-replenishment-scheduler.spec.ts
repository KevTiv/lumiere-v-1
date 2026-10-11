import { expect, test } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { fetchDefaultCompanyId, gotoModule, selectEntityRowById, signIn } from "./helpers"
import { command, create, id, location, password, product, rows, value } from "./cov-scheduler-manufacturing-fixtures"

test.describe("COV-06n operator replenishment schedule and cancel", {
  tag: ["@p0", "@cov06", "@cov06n", "@unauthenticated"],
}, () => {
  test("warehouse schedules exactly one scoped job, reader cannot cancel, warehouse cancels via UI", async ({ page, browser }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const companyId = await fetchDefaultCompanyId(page)
    const item = await product(page)
    const destination = await location(page, companyId)
    const rule = await create(page, "replenishment-rules", "create_replenishment_rule", {
      companyId,
      params: stdbParamsToJson({
        productId: id(item), locationId: id(destination), uomId: id(item, "uomId", "uom_id"),
        productMinQty: 10, productMaxQty: 20, qtyMultiple: 1, leadDays: 1,
        trigger: "auto", active: true, warehouseId: null, routeId: null, groupId: null,
        lastRun: null, nextRun: null, metadata: null,
      }, "CreateReplenishmentRuleParams"),
    }, row => id(row, "productId", "product_id") === id(item) &&
      id(row, "locationId", "location_id") === id(destination) &&
      id(row, "companyId", "company_id") === companyId &&
      id(row, "organizationId", "organization_id") === id(item, "organizationId", "organization_id"))
    const ruleId = id(rule)
    const jobs = async () => (await rows(page, "replenishment-run-jobs")).filter(row =>
      id(row, "ruleId", "rule_id") === ruleId &&
      id(row, "companyId", "company_id") === companyId &&
      id(row, "organizationId", "organization_id") === id(rule, "organizationId", "organization_id"))
    expect(await jobs()).toHaveLength(0)
    const operator = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const warehousePage = await operator.newPage()
      await signIn(warehousePage, "fixture.warehouse@example.test", password)
      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${ruleId}`, "inventory")
      await expect(warehousePage.getByTestId("module-tab-inventory-replenishment")).toHaveAttribute("aria-selected", "true")
      await selectEntityRowById(warehousePage, ruleId)
      await warehousePage.getByTestId("entity-action-schedule-replenishment-run").click()
      await expect.poll(async () => (await jobs()).length, { timeout: 30_000 }).toBe(1)
      const scheduled = (await jobs())[0]!
      const scheduledId = id(scheduled, "scheduledId", "scheduled_id")
      expect(value(scheduled, "scheduledAt", "scheduled_at")).toBeDefined()

      // Backend duplicate/denied probes supplement, never replace, the UI transition.
      const duplicate = await command(warehousePage, "schedule_replenishment_run", { companyId, ruleId })
      expect(duplicate.status()).toBe(422)
      expect((await jobs()).map(row => id(row, "scheduledId", "scheduled_id"))).toEqual([scheduledId])
      const readerPage = await reader.newPage()
      await signIn(readerPage, "fixture.reader@example.test", password)
      expect((await command(readerPage, "cancel_replenishment_run", { companyId, ruleId })).status()).toBe(403)
      expect((await jobs()).map(row => id(row, "scheduledId", "scheduled_id"))).toEqual([scheduledId])

      await warehousePage.getByTestId("entity-action-cancel-replenishment-run").click()
      await expect.poll(async () => (await jobs()).length, { timeout: 30_000 }).toBe(0)
      expect((await command(warehousePage, "cancel_replenishment_run", { companyId, ruleId })).ok()).toBe(true)
      expect(await jobs()).toHaveLength(0)
    } finally {
      await operator.close()
      await reader.close()
    }
  })
})
