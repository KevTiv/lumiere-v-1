import { expect, test, type Page } from "@playwright/test"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { CreateMrpProductionParams } from "@lumiere/stdb/types"

import {
  chooseFirstOption,
  fetchDefaultCompanyId,
  fetchFirstWarehouseId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type BomRow = {
  id?: unknown
  productId?: unknown
  product_id?: unknown
  productUomId?: unknown
  product_uom_id?: unknown
}

type ManufacturingOrderRow = {
  id?: unknown
  companyId?: unknown
  company_id?: unknown
  origin?: unknown
  state?: unknown
  bomId?: unknown
  bom_id?: unknown
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
  }
  return String(value)
}

async function fetchBomRows(page: Page): Promise<BomRow[]> {
  const response = await page.request.get("/api/query/mrp-boms")
  if (!response.ok()) throw new Error(`mrp-boms query failed: ${response.status()}`)
  return ((await response.json()) as { data?: BomRow[] }).data ?? []
}

async function createSetupBomViaUi(page: Page): Promise<BomRow> {
  const before = new Set(
    (await fetchBomRows(page))
      .map((row) => scalarQueryId(row.id))
      .filter((id): id is number => id != null),
  )

  await gotoModule(page, "/manufacturing", "manufacturing")
  await page.getByTestId("module-tab-manufacturing-boms").click()
  await waitForBffQueryMinRows(page, "/api/query/products")
  await page.getByTestId("module-create-manufacturing-boms").click()
  await expect(page.getByTestId("form-modal-new-bom")).toBeVisible()
  await chooseFirstOption(page, "productTmplId")
  await page.getByTestId("form-field-productQty").fill("1")
  await chooseFirstOption(page, "type")

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        matchesOperationResponse(candidate, "create_bom") && candidate.ok(),
      { timeout: 60_000 },
    ),
    submitForm(page, "new-bom"),
  ])
  expect(response.ok()).toBe(true)

  return expect
    .poll(
      async () => {
        const created = (await fetchBomRows(page)).filter((row) => {
          const id = scalarQueryId(row.id)
          return id != null && !before.has(id)
        })
        return created.length === 1 ? created[0] : undefined
      },
      { timeout: 30_000 },
    )
    .not.toBeUndefined()
    .then(async () => {
      const created = (await fetchBomRows(page)).filter((row) => {
        const id = scalarQueryId(row.id)
        return id != null && !before.has(id)
      })
      if (created.length !== 1) {
        throw new Error(`expected exactly one setup BOM, found ${created.length}`)
      }
      return created[0]!
    })
}

async function fetchFirstStockPicking(page: Page): Promise<{
  pickingTypeId: number
  locationSrcId: number
  locationDestId: number
}> {
  const response = await page.request.get("/api/query/stock-pickings")
  if (!response.ok()) {
    throw new Error(`stock-pickings query failed: ${response.status()}`)
  }
  const rows = ((await response.json()) as {
    data?: Array<{
      pickingTypeId?: unknown
      picking_type_id?: unknown
      locationId?: unknown
      location_id?: unknown
      locationDestId?: unknown
      location_dest_id?: unknown
    }>
  }).data ?? []

  const row = rows.find((candidate) => {
    const pickingTypeId = scalarQueryId(
      candidate.pickingTypeId ?? candidate.picking_type_id,
    )
    const locationSrcId = scalarQueryId(
      candidate.locationId ?? candidate.location_id,
    )
    const locationDestId = scalarQueryId(
      candidate.locationDestId ?? candidate.location_dest_id,
    )
    return pickingTypeId != null && locationSrcId != null && locationDestId != null
  })

  const pickingTypeId = scalarQueryId(
    row?.pickingTypeId ?? row?.picking_type_id,
  )
  const locationSrcId = scalarQueryId(row?.locationId ?? row?.location_id)
  const locationDestId = scalarQueryId(
    row?.locationDestId ?? row?.location_dest_id,
  )
  if (pickingTypeId == null || locationSrcId == null || locationDestId == null) {
    throw new Error("no stock picking with picking type and locations in seed data")
  }
  return { pickingTypeId, locationSrcId, locationDestId }
}

