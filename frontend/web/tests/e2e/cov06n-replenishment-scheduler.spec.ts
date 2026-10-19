import { expect, test } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { fetchContactIdByName, fetchDefaultCompanyId, gotoModule, scalarQueryId, selectEntityRowById, signIn } from "./helpers"
import { command, create, id, location, password, product, rows, value } from "./cov-scheduler-manufacturing-fixtures"
import { createProductSupplierInfoFixture, createStockQuantFixture, fetchQuantsAtProductLocation } from "./inventory-quant-fixtures"
import { fetchPickingMoveStates, fetchPickingState, runPickingActionViaInventoryUi } from "./inventory-picking-fixtures"

function timestamp(millis: number) {
  return { microsSinceUnixEpoch: BigInt(millis) * 1_000n }
}

test.describe("COV-06n operator replenishment schedule and cancel", {
  tag: ["@p0", "@cov06", "@cov06n", "@unauthenticated"],
}, () => {
  test("warehouse schedules exact transfer and supplier-backed buy demands", async ({ page, browser }) => {
    test.setTimeout(360_000)
    await signIn(page)
    const companyId = await fetchDefaultCompanyId(page)
    const item = await product(page)
    const source = await location(page, companyId)
    const destination = await location(page, companyId)
    await createStockQuantFixture(
      page,
      companyId,
      id(item),
      id(source),
      `cov06n-source-${id(item)}`,
      20,
    )
    const rule = await create(page, "replenishment-rules", "create_replenishment_rule", {
      companyId,
      params: stdbParamsToJson({
        productId: id(item), locationId: id(destination), uomId: id(item, "uomId", "uom_id"),
        productMinQty: 10, productMaxQty: 20, qtyMultiple: 1, leadDays: 1,
        trigger: "auto", active: true, warehouseId: null, routeId: null, groupId: null,
        lastRun: null, nextRun: timestamp(Date.now() + 45_000), metadata: null,
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
      const readerPage = await reader.newPage()
      await signIn(warehousePage, "fixture.warehouse@example.test", password)
      await signIn(readerPage, "fixture.reader@example.test", password)
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
      expect((await command(readerPage, "cancel_replenishment_run", { companyId, ruleId })).status()).toBe(403)
      expect((await jobs()).map(row => id(row, "scheduledId", "scheduled_id"))).toEqual([scheduledId])

      // This is the scheduler proof, rather than merely proving queue CRUD:
      // the due job must execute the exact rule against an empty destination,
      // create one canonical internal-transfer demand from the stocked source,
      // stamp last_run, and replace itself with the next recurring job.
      await expect.poll(async () => {
        const current = (await rows(page, "replenishment-rules")).find(row => id(row) === ruleId)
        return value(current ?? {}, "lastRun", "last_run") ?? null
      }, { timeout: 75_000 }).not.toBeNull()
      await expect.poll(async () => {
        const pending = await jobs()
        return pending.length === 1
          ? id(pending[0]!, "scheduledId", "scheduled_id")
          : 0
      }, { timeout: 30_000 }).toBeGreaterThan(scheduledId)
      const demandName = `INT-RPL-${ruleId}`
      const demands = (await rows(page, "stock-pickings")).filter(row =>
        value(row, "name", "name") === demandName &&
        id(row, "companyId", "company_id") === companyId)
      expect(demands).toHaveLength(1)
      const demandId = id(demands[0]!)
      const completedRule = (await rows(page, "replenishment-rules")).find(row => id(row) === ruleId)
      const demandMetadata = JSON.parse(String(value(completedRule ?? {}, "metadata", "metadata"))) as {
        demand_type?: string
        demand_id?: number
        order_qty?: number
      }
      expect(demandMetadata).toMatchObject({
        demand_type: "transfer",
        demand_id: demandId,
        order_qty: 20,
      })
      expect(await fetchPickingState(page, demandId)).toBe("draft")
      const demandMoves = await fetchPickingMoveStates(page, demandId)
      expect(demandMoves).toHaveLength(1)

      for (const action of ["confirm", "assign", "validate"] as const) {
        await runPickingActionViaInventoryUi(warehousePage, demandId, action)
      }
      await expect.poll(() => fetchPickingState(page, demandId)).toBe("done")
      expect((await fetchPickingMoveStates(page, demandId)).map(move => move.id)).toEqual(
        demandMoves.map(move => move.id),
      )
      expect((await fetchPickingMoveStates(page, demandId)).every(move => move.isDone)).toBe(true)
      const destinationQuants = await fetchQuantsAtProductLocation(page, id(item), id(destination))
      expect(destinationQuants).toHaveLength(1)
      expect(destinationQuants[0]).toMatchObject({ quantity: 20, availableQuantity: 20 })

      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${ruleId}`, "inventory")
      await selectEntityRowById(warehousePage, ruleId)
      await warehousePage.getByTestId("entity-action-cancel-replenishment-run").click()
      await expect.poll(async () => (await jobs()).length, { timeout: 30_000 }).toBe(0)
      expect((await command(warehousePage, "cancel_replenishment_run", { companyId, ruleId })).ok()).toBe(true)
      expect(await jobs()).toHaveLength(0)

      // Supplier-backed rules exercise the separate scheduled buy service
      // boundary: the timer, not an interactive purchasing user, creates one
      // exact draft PO and line with canonical rule linkage.
      const buyItem = await product(page)
      const buyDestination = await location(page, companyId)
      const vendorId = await fetchContactIdByName(page, "Globex Corp")
      const currenciesResponse = await page.request.get("/api/bootstrap/currencies")
      expect(currenciesResponse.ok()).toBe(true)
      const currencies = await currenciesResponse.json() as { data?: Array<Record<string, unknown>> }
      const currencyId = scalarQueryId(currencies.data?.[0]?.id)
      if (currencyId == null) throw new Error("No currency in seed data")
      await createProductSupplierInfoFixture(page, id(buyItem), vendorId, currencyId, 1, 12)
      const buyRule = await create(page, "replenishment-rules", "create_replenishment_rule", {
        companyId,
        params: stdbParamsToJson({
          productId: id(buyItem), locationId: id(buyDestination),
          uomId: id(buyItem, "uomId", "uom_id"), productMinQty: 10,
          productMaxQty: 20, qtyMultiple: 1, leadDays: 1, trigger: "auto",
          active: true, warehouseId: null, routeId: null, groupId: null,
          lastRun: null, nextRun: timestamp(Date.now() + 45_000), metadata: null,
        }, "CreateReplenishmentRuleParams"),
      }, row => id(row, "productId", "product_id") === id(buyItem) &&
        id(row, "locationId", "location_id") === id(buyDestination) &&
        id(row, "companyId", "company_id") === companyId)
      const buyRuleId = id(buyRule)
      const buyJobs = async () => (await rows(page, "replenishment-run-jobs")).filter(row =>
        id(row, "ruleId", "rule_id") === buyRuleId &&
        id(row, "companyId", "company_id") === companyId)

      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${buyRuleId}`, "inventory")
      await selectEntityRowById(warehousePage, buyRuleId)
      await warehousePage.getByTestId("entity-action-schedule-replenishment-run").click()
      await expect.poll(async () => (await buyJobs()).length, { timeout: 30_000 }).toBe(1)
      const scheduledBuyJob = (await buyJobs())[0]!
      const buyScheduledId = id(scheduledBuyJob, "scheduledId", "scheduled_id")
      try {
        await expect.poll(async () => {
          const current = (await rows(page, "replenishment-rules")).find(row => id(row) === buyRuleId)
          return value(current ?? {}, "lastRun", "last_run") ?? null
        }, { timeout: 75_000 }).not.toBeNull()
      } catch (error) {
        // The scheduled run never stamped last_run, so it failed. Replay the same
        // rule synchronously once to surface the reducer's rejection reason.
        const jobsAtFailure = (await buyJobs()).map(row => ({ scheduledId: id(row, "scheduledId", "scheduled_id"), scheduledAt: value(row, "scheduledAt", "scheduled_at") }))
        const probe = await command(page, "execute_replenishment_rule", { companyId, ruleId: buyRuleId, idempotencyKey: `diag-${buyRuleId}` })
        throw new Error(`scheduled buy run did not execute (job ${buyScheduledId} due ${JSON.stringify(value(scheduledBuyJob, "scheduledAt", "scheduled_at"))}; now ${Date.now() * 1000}; jobs at failure ${JSON.stringify(jobsAtFailure)}); direct execute -> ${probe.status()} ${await probe.text()}`, { cause: error })
      }
      await expect.poll(async () => {
        const pending = await buyJobs()
        return pending.length === 1
          ? id(pending[0]!, "scheduledId", "scheduled_id")
          : 0
      }, { timeout: 30_000 }).toBeGreaterThan(buyScheduledId)

      const buyOrders = (await rows(page, "purchase-orders")).filter(row =>
        value(row, "origin", "origin") === `REPLENISH-${buyRuleId}` &&
        id(row, "companyId", "company_id") === companyId)
      expect(buyOrders).toHaveLength(1)
      const buyOrderId = id(buyOrders[0]!)
      const buyLines = (await rows(page, "purchase-order-lines")).filter(row =>
        id(row, "orderId", "order_id") === buyOrderId)
      expect(buyLines).toHaveLength(1)
      expect(Number(value(buyLines[0]!, "productQty", "product_qty"))).toBe(20)
      expect(Number(value(buyLines[0]!, "priceUnit", "price_unit"))).toBe(12)
      expect(id(buyLines[0]!, "productId", "product_id")).toBe(id(buyItem))
      const completedBuyRule = (await rows(page, "replenishment-rules")).find(row => id(row) === buyRuleId)
      const buyMetadata = JSON.parse(String(value(completedBuyRule ?? {}, "metadata", "metadata"))) as {
        demand_type?: string
        demand_id?: number
        order_qty?: number
      }
      expect(buyMetadata).toMatchObject({
        demand_type: "buy",
        demand_id: buyOrderId,
        order_qty: 20,
      })

      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${buyRuleId}`, "inventory")
      await selectEntityRowById(warehousePage, buyRuleId)
      await warehousePage.getByTestId("entity-action-cancel-replenishment-run").click()
      await expect.poll(async () => (await buyJobs()).length, { timeout: 30_000 }).toBe(0)

      // A rule whose destination already has the maximum quantity still runs
      // and recurs, but must not create either a transfer or purchase demand.
      const stockedItem = await product(page)
      const stockedDestination = await location(page, companyId)
      await createStockQuantFixture(
        page,
        companyId,
        id(stockedItem),
        id(stockedDestination),
        `cov06n-on-hand-${id(stockedItem)}`,
        20,
      )
      const stockedRule = await create(page, "replenishment-rules", "create_replenishment_rule", {
        companyId,
        params: stdbParamsToJson({
          productId: id(stockedItem), locationId: id(stockedDestination),
          uomId: id(stockedItem, "uomId", "uom_id"), productMinQty: 10,
          productMaxQty: 20, qtyMultiple: 1, leadDays: 1, trigger: "auto",
          active: true, warehouseId: null, routeId: null, groupId: null,
          lastRun: null, nextRun: timestamp(Date.now() + 45_000), metadata: null,
        }, "CreateReplenishmentRuleParams"),
      }, row => id(row, "productId", "product_id") === id(stockedItem) &&
        id(row, "locationId", "location_id") === id(stockedDestination) &&
        id(row, "companyId", "company_id") === companyId)
      const stockedRuleId = id(stockedRule)
      const stockedJobs = async () => (await rows(page, "replenishment-run-jobs")).filter(row =>
        id(row, "ruleId", "rule_id") === stockedRuleId &&
        id(row, "companyId", "company_id") === companyId)

      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${stockedRuleId}`, "inventory")
      await selectEntityRowById(warehousePage, stockedRuleId)
      await warehousePage.getByTestId("entity-action-schedule-replenishment-run").click()
      await expect.poll(async () => (await stockedJobs()).length, { timeout: 30_000 }).toBe(1)
      const stockedScheduledId = id((await stockedJobs())[0]!, "scheduledId", "scheduled_id")
      await expect.poll(async () => {
        const current = (await rows(page, "replenishment-rules")).find(row => id(row) === stockedRuleId)
        return value(current ?? {}, "lastRun", "last_run") ?? null
      }, { timeout: 75_000 }).not.toBeNull()
      await expect.poll(async () => {
        const pending = await stockedJobs()
        return pending.length === 1
          ? id(pending[0]!, "scheduledId", "scheduled_id")
          : 0
      }, { timeout: 30_000 }).toBeGreaterThan(stockedScheduledId)
      const stockedDemands = (await rows(page, "stock-pickings")).filter(row =>
        value(row, "name", "name") === `INT-RPL-${stockedRuleId}` &&
        id(row, "companyId", "company_id") === companyId)
      expect(stockedDemands).toHaveLength(0)
      const stockedBuyOrders = (await rows(page, "purchase-orders")).filter(row =>
        value(row, "origin", "origin") === `REPLENISH-${stockedRuleId}` &&
        id(row, "companyId", "company_id") === companyId)
      expect(stockedBuyOrders).toHaveLength(0)

      await gotoModule(warehousePage, `/inventory?tab=replenishment&filter=id:${stockedRuleId}`, "inventory")
      await selectEntityRowById(warehousePage, stockedRuleId)
      await warehousePage.getByTestId("entity-action-cancel-replenishment-run").click()
      await expect.poll(async () => (await stockedJobs()).length, { timeout: 30_000 }).toBe(0)
    } finally {
      await operator.close()
      await reader.close()
    }
  })
})
