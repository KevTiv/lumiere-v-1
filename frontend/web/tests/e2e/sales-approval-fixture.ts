import { expect, type Page } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { toCreateSaleOrderParams, toCreateSaleOrderLineParams } from "../../lib/sales-create-params"
import { callReducerBff, fetchDefaultCompanyId, fetchCurrencyIdByCode, fetchSessionOrganizationId, smokeName } from "./helpers"
import { create, location, rows, id, product as createProduct } from "./cov-scheduler-manufacturing-fixtures"
import { provisionActor } from "./pretenant-support"
import { bootstrapFixtureAccountSession } from "./fixture-account"
import { createStockQuantFixture } from "./inventory-quant-fixtures"

/** Setup-only fixtures: keep approval publication out of the shared demo company. */
export async function isolatedSalesApprovalFixture(page: Page) {
  const fixtureName = smokeName("approval-tenant")
  await bootstrapFixtureAccountSession(page.request, `${fixtureName}@example.test`, "Password123$")
  const bootstrap = await page.request.post("/api/bootstrap/tenant", { data: {
    organization: { name: fixtureName, code: fixtureName, timezone: "UTC", dateFormat: "YYYY-MM-DD", language: "en", isActive: true,
      description: null, logoUrl: null, website: null, email: null, phone: null, currencyId: null, metadata: null },
    defaultCompanyName: fixtureName, defaultCompanyCode: fixtureName,
    defaultCompanyCurrencyId: 0, defaultCompanyCurrencyCode: "USD", fiscalYearEndMonth: 12, fiscalYearEndDay: 31,
    seedFormConfigs: true, settings: { moduleConfig: null, featureFlags: [], integrationKeys: null, metadata: null },
  } })
  expect(bootstrap.ok(), await bootstrap.text()).toBe(true)
  const organizationId = await fetchSessionOrganizationId(page)
  const currencyId = await fetchCurrencyIdByCode(page, "USD")
  const companyId = await fetchDefaultCompanyId(page)
  // Graph reducers are trusted-fixture-only. Give the local fixture service an
  // explicit, tenant-scoped workflow author membership; do not bypass policy.
  const fixtureToken = process.env.STDB_SERVER_TOKEN
  if (!fixtureToken) throw new Error("Workflow graph fixture requires the local database owner token")
  const ownerClaims = JSON.parse(Buffer.from(fixtureToken.split(".")[1]!, "base64url").toString("utf8")) as { hex_identity?: string }
  const ownerIdentity = String(ownerClaims.hex_identity ?? "").replace(/^0x/, "")
  expect(ownerIdentity).toMatch(/^[0-9a-f]{64}$/i)
  const graphRoleName = smokeName("fixture-graph-author")
  await callReducerBff(page, "create_role", [organizationId, {
    name: graphRoleName, description: "Isolated workflow fixture setup", parent_id: null,
    permissions: ["workflow:write"], is_active: true, metadata: null,
  }])
  await callReducerBff(page, "add_org_member", [ownerIdentity, organizationId, {
    role_name: graphRoleName, company_id: companyId, job_title: null, department_id: null,
    employee_id: null, is_active: true, is_default: false, metadata: null,
  }])
  await callReducerBff(page, "create_uom_category", [organizationId, stdbParamsToJson({ name: fixtureName, sequence: 1 }, "CreateUomCategoryParams")])
  // UOM categories have no governed query resource. This setup-only observer
  // reads the new tenant's exact category; owner credentials stay in Node.
  const categoryResponse = await fetch(`${process.env.STDB_HOST}/v1/database/${process.env.STDB_MODULE}/sql`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.STDB_SERVER_TOKEN}`, "Content-Type": "text/plain" },
    body: `SELECT id FROM uom_cat WHERE organization_id = ${organizationId}`,
  })
  expect(categoryResponse.ok).toBe(true)
  const categorySets = await categoryResponse.json() as Array<{ rows: unknown[][] }>
  expect(categorySets[0]?.rows).toHaveLength(1)
  const categoryId = Number(categorySets[0]!.rows[0]![0])
  expect(Number.isSafeInteger(categoryId) && categoryId > 0).toBe(true)
  await callReducerBff(page, "create_uom", [organizationId, stdbParamsToJson({
    categoryId, name: "Unit", symbol: "ea", factor: 1, rounding: 1, timesBigger: 1, isReferenceUnit: true, isActive: true,
  }, "CreateUomParams")])
  await callReducerBff(page, "create_product_category", [organizationId, stdbParamsToJson({ name: fixtureName, sequence: 1 }, "CreateProductCategoryParams")])
  const source = await location(page, companyId)
  await location(page, companyId, false, "customer")
  // Picking type ids are warehouse configuration values, not table FKs.
  const typeId = 1
  const warehouseName = smokeName("approval-warehouse")
  await callReducerBff(page, "create_warehouse", [organizationId, companyId, stdbParamsToJson({
    name: warehouseName, code: warehouseName, lotStockId: id(source),
    inTypeId: typeId, outTypeId: typeId, intTypeId: typeId, packTypeId: typeId, pickTypeId: typeId,
    receptionSteps: "one_step", deliverySteps: "ship_only", manufactureSteps: "mrp_one_step",
    active: true, crossdock: false, buyToResupply: false, manufactureToResupply: false,
    resupplySubcontractorOnOrder: false, subcontractingToResupply: false, sequence: 10,
    resupplyWhIds: [], resupplyFromIds: [], pbhDpmIds: [],
  }, "CreateWarehouseParams")])
  const warehouseResponse = await page.request.get(`/api/query/warehouses?companyId=${companyId}`)
  expect(warehouseResponse.ok()).toBe(true)
  const warehouses = (await warehouseResponse.json()).data as Array<Record<string, unknown>>
  const warehouse = warehouses.filter(row => row.name === warehouseName)
  expect(warehouse).toHaveLength(1)
  const pricelistName = smokeName("approval-pricelist")
  await callReducerBff(page, "create_pricelist", [organizationId, stdbParamsToJson({
    companyId, name: pricelistName, currencyId, discountPolicy: { tag: "WithoutDiscount" },
  }, "CreatePricelistParams")])
  const pricelistResponse = await page.request.get(`/api/query/pricelists?companyId=${companyId}`)
  expect(pricelistResponse.ok()).toBe(true)
  const pricelists = (await pricelistResponse.json()).data as Array<Record<string, unknown>>
  const pricelist = pricelists.filter(row => row.name === pricelistName)
  expect(pricelist).toHaveLength(1)
  const customerName = smokeName("approval-customer")
  await callReducerBff(page, "create_contact", [organizationId, {
    name: customerName, type: "person", companyId, isCustomer: true, isVendor: false,
    isEmployee: false, isProspect: false, isPartner: false, customerRank: 1, supplierRank: 0,
  }])
  const contactResponse = await page.request.get(`/api/query/contacts?companyId=${companyId}`)
  expect(contactResponse.ok()).toBe(true)
  const customers = ((await contactResponse.json()).data as Array<Record<string, unknown>>).filter(row => row.name === customerName)
  expect(customers).toHaveLength(1)
  const customer = customers[0]
  const product = await createProduct(page)
  if (!customer || !product) throw new Error("Missing sales reference fixtures")
  await createStockQuantFixture(page, companyId, id(product), id(source), fixtureName, 10)
  const reference = smokeName("isolated-sales-approval")
  const params = toCreateSaleOrderParams({
    partnerId: id(customer), pricelistId: id(pricelist[0]!), warehouseId: id(warehouse[0]!), clientOrderRef: reference,
  }, pricelists, BigInt(companyId))
  const line = toCreateSaleOrderLineParams({ productId: id(product), uomId: id(product, "uomId", "uom_id"), quantity: 1, priceUnit: 1200 })
  if (!params || !line) throw new Error("Invalid isolated sales fixture")
  const order = await create(page, "sale-orders", "create_sale_order", { params: stdbParamsToJson({ ...params, orderLines: [line] }, "CreateSaleOrderParams") },
    row => row.clientOrderRef === reference,
    async () => {
      const response = await page.request.get(`/api/query/sale-orders?companyId=${companyId}`)
      expect(response.ok()).toBe(true)
      return (await response.json()).data
    })
  const requester = await provisionActor(page, "sales-approval", ["sale_order:*", "workflow:read", "workflow_human_task:read"], companyId)
  return { organizationId, companyId, orderId: id(order), requester }
}
