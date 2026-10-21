import { expect, test } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { toCreateWorkcenterParams } from "@lumiere/erp-shared/manufacturing-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { gotoModule, signIn, submitForm } from "./helpers"
import { create, finishViaUi, id, manufacturingFixture, prepareOutput, rows, value } from "./cov-scheduler-manufacturing-fixtures"
import { expectExactRecordFocus } from "./cov25-link-navigation"
import { manufacturingCostAmount } from "../../lib/manufacturing-cost-record"

test.describe("COV-07 actual-cost operator surfaces", { tag: ["@p0", "@cov07", "@cov07costs", "@unauthenticated"] }, () => {
  test("operator configures an explicit workcenter hourly rate through the row action", async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const { companyId } = await manufacturingFixture(page)
    const name = `cov-cost-workcenter-${randomUUID()}`
    const params = toCreateWorkcenterParams({ name, active: true }, BigInt(companyId))
    if (!params) throw new Error("Invalid workcenter fixture")
    const workcenter = await create(page, "mrp-workcenters", "create_workcenter", { params: stdbParamsToJson(params, "CreateWorkcenterParams") }, row => row.name === name && id(row, "companyId", "company_id") === companyId)
    await gotoModule(page, `/manufacturing?tab=workcenters&filter=id:${id(workcenter)}`, "manufacturing")
    await page.getByTestId(`entity-row-${id(workcenter)}`).click()
    const formId = `manufacturing-wc-row-${id(workcenter)}`
    await page.getByTestId("form-field-wcAction-configure_cost_rate").click()
    await page.getByTestId("form-field-wcHourlyRate").fill("42.5")
    await submitForm(page, formId)
    const rates = async () => (await rows(page, "mrp-workcenter-cost-rates")).filter(row => id(row, "workcenterId", "workcenter_id") === id(workcenter) && id(row, "companyId", "company_id") === companyId)
    await expect.poll(async () => (await rates()).length).toBe(1)
    expect(value((await rates())[0]!, "hourlyRate", "hourly_rate")).toBe(42.5)
    await expect(page.getByTestId(`form-modal-${formId}`)).not.toBeVisible()
    await gotoModule(page, "/manufacturing?tab=cost-settings", "manufacturing")
    await expect(page.getByTestId(`entity-row-${id(workcenter)}`)).toContainText("42.5")
  })

  test("closed order shows exact immutable costs and output record links after reload", async ({ page }) => {
    test.setTimeout(180_000)
    await signIn(page)
    const { companyId, mo } = await manufacturingFixture(page)
    const moId = id(mo)
    await prepareOutput(page, companyId, moId)
    await finishViaUi(page, moId)
    const costs = async () => (await rows(page, "mrp-production-costs")).filter(row => id(row, "productionId", "production_id") === moId && id(row, "companyId", "company_id") === companyId)
    await expect.poll(async () => (await costs()).length, { timeout: 30_000 }).toBe(1)
    const snapshot = (await costs())[0]!
    await page.goto(`/manufacturing/orders/${moId}`)
    const panel = page.getByTestId("manufacturing-order-costs")
    await expect(panel).toBeVisible()
    for (const [camel, snake] of [["materialValue", "material_value"], ["workcenterValue", "workcenter_value"], ["totalValue", "total_value"], ["inventoryValue", "inventory_value"], ["varianceValue", "variance_value"]]) {
      await expect(panel.getByTestId(`manufacturing-cost-${camel}`)).toHaveText(manufacturingCostAmount(value(snapshot, camel!, snake!)))
    }
    const outputs = value(snapshot, "outputMoveIds", "output_move_ids") as unknown[]
    expect(outputs.length).toBeGreaterThan(0)
    for (const output of outputs) await expect(panel.getByTestId(`manufacturing-cost-output-${String(output)}`)).toHaveAttribute("href", `/inventory?tab=stock-moves&filter=id%3A${String(output)}`)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(panel.getByTestId("manufacturing-cost-totalValue")).toHaveText(manufacturingCostAmount(value(snapshot, "totalValue", "total_value")))
    await panel.getByTestId(`manufacturing-cost-output-${String(outputs[0])}`).click()
    await expectExactRecordFocus(page, { module: "inventory", tab: "stock-moves", id: Number(outputs[0]) })
  })
})
