import { matchesTypedOperationResponse } from "./operation-response"
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  chooseFirstOption,
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fetchDefaultCompanyId,
  fetchFirstUomId,
  fetchFirstWarehouseId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"

function stdbTimestampMicros(isoDate: string): { __timestamp_micros_since_unix_epoch__: number } {
  const micros = BigInt(new Date(isoDate).getTime()) * 1000n
  return { __timestamp_micros_since_unix_epoch__: Number(micros) }
}

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

function moStateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: string }).tag ?? "")
  }
  return String(value)
}

async function fetchFirstProductId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/products")
  if (!res.ok()) throw new Error(`products query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
  const id = scalarQueryId(json.data?.[0]?.id)
  if (id == null) throw new Error("no products in seed data")
  return id
}

async function fetchFirstStockPicking(page: Page): Promise<{
  pickingTypeId: number
  locationSrcId: number
  locationDestId: number
}> {
  const res = await page.request.get("/api/query/stock-pickings")
  if (!res.ok()) throw new Error(`stock-pickings query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ pickingTypeId?: unknown; locationId?: unknown; locationDestId?: unknown }>
  }
  const row = (json.data ?? []).find(
    (r) => scalarQueryId(r.pickingTypeId) != null && scalarQueryId(r.locationId) != null,
  )
  const pickingTypeId = scalarQueryId(row?.pickingTypeId)
  const locationSrcId = scalarQueryId(row?.locationId)
  const locationDestId = scalarQueryId(row?.locationDestId ?? row?.locationId)
  if (pickingTypeId == null || locationSrcId == null || locationDestId == null) {
    throw new Error("no stock picking with picking type and locations in seed data")
  }
  return { pickingTypeId, locationSrcId, locationDestId }
}

async function fetchLatestMoIdByProduct(page: Page, productId: number): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/mrp-productions")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; productId?: unknown; product_id?: unknown }>
      }
      const matches = (json.data ?? []).filter(
        (r) => scalarQueryId(r.productId ?? r.product_id) === productId,
      )
      const newest = [...matches].sort(
        (a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0),
      )[0]
      const id = scalarQueryId(newest?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`no manufacturing order found for product ${productId}`)
}

async function fetchMoState(page: Page, moId: number): Promise<string> {
  const res = await page.request.get("/api/query/mrp-productions")
  if (!res.ok()) return ""
  const json = (await res.json()) as { data?: Array<{ id?: unknown; state?: unknown }> }
  const row = (json.data ?? []).find((r) => scalarQueryId(r.id) === moId)
  return moStateTag(row?.state)
}

test.describe("Manufacturing create mutations", { tag: ["@phase-4", "@manufacturing"] }, () => {
  test("creates a work center via create_workcenter reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const workcenterName = smokeName("mut-workcenter")

    await openEntityCreate(page, "/manufacturing", "manufacturing", "workcenters", "new-workcenter")
    await fillField(page, "name", workcenterName)

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_workcenter") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-workcenter"),
    ])
    expect(createRes.ok()).toBe(true)
    await expect(page.getByText(workcenterName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("creates a BOM via create_bom reducer", async ({ page }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/manufacturing", "manufacturing")
    await page.getByTestId("module-tab-manufacturing-boms").click()
    await waitForBffQueryMinRows(page, "/api/query/products")

    await page.getByTestId("module-create-manufacturing-boms").click()
    await expect(page.getByTestId("form-modal-new-bom")).toBeVisible()
    await chooseFirstOption(page, "productTmplId")
    await fillField(page, "productQty", "1")
    await chooseFirstOption(page, "type")

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_bom") && res.ok(),
        { timeout: 60_000 },
      ),
      submitForm(page, "new-bom"),
    ])
    expect(createRes.ok()).toBe(true)
    await waitForBffQueryMinRows(page, "/api/query/mrp-boms")
    await expectNoAppError(page)
  })

  test("creates a manufacturing order via create_manufacturing_order reducer", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    await gotoModule(page, "/manufacturing", "manufacturing")
    await page.getByTestId("module-tab-manufacturing-orders").click()
    await waitForBffQueryMinRows(page, "/api/query/products")
    await waitForBffQueryMinRows(page, "/api/query/warehouses")

    await page.getByTestId("module-create-manufacturing-orders").click()
    await expect(page.getByTestId("form-modal-new-manufacturing-order")).toBeVisible()
    await chooseFirstOption(page, "productId")
    await fillField(page, "productQty", "1")
    await chooseFirstOption(page, "warehouseId")

    const pickingField = page.getByTestId("form-field-pickingTypeId")
    await pickingField.click()
    const pickingOptions = page.locator('[role="listbox"]:visible').getByRole("option", {
      disabled: false,
    })
    const pickingCount = await pickingOptions.count()
    test.skip(pickingCount === 0, "No stock picking types in seed for MO create")

    await pickingOptions.first().click()
    await chooseFirstOption(page, "locationSrcId")
    await chooseFirstOption(page, "locationDestId")

    const today = new Date().toISOString().slice(0, 10)
    await fillField(page, "datePlannedStart", today)
    await fillField(page, "datePlannedFinished", today)

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_manufacturing_order") && res.ok(),
        { timeout: 60_000 },
      ),
      submitForm(page, "new-manufacturing-order"),
    ])
    expect(createRes.ok()).toBe(true)
    await waitForBffQueryMinRows(page, "/api/query/mrp-productions")
    await expectNoAppError(page)
  })
})

