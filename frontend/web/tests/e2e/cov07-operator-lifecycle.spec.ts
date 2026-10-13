import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost, type StdbBffCommandInput } from "@lumiere/stdb/commands"
import { resolveManufacturingMaterialEffect } from "@lumiere/query-hooks/hooks/manufacturing-material-consumption"
import { resolveManufacturingFinishedEffect, type DestinationQuantSnapshot } from "@lumiere/query-hooks/hooks/manufacturing-production-close"
import { locationOptionsFromQuantsAndTransfers, productRowsToSelectOptions, warehouseRowsToSelectOptions } from "../../lib/form-lookup"
import { fetchDefaultCompanyId, fetchFirstWarehouseId, gotoModule, scalarQueryId, signIn, smokeName, submitForm } from "./helpers"
import { matchesOperationResponse } from "./operation-response"

type Row = Record<string, unknown>
const password = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const id = (value: unknown) => {
  const parsed = scalarQueryId(value)
  if (parsed == null) throw new Error(`Missing canonical ID: ${String(value)}`)
  return parsed
}
const tag = (value: unknown) => typeof value === "object" && value != null && "tag" in value
  ? String(value.tag) : String(value ?? "")
const absent = (value: unknown) => value == null || (typeof value === "object" && Object.keys(value).length === 1 && "none" in value)
const field = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake]
const ids = (value: unknown): number[] => Array.isArray(value) ? value.map(id) : []

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} readback`).toBe(true)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exact(page: Page, resource: string, recordId: number): Promise<Row> {
  const matches = (await rows(page, resource)).filter((row) => id(row.id) === recordId)
  expect(matches, `${resource}/${recordId} must resolve uniquely`).toHaveLength(1)
  return matches[0]!
}

async function select(page: Page, name: string, label: string) {
  await page.getByTestId(`form-field-${name}`).click()
  const option = page.locator('[role="listbox"]:visible').getByRole("option", { name: label, exact: true })
  await expect(option, `Unambiguous ${name} option`).toHaveCount(1)
  await option.click()
}

async function submit(page: Page, formId: string, operation: string) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, operation), { timeout: 60_000 }),
    submitForm(page, formId),
  ])
  expect(response.ok(), `${operation} accepted`).toBe(true)
  return response.request().postDataJSON() as Row
}

async function openRow(page: Page, tab: "orders" | "workorders", recordId: number, origin?: string) {
  await gotoModule(page, "/manufacturing", "manufacturing")
  await page.getByTestId(`module-tab-manufacturing-${tab}`).click()
  const panel = page.locator('[role="tabpanel"]:visible')
  if (origin) await panel.getByLabel("Search records").fill(origin)
  const row = panel.getByTestId(`entity-row-${recordId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
}

async function moAction(page: Page, moId: number, origin: string, action: string, operation: string, prepare?: () => Promise<void>) {
  await openRow(page, "orders", moId, origin)
  await page.getByTestId(`form-field-moAction-${action}`).click()
  await prepare?.()
  return submit(page, `manufacturing-order-row-${moId}`, operation)
}

async function woAction(page: Page, woId: number, action: string, operation: string) {
  await openRow(page, "workorders", woId)
  await page.getByTestId(`form-field-woAction-${action}`).click()
  await submit(page, `manufacturing-wo-row-${woId}`, operation)
}

async function command<K extends "consume_mo_materials" | "finish_manufacturing_order" | "finish_workorder" | "pass_quality_check">(page: Page, reducer: K, args: StdbBffCommandInput<K>) {
  const prepared = stdbBffCommandPost(reducer, args)
  return page.request.post(prepared.urlPath, { headers: { "Content-Type": "application/json" }, data: JSON.parse(String(prepared.init.body)) })
}

async function quantSnapshot(page: Page, companyId: number, productId: number, locationId: number): Promise<DestinationQuantSnapshot> {
  const matches = (await rows(page, "stock-quants")).filter((row) =>
    scalarQueryId(field(row, "companyId", "company_id")) === companyId &&
    scalarQueryId(field(row, "productId", "product_id")) === productId &&
    scalarQueryId(field(row, "locationId", "location_id")) === locationId &&
    absent(field(row, "lotId", "lot_id")) && absent(field(row, "packageId", "package_id")) && absent(field(row, "ownerId", "owner_id")),
  )
  expect(matches.length, "Unambiguous untracked stock quant").toBeLessThanOrEqual(1)
  return matches.length ? { id: BigInt(id(matches[0]!.id)), quantity: Number(matches[0]!.quantity) } : { quantity: 0 }
}