async function postTypedCommand(
  page: Page,
  reducer: "create_manufacturing_order" | "confirm_manufacturing_order",
  args: Record<string, unknown>,
) {
  const { urlPath, init } = stdbBffCommandPost(reducer, args)
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

async function fetchManufacturingOrders(
  page: Page,
): Promise<ManufacturingOrderRow[]> {
  const response = await page.request.get("/api/query/mrp-productions")
  if (!response.ok()) {
    throw new Error(`mrp-productions query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: ManufacturingOrderRow[] }).data ?? []
}

async function fetchExactMoByOrigin(
  page: Page,
  origin: string,
  companyId: number,
): Promise<ManufacturingOrderRow | undefined> {
  const matches = (await fetchManufacturingOrders(page)).filter(
    (row) =>
      String(row.origin ?? "") === origin &&
      scalarQueryId(row.companyId ?? row.company_id) === companyId,
  )
  if (matches.length > 1) {
    throw new Error(`duplicate manufacturing orders for origin ${origin}`)
  }
  return matches[0]
}

test.describe(
  "COV-07a exact manufacturing-order confirmation",
  { tag: ["@p0", "@cov07", "@unauthenticated"] },
  () => {
    test("warehouse operator confirms the exact BOM-backed MO and stale/denied replays preserve it", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const bom = await createSetupBomViaUi(page)
      const bomId = scalarQueryId(bom.id)
      const productId = scalarQueryId(bom.productId ?? bom.product_id)
      const productUomId = scalarQueryId(
        bom.productUomId ?? bom.product_uom_id,
      )
      if (bomId == null || productId == null || productUomId == null) {
        throw new Error("setup BOM is missing canonical product/UOM identity")
      }

      const picking = await fetchFirstStockPicking(page)
      const origin = smokeName("cov07a-mo")
      const planned = stbTimestampFromDate(
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      )
      const params: CreateMrpProductionParams = {
        companyId: BigInt(companyId),
        productId: BigInt(productId),
        productQty: 1,
        productUomId: BigInt(productUomId),
        datePlannedStart: planned,
        datePlannedFinished: planned,
        locationSrcId: BigInt(picking.locationSrcId),
        locationDestId: BigInt(picking.locationDestId),
        warehouseId: BigInt(warehouseId),
        pickingTypeId: BigInt(picking.pickingTypeId),
        consumption: "flexible",
        bomId: BigInt(bomId),
        routingId: undefined,
        procGroupId: undefined,
        procurementGroupId: undefined,
        dateDeadline: undefined,
        origin,
        responsibleUserId: undefined,
        metadata: undefined,
      }

      const createResponse = await postTypedCommand(
        page,
        "create_manufacturing_order",
        {
          params: stdbParamsToJson(params, "CreateMrpProductionParams"),
        },
      )
      expect(createResponse.ok()).toBe(true)

      let mo: ManufacturingOrderRow | undefined
      await expect
        .poll(
          async () => {
            mo = await fetchExactMoByOrigin(page, origin, companyId)
            return mo == null
              ? undefined
              : {
                  id: scalarQueryId(mo.id),
                  state: stateTag(mo.state),
                  bomId: scalarQueryId(mo.bomId ?? mo.bom_id),
                }
          },
          { timeout: 30_000 },
        )
        .toMatchObject({
          state: "Draft",
          bomId,
        })

      const moId = scalarQueryId(mo?.id)
      if (moId == null) throw new Error("setup manufacturing order has no id")

      const warehouseContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const warehousePage = await warehouseContext.newPage()
      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()

      try {
        await signIn(
          warehousePage,
          "fixture.warehouse@example.test",
          PERSONA_PASSWORD,
        )
        await gotoModule(warehousePage, "/manufacturing", "manufacturing")
        await warehousePage
          .getByTestId("module-tab-manufacturing-orders")
          .click()

        const panel = warehousePage.locator('[role="tabpanel"]:visible')
        await panel.getByLabel("Search records").fill(origin)
        const row = panel.getByTestId(`entity-row-${moId}`)
        await expect(row).toBeVisible({ timeout: 30_000 })
        await row.click()

        const formId = `manufacturing-order-row-${moId}`
        await expect(
          warehousePage.getByTestId(`form-modal-${formId}`),
        ).toBeVisible()
        await warehousePage
          .getByTestId("form-field-moAction-confirm")
          .click()

        const [confirmResponse] = await Promise.all([
          warehousePage.waitForResponse(
            (candidate) =>
              matchesOperationResponse(
                candidate,
                "confirm_manufacturing_order",
              ) && candidate.ok(),
            { timeout: 60_000 },
          ),
          submitForm(warehousePage, formId),
        ])
        expect(confirmResponse.ok()).toBe(true)

        await expect
          .poll(
            async () => {
              const confirmed = await fetchExactMoByOrigin(
                page,
                origin,
                companyId,
              )
              return {
                id: scalarQueryId(confirmed?.id),
                state: stateTag(confirmed?.state),
                bomId: scalarQueryId(confirmed?.bomId ?? confirmed?.bom_id),
              }
            },
            { timeout: 30_000 },
          )
          .toEqual({
            id: moId,
            state: "Confirmed",
            bomId,
          })

        const stale = await postTypedCommand(
          warehousePage,
          "confirm_manufacturing_order",
          {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          },
        )
        expect(stale.status()).toBe(422)

        const afterStale = await fetchExactMoByOrigin(page, origin, companyId)
        expect(scalarQueryId(afterStale?.id)).toBe(moId)
        expect(stateTag(afterStale?.state)).toBe("Confirmed")
        expect(scalarQueryId(afterStale?.bomId ?? afterStale?.bom_id)).toBe(
          bomId,
        )

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denied = await postTypedCommand(
          readerPage,
          "confirm_manufacturing_order",
          {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          },
        )
        expect(denied.status()).toBe(403)

        const afterDenied = await fetchExactMoByOrigin(page, origin, companyId)
        expect(scalarQueryId(afterDenied?.id)).toBe(moId)
        expect(stateTag(afterDenied?.state)).toBe("Confirmed")
        expect(scalarQueryId(afterDenied?.bomId ?? afterDenied?.bom_id)).toBe(
          bomId,
        )
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