test.describe("Manufacturing mutation visibility", { tag: ["@phase-4", "@manufacturing"] }, () => {
  test("created work center appears in mrp-workcenters query", async ({ page }) => {
    test.setTimeout(120_000)

    const workcenterName = smokeName("mut-wc-query")

    await openEntityCreate(page, "/manufacturing", "manufacturing", "workcenters", "new-workcenter")
    await fillField(page, "name", workcenterName)
    await submitForm(page, "new-workcenter")
    await expect(page.getByText(workcenterName).first()).toBeVisible({ timeout: 30_000 })

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/mrp-workcenters")
          if (!res.ok()) return false
          const json = (await res.json()) as { data?: Array<{ name?: string }> }
          return (json.data ?? []).some((row) => String(row.name ?? "") === workcenterName)
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  })
})

test.describe(
  "MFG-009 manufacturing order produce and close lifecycle",
  { tag: ["@phase-4", "@manufacturing", "@p0"] },
  () => {
    test("creates, confirms, produces, and closes a manufacturing order via BFF reducers", async ({
      page,
    }) => {
      test.setTimeout(180_000)

      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const uomId = await fetchFirstUomId(page)
      const productId = await fetchFirstProductId(page)
      const picking = await fetchFirstStockPicking(page)

      const productQty = 1
      const planned = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const plannedTs = stdbTimestampMicros(planned)

      await callReducerBff(page, "create_manufacturing_order", [
        organizationId,
        {
          company_id: some(companyId),
          product_id: productId,
          product_qty: productQty,
          product_uom_id: uomId,
          date_planned_start: plannedTs,
          date_planned_finished: plannedTs,
          location_src_id: picking.locationSrcId,
          location_dest_id: picking.locationDestId,
          warehouse_id: warehouseId,
          picking_type_id: picking.pickingTypeId,
          consumption: none,
          bom_id: none,
          routing_id: none,
          proc_group_id: none,
          procurement_group_id: none,
          date_deadline: none,
          origin: some(smokeName("mfg009-origin")),
          responsible_user_id: none,
          metadata: none,
        },
      ])

      const moId = await fetchLatestMoIdByProduct(page, productId)

      await expect.poll(async () => fetchMoState(page, moId), { timeout: 30_000 }).toBe("Draft")

      await callReducerBff(page, "confirm_manufacturing_order", [
        organizationId,
        companyId,
        moId,
      ])
      await expect.poll(async () => fetchMoState(page, moId), { timeout: 30_000 }).toBe("Confirmed")

      await callReducerBff(page, "start_manufacturing_order", [
        organizationId,
        companyId,
        moId,
      ])
      await expect.poll(async () => fetchMoState(page, moId), { timeout: 30_000 }).toBe("Progress")

      await callReducerBff(page, "produce_manufacturing_order", [
        organizationId,
        companyId,
        moId,
        productQty,
      ])
      await expect.poll(async () => fetchMoState(page, moId), { timeout: 30_000 }).toBe("ToClose")

      await callReducerBff(page, "finish_manufacturing_order", [
        organizationId,
        companyId,
        moId,
      ])
      await expect.poll(async () => fetchMoState(page, moId), { timeout: 30_000 }).toBe("Done")

      await gotoModule(page, "/manufacturing", "manufacturing")
      await page.getByTestId("module-tab-manufacturing-orders").click()
      await waitForBffQueryMinRows(page, "/api/query/mrp-productions")
      await expectNoAppError(page)
    })
  },
)