test.describe("COV-07i one operator-created manufacturing lifecycle", { tag: ["@p0", "@cov07", "@unauthenticated"] }, () => {
  test("warehouse operator creates BOM/components and MO, consumes, passes quality and closes exactly once", async ({ browser, page }) => {
    test.setTimeout(300_000)
    // Setup only reads seeded reference data; every positive domain mutation below is a visible operator action.
    await signIn(page)
    const companyId = await fetchDefaultCompanyId(page)
    const warehouseId = await fetchFirstWarehouseId(page)
    const [products, transfers, quants, warehouses, centers] = await Promise.all([
      rows(page, "products"), rows(page, "stock-pickings"), rows(page, "stock-quants"), rows(page, "warehouses"), rows(page, "mrp-workcenters"),
    ])
    const eligible = products.filter((product) =>
      !["lot", "serial"].includes(tag(product.tracking).toLowerCase()) &&
      String(product.type ?? product.type_).toLowerCase() !== "service" && product.isActive !== false && scalarQueryId(field(product, "uomId", "uom_id")) != null,
    )
    const picking = transfers.find((row) => scalarQueryId(field(row, "pickingTypeId", "picking_type_id")) != null &&
      scalarQueryId(field(row, "locationId", "location_id")) != null && scalarQueryId(field(row, "locationDestId", "location_dest_id")) != null &&
      quants.some((quant) => scalarQueryId(field(quant, "companyId", "company_id")) === companyId &&
        scalarQueryId(field(quant, "locationId", "location_id")) === scalarQueryId(field(row, "locationId", "location_id")) && Number(quant.quantity) >= 1 &&
        eligible.some((product) => id(product.id) === scalarQueryId(field(quant, "productId", "product_id"))) &&
        absent(field(quant, "lotId", "lot_id")) && absent(field(quant, "packageId", "package_id")) && absent(field(quant, "ownerId", "owner_id"))))
    if (!picking) throw new Error("Seed requires picking type and source/destination locations")
    const srcId = id(field(picking, "locationId", "location_id"))
    const destId = id(field(picking, "locationDestId", "location_dest_id"))
    const pickingTypeId = id(field(picking, "pickingTypeId", "picking_type_id"))
    const component = eligible.find((product) => quants.some((quant) => scalarQueryId(field(quant, "companyId", "company_id")) === companyId &&
      scalarQueryId(field(quant, "productId", "product_id")) === id(product.id) && scalarQueryId(field(quant, "locationId", "location_id")) === srcId &&
      Number(quant.quantity) >= 1 && absent(field(quant, "lotId", "lot_id")) && absent(field(quant, "packageId", "package_id")) && absent(field(quant, "ownerId", "owner_id"))))
    const product = eligible.find((candidate) => component && id(candidate.id) !== id(component.id))
    const center = centers.find((row) => scalarQueryId(field(row, "companyId", "company_id")) === companyId)
    if (!component || !product || !center) throw new Error("Seed requires two untracked products, available component stock and company workcenter")
    const productId = id(product.id)
    const componentId = id(component.id)
    const componentUomId = id(field(component, "uomId", "uom_id"))
    const centerId = id(center.id)
    const options = productRowsToSelectOptions(products)
    const productLabel = options.find((option) => option.value === String(productId))!.label
    const warehouseLabel = warehouseRowsToSelectOptions(warehouses).find((option) => option.value === String(warehouseId))!.label
    const locationOptions = locationOptionsFromQuantsAndTransfers(quants, transfers)
    const sourceBefore = await quantSnapshot(page, companyId, componentId, srcId)
    const destinationBefore = await quantSnapshot(page, companyId, productId, destId)
    const actor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const operator = await actor.newPage()
      const denied = await reader.newPage()
      await signIn(operator, "fixture.warehouse@example.test", password)
      await signIn(denied, "fixture.reader@example.test", password)
      const priorBoms = new Set((await rows(page, "mrp-boms")).map((row) => id(row.id)))
      await gotoModule(operator, "/manufacturing", "manufacturing")
      await operator.getByTestId("module-tab-manufacturing-boms").click()
      await operator.getByTestId("module-create-manufacturing-boms").click()
      await select(operator, "productTmplId", productLabel)
      await operator.getByTestId("form-field-productQty").fill("1")
      await select(operator, "type", "Manufacture")
      await operator.getByTestId("bom-component-add").click()
      await operator.getByTestId("bom-component-product-0").selectOption(String(componentId))
      await operator.getByTestId("bom-component-quantity-0").fill("1")
      await submit(operator, "new-bom", "create_bom")
      let bomId = 0
      await expect.poll(async () => {
        const matches = (await rows(page, "mrp-boms")).filter((row) => !priorBoms.has(id(row.id)) &&
          scalarQueryId(field(row, "companyId", "company_id")) === companyId && scalarQueryId(field(row, "productId", "product_id")) === productId)
        if (matches.length === 1) bomId = id(matches[0]!.id)
        return matches.length
      }).toBe(1)
      await expect.poll(async () => (await rows(page, "mrp-bom-lines")).filter((line) => scalarQueryId(field(line, "bomId", "bom_id")) === bomId).map((line) => ({
        productId: id(field(line, "productId", "product_id")), uomId: id(field(line, "productUomId", "product_uom_id")), quantity: Number(field(line, "productQty", "product_qty")),
      }))).toEqual([{ productId: componentId, uomId: componentUomId, quantity: 1 }])

      const origin = smokeName("cov07i-operator")
      await gotoModule(operator, "/manufacturing", "manufacturing")
      await operator.getByTestId("module-tab-manufacturing-orders").click()
      await operator.getByTestId("module-create-manufacturing-orders").click()
      await select(operator, "productId", productLabel)
      await operator.getByTestId("form-field-productQty").fill("1")
      await select(operator, "bomId", `BOM ${bomId} — product ${productId}`)
      await select(operator, "warehouseId", warehouseLabel)
      await select(operator, "pickingTypeId", `Type ${pickingTypeId}`)
      await select(operator, "locationSrcId", locationOptions.find((option) => option.value === String(srcId))!.label)
      await select(operator, "locationDestId", locationOptions.find((option) => option.value === String(destId))!.label)
      const planned = new Date(Date.now() + 86400_000).toISOString().slice(0, 10)
      await operator.getByTestId("form-field-datePlannedStart").fill(planned)
      await operator.getByTestId("form-field-datePlannedFinished").fill(planned)
      await operator.getByTestId("form-field-origin").fill(origin)
      await submit(operator, "new-manufacturing-order", "create_manufacturing_order")
      let moId = 0
      await expect.poll(async () => {
        const matches = (await rows(page, "mrp-productions")).filter((row) => row.origin === origin && scalarQueryId(field(row, "companyId", "company_id")) === companyId)
        if (matches.length === 1) moId = id(matches[0]!.id)
        return matches.length
      }).toBe(1)
      expect(id(field(await exact(page, "mrp-productions", moId), "bomId", "bom_id"))).toBe(bomId)
      await moAction(operator, moId, origin, "confirm", "confirm_manufacturing_order")
      await moAction(operator, moId, origin, "start", "start_manufacturing_order")
      await moAction(operator, moId, origin, "consume", "consume_mo_materials")
      const material = async () => resolveManufacturingMaterialEffect(await rows(page, "mrp-productions"), await rows(page, "mrp-bom-lines"), await rows(page, "stock-moves"), BigInt(moId), BigInt(companyId))
      await expect.poll(async () => (await material())?.stockMoveIds.length).toBe(1)
      const rawIds = [...(await material())!.stockMoveIds]
      await expect.poll(async () => (await quantSnapshot(page, companyId, componentId, srcId)).quantity).toBe(sourceBefore.quantity - 1)
      const consumeReplay = await command(operator, "consume_mo_materials", { companyId: BigInt(companyId), moId: BigInt(moId) })
      expect(consumeReplay.ok()).toBe(true) // Consumption replay is idempotent.
      expect((await material())?.stockMoveIds).toEqual(rawIds)

      await moAction(operator, moId, origin, "create_workorder", "create_workorder", async () => {
        await select(operator, "woWorkcenterId", String(center.name))
        await operator.getByTestId("form-field-woName").fill(`${origin}-quality`)
      })
      let woId = 0
      await expect.poll(async () => {
        const mo = await exact(page, "mrp-productions", moId)
        const owned = ids(field(mo, "workorderIds", "workorder_ids"))
        if (owned.length === 1) woId = owned[0]!
        return owned.length
      }).toBe(1)
      const wo = await exact(page, "mrp-workorders", woId)
      expect(id(field(wo, "productionId", "production_id"))).toBe(moId)
      expect(id(field(wo, "workcenterId", "workcenter_id"))).toBe(centerId)
      await woAction(operator, woId, "start", "start_workorder")
      await woAction(operator, woId, "require_quality", "create_workorder_quality_check")
      let checkId = 0
      await expect.poll(async () => {
        const checks = (await rows(page, "quality-checks")).filter((row) => scalarQueryId(field(row, "workorderId", "workorder_id")) === woId && scalarQueryId(field(row, "productionId", "production_id")) === moId)
        if (checks.length === 1) checkId = id(checks[0]!.id)
        return checks.length
      }).toBe(1)
      const prematureFinish = await command(operator, "finish_workorder", { companyId: BigInt(companyId), workorderId: BigInt(woId) })
      expect(prematureFinish.status()).toBe(422)
      const deniedQuality = await command(denied, "pass_quality_check", { companyId: BigInt(companyId), checkId: BigInt(checkId), measure: null, note: null, picture: null })
      expect(deniedQuality.status()).toBe(403)
      await moAction(operator, moId, origin, "produce", "produce_manufacturing_order", async () => {
        await operator.getByTestId("form-field-produceQty").fill("1")
      })
      expect(tag((await exact(page, "mrp-productions", moId)).state)).toBe("ToClose")
      const qualityBlockedClose = await command(operator, "finish_manufacturing_order", { companyId: BigInt(companyId), moId: BigInt(moId) })
      expect(qualityBlockedClose.status()).toBe(422)
      expect(tag((await exact(page, "mrp-productions", moId)).state)).toBe("ToClose")
      await woAction(operator, woId, "pass_quality", "pass_quality_check")
      await woAction(operator, woId, "finish", "finish_workorder")
      const deniedClose = await command(denied, "finish_manufacturing_order", { companyId: BigInt(companyId), moId: BigInt(moId) })
      expect(deniedClose.status()).toBe(403)
      const wrongScope = await command(operator, "finish_manufacturing_order", { companyId: 0n, moId: BigInt(moId) })
      expect([403, 422]).toContain(wrongScope.status())
      expect(tag((await exact(page, "mrp-productions", moId)).state)).toBe("ToClose")
      await moAction(operator, moId, origin, "finish", "finish_manufacturing_order")
      const finished = async () => resolveManufacturingFinishedEffect(await rows(page, "mrp-productions"), await rows(page, "stock-moves"), await rows(page, "stock-quants"), BigInt(moId), BigInt(companyId), destinationBefore)
      await expect.poll(async () => (await finished())?.id).toBe(String(moId))
      const finishEffect = await finished()
      const staleClose = await command(operator, "finish_manufacturing_order", { companyId: BigInt(companyId), moId: BigInt(moId) })
      expect(staleClose.status()).toBe(422)
      expect(await finished()).toEqual(finishEffect)
      expect((await quantSnapshot(page, companyId, componentId, srcId)).quantity).toBe(sourceBefore.quantity - 1)
      expect(tag((await exact(page, "mrp-workorders", woId)).state)).toBe("Done")
      expect(tag(field(await exact(page, "quality-checks", checkId), "qualityState", "quality_state")).toLowerCase()).toBe("pass")
      // Full reload proves durable canonical projections, with the same MO/BOM/workorder/check identities.
      await operator.reload()
      await openRow(operator, "orders", moId, origin)
      await expect(operator.getByTestId(`form-modal-manufacturing-order-row-${moId}`)).toBeVisible()
      expect(await finished()).toEqual(finishEffect)
      await test.info().attach("cov07i-lifecycle-identities", { contentType: "application/json", body: JSON.stringify({ companyId, bomId, moId, woId, checkId, componentId, componentUomId, rawIds, finishEffect }, null, 2) })
    } finally {
      await actor.close()
      await reader.close()
    }
  })
})
