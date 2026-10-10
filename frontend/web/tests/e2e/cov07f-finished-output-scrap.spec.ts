import { expect, test } from "@playwright/test"
import { stdbBffCallUrl } from "@lumiere/stdb/commands"
import { scalarQueryId, signIn, submitForm } from "./helpers"
import { command, exact, id, location, manufacturingFixture, openRow, password, prepareOutput, quantQuantity, rows, tag, value } from "./cov-scheduler-manufacturing-fixtures"

test.describe("COV-07f operator finished-output scrap", {
  tag: ["@p0", "@cov07", "@cov07f", "@unauthenticated"],
}, () => {
  test("warehouse scraps a Done MO with request-bound move and exact quant deltas", async ({ page, browser }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const fixture = await manufacturingFixture(page)
    const { companyId, primary, destination, mo } = fixture
    const moId = id(mo)
    const scrap = await location(page, companyId, true)
    await prepareOutput(page, companyId, moId)
    expect((await command(page, "finish_manufacturing_order", { companyId, moId })).ok()).toBe(true)
    await expect.poll(async () => tag((await exact(page, "mrp-productions", moId)).state)).toBe("Done")
    const finishedIds = value(await exact(page, "mrp-productions", moId), "moveFinishedIds", "move_finished_ids")
    const beforeSource = await quantQuantity(page, companyId, id(primary), id(destination))
    const beforeScrap = await quantQuantity(page, companyId, id(primary), id(scrap))
    const operator = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const warehousePage = await operator.newPage()
      await signIn(warehousePage, "fixture.warehouse@example.test", password)
      const formId = await openRow(warehousePage, "orders", moId)
      await warehousePage.getByTestId("form-field-moAction-scrap_output").click()
      await warehousePage.getByTestId("form-field-scrapLocationId").fill(String(id(scrap)))
      await warehousePage.getByTestId("form-field-scrapQuantity").fill("0.5")
      // Capture the generated operator request identity, not a guessed/newest effect row.
      const requestPromise = warehousePage.waitForRequest(request =>
        new URL(request.url()).pathname === stdbBffCallUrl("scrap_finished_manufacturing_output"))
      await submitForm(warehousePage, formId)
      const request = await requestPromise
      const body = request.postDataJSON()
      const requestId = body.requestId ?? body.request_id
      expect(typeof requestId).toBe("string")
      const reference = `MO/${moId}/SCRAP/${requestId}`
      const effects = async () => (await rows(page, "stock-moves")).filter(row =>
        scalarQueryId(value(row, "productionId", "production_id")) === moId &&
        id(row, "companyId", "company_id") === companyId &&
        id(row, "organizationId", "organization_id") === id(mo, "organizationId", "organization_id") &&
        row.scrapped === true && row.reference === reference)
      await expect.poll(async () => (await effects()).length, { timeout: 30_000 }).toBe(1)
      const effect = (await effects())[0]!
      expect(id(effect, "productId", "product_id")).toBe(id(primary))
      expect(id(effect, "locationDestId", "location_dest_id")).toBe(id(scrap))
      await expect.poll(async () => [
        await quantQuantity(page, companyId, id(primary), id(destination)),
        await quantQuantity(page, companyId, id(primary), id(scrap)),
      ]).toEqual([beforeSource - 0.5, beforeScrap + 0.5])
      await expect(warehousePage.getByTestId(`form-modal-${formId}`)).not.toBeVisible()

      const input = { companyId, moId, scrapLocationId: id(scrap), quantity: 0.5, requestId }
      expect((await command(warehousePage, "scrap_finished_manufacturing_output", input)).status()).toBe(422)
      const readerPage = await reader.newPage()
      await signIn(readerPage, "fixture.reader@example.test", password)
      expect((await command(readerPage, "scrap_finished_manufacturing_output", { ...input, requestId: `denied-${requestId}` })).status()).toBe(403)
      expect((await effects()).map(row => id(row))).toEqual([id(effect)])
      expect(await quantQuantity(page, companyId, id(primary), id(destination))).toBe(beforeSource - 0.5)
      expect(await quantQuantity(page, companyId, id(primary), id(scrap))).toBe(beforeScrap + 0.5)
      expect(value(await exact(page, "mrp-productions", moId), "moveFinishedIds", "move_finished_ids")).toEqual(finishedIds)
    } finally {
      await operator.close()
      await reader.close()
    }
  })
})
