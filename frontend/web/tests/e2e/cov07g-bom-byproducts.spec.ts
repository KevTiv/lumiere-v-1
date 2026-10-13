import { expect, test } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { chooseSelectOptionByLabel, signIn, submitForm } from "./helpers"
import { command, exact, finishViaUi, id, manufacturingFixture, openRow, password, prepareOutput, product, quantQuantity, rows, tag, value } from "./cov-scheduler-manufacturing-fixtures"
import { canonicalRow } from "./sod-evidence"

test.describe("COV-07g operator BOM byproduct definition and output", {
  tag: ["@p0", "@cov07", "@cov07g", "@unauthenticated"],
}, () => {
  test("warehouse authors one exact byproduct and finishes its scaled MO output through UI", async ({ page, browser }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const { companyId, primary, destination, bom, mo } = await manufacturingFixture(page)
    const byproduct = await product(page)
    const bomId = id(bom)
    const moId = id(mo)
    const uomId = id(byproduct, "uomId", "uom_id")
    const uom = await exact(page, "uoms", uomId)
    const definitions = async () => (await rows(page, "mrp-bom-byproducts")).filter(row =>
      id(row, "bomId", "bom_id") === bomId && id(row, "productId", "product_id") === id(byproduct) &&
      id(row, "companyId", "company_id") === companyId &&
      id(row, "organizationId", "organization_id") === id(bom, "organizationId", "organization_id"))
    expect(await definitions()).toHaveLength(0)
    const operator = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const warehousePage = await operator.newPage()
      await signIn(warehousePage, "fixture.warehouse@example.test", password)
      const formId = await openRow(warehousePage, "boms", bomId)
      await warehousePage.getByTestId("form-field-bomAction-add_byproduct").click()
      await chooseSelectOptionByLabel(warehousePage, "byproductProductId", String(byproduct.name))
      // UOM is a scalar field in the accepted row form, not a lookup-select.
      await warehousePage.getByTestId("form-field-byproductUomId").fill(String(id(uom)))
      await warehousePage.getByTestId("form-field-byproductQuantity").fill("0.5")
      await warehousePage.getByTestId("form-field-byproductCostShare").fill("20")
      await submitForm(warehousePage, formId)
      await expect.poll(async () => (await definitions()).length, { timeout: 30_000 }).toBe(1)
      const definition = (await definitions())[0]!
      expect(Number(value(definition, "productQty", "product_qty"))).toBe(0.5)
      expect(Number(value(definition, "costShare", "cost_share"))).toBe(20)
      // Supplemental owner graph read: this parent array is omitted by the operator projection.
      const owned = value(await canonicalRow(page, "mrp-boms", bomId), "byproductIds", "byproduct_ids")
      expect(Array.isArray(owned)).toBe(true)
      expect((owned as unknown[]).map(String)).toEqual([String(id(definition))])
      await expect(warehousePage.getByTestId(`form-modal-${formId}`)).not.toBeVisible()

      const input = { bomId, params: stdbParamsToJson({
        productId: id(byproduct), productUomId: uomId, productQty: 0.5, costShare: 20, sequence: 10,
        metadata: { none: [] },
      }, "CreateBomByproductParams") }
      expect((await command(warehousePage, "create_bom_byproduct", input)).status()).toBe(422)
      const readerPage = await reader.newPage()
      await signIn(readerPage, "fixture.reader@example.test", password)
      expect((await command(readerPage, "create_bom_byproduct", input)).status()).toBe(403)
      expect((await definitions()).map(row => id(row))).toEqual([id(definition)])

      await prepareOutput(page, companyId, moId)
      const before = await quantQuantity(page, companyId, id(byproduct), id(destination))
      await finishViaUi(warehousePage, moId)
      await expect.poll(async () => tag((await exact(page, "mrp-productions", moId)).state), { timeout: 30_000 }).toBe("Done")
      const finishedMo = await exact(page, "mrp-productions", moId)
      const ownedMoves = value(finishedMo, "moveFinishedIds", "move_finished_ids")
      expect(Array.isArray(ownedMoves)).toBe(true)
      expect(ownedMoves).toHaveLength(2)
      const moves = await Promise.all((ownedMoves as unknown[]).map(moveId => exact(page, "stock-moves", Number(moveId))))
      for (const move of moves) {
        expect(id(move, "productionId", "production_id")).toBe(moId)
        expect(id(move, "companyId", "company_id")).toBe(companyId)
        expect(id(move, "organizationId", "organization_id")).toBe(id(mo, "organizationId", "organization_id"))
      }
      expect(moves.map(row => id(row, "productId", "product_id")).sort((a, b) => a - b)).toEqual([id(primary), id(byproduct)].sort((a, b) => a - b))
      const output = moves.filter(row => id(row, "productId", "product_id") === id(byproduct))
      expect(output).toHaveLength(1)
      expect(id(output[0]!, "productionId", "production_id")).toBe(moId)
      expect(id(output[0]!, "locationDestId", "location_dest_id")).toBe(id(destination))
      expect(tag(output[0]!.state).toLowerCase()).toBe("done")
      expect(output[0]!.reference).toBe(`MO/${moId}/BYPRODUCT/${id(definition)}`)
      expect(Number(value(output[0]!, "productUomQty", "product_uom_qty"))).toBe(1)
      const persistedOutput = await canonicalRow(page, "stock-moves", id(output[0]!))
      expect(Number(value(persistedOutput, "costShare", "cost_share"))).toBe(20)
      await expect.poll(async () => quantQuantity(page, companyId, id(byproduct), id(destination))).toBe(before + 1)
      const replay = await command(warehousePage, "finish_manufacturing_order", { companyId, moId })
      expect(replay.status()).toBe(422)
      expect(value(await exact(page, "mrp-productions", moId), "moveFinishedIds", "move_finished_ids")).toEqual(ownedMoves)
      expect(await quantQuantity(page, companyId, id(byproduct), id(destination))).toBe(before + 1)
    } finally {
      await operator.close()
      await reader.close()
    }
  })
})
