import { expect, type Page } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { stdbBffCommandPost, type StdbBffNamedReducerKey, type StdbBffCommandInput } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { toCreateBomParams, toCreateMrpProductionParams } from "@lumiere/erp-shared/manufacturing-create-params"
import { fetchCurrencyIdByCode, fetchDefaultCompanyId, fetchFirstUomId, fetchFirstWarehouseId, fetchSessionOrganizationId, gotoModule, scalarQueryId, smokeName, submitForm } from "./helpers"

export type Row = Record<string, unknown>
export const password = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
export const value = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake]
export function id(row: Row, camel = "id", snake = camel): number {
  const result = scalarQueryId(value(row, camel, snake))
  if (result == null || !Number.isSafeInteger(result) || result <= 0) throw new Error(`Missing exact ${camel} identity`)
  return result
}
export function tag(raw: unknown): string {
  return typeof raw === "object" && raw !== null && "tag" in raw
    ? String((raw as { tag: unknown }).tag) : String(raw)
}
export async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} canonical query`).toBe(true)
  const body = await response.json()
  if (!Array.isArray(body.data)) throw new Error(`${resource} has no canonical row array`)
  return body.data
}
export async function command<K extends StdbBffNamedReducerKey>(page: Page, operation: K, input: StdbBffCommandInput<K>) {
  const { urlPath, init } = stdbBffCommandPost(operation, input)
  expect(urlPath).toContain("/operations/")
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}
export async function exact(page: Page, resource: string, recordId: number): Promise<Row> {
  const matches = (await rows(page, resource)).filter(row => id(row) === recordId)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

// Setup only: exact accepted persisted keys/source FKs, never resource-wide ID deltas.
// Unrelated parallel creates do not participate in fixture readback.
export async function create<K extends StdbBffNamedReducerKey>(page: Page, resource: string, operation: K, input: StdbBffCommandInput<K>, matchesFixture: (row: Row) => boolean, observe: () => Promise<Row[]> = () => rows(page, resource)): Promise<Row> {
  expect((await observe()).filter(matchesFixture), `${resource} fixture key must be unused`).toHaveLength(0)
  expect((await command(page, operation, input)).ok()).toBe(true)
  let created: Row | undefined
  await expect.poll(async () => {
    const matches = (await observe()).filter(matchesFixture)
    if (matches.length > 1) throw new Error(`Ambiguous fixture creation for ${resource}`)
    created = matches[0]
    return matches.length
  }, { timeout: 30_000 }).toBe(1)
  return created!
}
export async function product(page: Page): Promise<Row> {
  const uomId = await fetchFirstUomId(page)
  const category = (await rows(page, "product-categories"))[0]
  const currencyId = await fetchCurrencyIdByCode(page, "USD")
  if (!category) throw new Error("Required product fixture lookup missing")
  const fixtureCode = `cov-product-${randomUUID()}`
  return create(page, "products", "create_product", {
    params: stdbParamsToJson({
      name: smokeName("cov-product"), defaultCode: fixtureCode, categId: id(category), type: "storable",
      uomId, uomPoId: uomId, standardPrice: 10, listPrice: 20,
      currencyId, tracking: "none",
    }, "CreateProductParams"),
  }, row => value(row, "defaultCode", "default_code") === fixtureCode &&
    id(row, "organizationId", "organization_id") === id(category, "organizationId", "organization_id"))
}
export async function location(page: Page, companyId: number, scrapLocation = false): Promise<Row> {
  const fixtureBarcode = `cov-location-${randomUUID()}`
  const organizationId = await fetchSessionOrganizationId(page)
  // Supplemental setup observer only: barcode is persisted but omitted by the BFF projection.
  // Owner credentials stay in the Node test runner, never in the browser context.
  const observe = async (): Promise<Row[]> => {
    if (!/^cov-location-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fixtureBarcode) ||
      !Number.isSafeInteger(companyId) || companyId <= 0 ||
      !Number.isSafeInteger(organizationId) || organizationId <= 0) {
      throw new Error("Invalid exact location fixture key")
    }
    const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
    const moduleName = process.env.STDB_MODULE?.trim()
    const token = process.env.STDB_SERVER_TOKEN?.trim()
    if (!moduleName || !token) throw new Error("Location fixture observer requires STDB_MODULE and STDB_SERVER_TOKEN")
    const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      // STDB SQL cannot compare optional barcode/company columns with bare literals.
      // Read only the owning org, then match the exact company and persisted UUID.
      body: `SELECT id, organization_id, company_id, barcode FROM stock_location WHERE organization_id = ${organizationId}`,
    })
    if (!response.ok) throw new Error(`Location fixture observer failed (${response.status})`)
    const sets = await response.json() as Array<{
      schema?: { elements?: Array<{ name?: { some?: string } }> }
      rows?: unknown[][]
    }>
    const elements = sets[0]?.schema?.elements
    const resultRows = sets[0]?.rows
    if (sets.length !== 1 || !elements || !resultRows) throw new Error("Invalid location fixture SQL result")
    const names = elements.map(element => {
      if (!element.name?.some) throw new Error("Location fixture column has no name")
      return element.name.some
    })
    return resultRows.map(cells => {
      if (cells.length !== names.length) throw new Error("Invalid location fixture row width")
      return Object.fromEntries(names.map((name, index) => {
        const raw = cells[index]
        const decoded = Array.isArray(raw)
          ? raw[0] === 0 ? raw[1] : undefined
          : raw && typeof raw === "object" && "some" in raw ? raw.some : raw
        return [name, decoded]
      }))
    }).filter(row => {
      return row.barcode === fixtureBarcode && scalarQueryId(row.company_id) === companyId
    })
  }
  return create(page, "stock-locations", "create_company_stock_location", {
    companyId,
    params: stdbParamsToJson({
      name: smokeName("cov-location"), usage: "internal", locationCategory: "internal",
      parentPath: "/", childLeft: 0, childRight: 1, scrapLocation, returnLocation: false,
      active: true, posx: 0, posy: 0, posz: 0, cyclicInventoryFrequency: 0,
      locationId: null, completeName: null, valuationInAccountId: null,
      valuationOutAccountId: null, comment: null, barcode: fixtureBarcode, lastInventoryDate: null,
      nextInventoryDate: null, metadata: null,
    }, "CreateStockLocationParams"),
  }, row => id(row, "companyId", "company_id") === companyId &&
    id(row, "organizationId", "organization_id") === organizationId, observe)
}
export async function manufacturingFixture(page: Page) {
  const companyId = await fetchDefaultCompanyId(page)
  const warehouseId = await fetchFirstWarehouseId(page)
  const primary = await product(page)
  const source = await location(page, companyId)
  const destination = await location(page, companyId)
  const picking = (await rows(page, "stock-pickings")).find(row =>
    scalarQueryId(value(row, "pickingTypeId", "picking_type_id")) != null)
  if (!picking) throw new Error("Required picking type fixture lookup missing")
  const scope = {
    warehouseId, pickingTypeId: id(picking, "pickingTypeId", "picking_type_id"),
    locationSrcId: id(source), locationDestId: id(destination),
  }
  const context = { companyId: BigInt(companyId), productUomId: BigInt(id(primary, "uomId", "uom_id")) }
  const bomParams = toCreateBomParams({
    ...scope, productTmplId: id(primary), productQty: 1, type: "Manufacture",
    readyToProduce: "all_available", consumption: "flexible", sequence: 10, bomLines: "[]",
  }, context)
  if (!bomParams) throw new Error("Invalid bounded BOM fixture")
  const bom = await create(page, "mrp-boms", "create_bom", { params: stdbParamsToJson(bomParams, "CreateBomParams") },
    row => id(row, "productTmplId", "product_tmpl_id") === id(primary) &&
      id(row, "companyId", "company_id") === companyId &&
      id(row, "organizationId", "organization_id") === id(primary, "organizationId", "organization_id"))
  const moParams = toCreateMrpProductionParams({
    ...scope, productId: id(primary), productQty: 2, bomId: id(bom),
    datePlannedStart: "2030-01-01", datePlannedFinished: "2030-01-02", consumption: "flexible",
  }, context)
  if (!moParams) throw new Error("Invalid bounded MO fixture")
  const mo = await create(page, "mrp-productions", "create_manufacturing_order", {
    params: stdbParamsToJson(moParams, "CreateMrpProductionParams"),
  }, row => scalarQueryId(value(row, "bomId", "bom_id")) === id(bom) &&
    id(row, "productId", "product_id") === id(primary) &&
    id(row, "companyId", "company_id") === companyId &&
    id(row, "organizationId", "organization_id") === id(primary, "organizationId", "organization_id"))
  return { companyId, primary, source, destination, bom, mo }
}
export async function prepareOutput(page: Page, companyId: number, moId: number) {
  for (const operation of ["confirm_manufacturing_order", "start_manufacturing_order", "produce_manufacturing_order"] as const) {
    const response = await command(page, operation, { companyId, moId, ...(operation === "produce_manufacturing_order" ? { qtyProducing: 2 } : {}) })
    expect(response.ok(), operation).toBe(true)
  }
  await expect.poll(async () => tag((await exact(page, "mrp-productions", moId)).state)).toBe("ToClose")
}
export async function openRow(page: Page, tab: "orders" | "boms", recordId: number) {
  await gotoModule(page, `/manufacturing?tab=${tab}&filter=id:${recordId}`, "manufacturing")
  await expect(page.getByTestId(`module-tab-manufacturing-${tab}`)).toHaveAttribute("aria-selected", "true")
  const panel = page.locator('[role="tabpanel"]:visible')
  await panel.getByTestId(`entity-row-${recordId}`).click()
  const formId = `manufacturing-${tab === "orders" ? "order" : "bom"}-row-${recordId}`
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
  return formId
}
export async function finishViaUi(page: Page, moId: number) {
  const formId = await openRow(page, "orders", moId)
  await page.getByTestId("form-field-moAction-finish").click()
  await submitForm(page, formId)
}
export async function quantQuantity(page: Page, companyId: number, productId: number, locationId: number): Promise<number> {
  const matches = (await rows(page, "stock-quants")).filter(row =>
    id(row, "companyId", "company_id") === companyId &&
    id(row, "productId", "product_id") === productId &&
    id(row, "locationId", "location_id") === locationId)
  if (matches.length > 1) throw new Error("Ambiguous exact fixture quant")
  return matches.length === 0 ? 0 : Number(matches[0]!.quantity)
}
