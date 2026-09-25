import { expect, test, type Page } from "@playwright/test"
import { toCreateBomParams, toCreateMrpProductionParams } from "@lumiere/erp-shared/manufacturing-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import {
  resolveManufacturingMaterialEffect,
  type ManufacturingBomLineProjection,
  type ManufacturingStockMoveProjection,
} from "@lumiere/query-hooks/hooks/manufacturing-material-consumption"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  fetchDefaultCompanyId,
  fetchFirstWarehouseId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type ProductRow = {
  id?: unknown
  uomId?: unknown
  uom_id?: unknown
  tracking?: unknown
  type?: unknown
  type_?: unknown
}

type BomRow = {
  id?: unknown
}

type ManufacturingOrderRow = {
  id?: unknown
  companyId?: unknown
  company_id?: unknown
  origin?: unknown
  state?: unknown
  bomId?: unknown
  bom_id?: unknown
  productQty?: unknown
  product_qty?: unknown
  locationSrcId?: unknown
  location_src_id?: unknown
  moveRawIds?: unknown
  move_raw_ids?: unknown
  moveRawCount?: unknown
  move_raw_count?: unknown
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
  }
  return String(value)
}

async function queryRows<T>(page: Page, resource: string): Promise<T[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: T[] }).data ?? []
}

async function fetchUntrackedProduct(page: Page): Promise<{
  id: number
  uomId: number
}> {
  const products = await queryRows<ProductRow>(page, "products")
  const product = products.find((row) => {
    const id = scalarQueryId(row.id)
    const uomId = scalarQueryId(row.uomId ?? row.uom_id)
    const tracking = stateTag(row.tracking).toLowerCase()
    const type = String(row.type ?? row.type_ ?? "").toLowerCase()
    return (
      id != null &&
      uomId != null &&
      tracking !== "lot" &&
      tracking !== "serial" &&
      type !== "service"
    )
  })
  const id = scalarQueryId(product?.id)
  const uomId = scalarQueryId(product?.uomId ?? product?.uom_id)
  if (id == null || uomId == null) {
    throw new Error("no untracked storable product in seed data")
  }
  return { id, uomId }
}

async function fetchFirstStockPicking(page: Page): Promise<{
  pickingTypeId: number
  locationSrcId: number
  locationDestId: number
}> {
  const rows = await queryRows<
    {
      pickingTypeId?: unknown
      picking_type_id?: unknown
      locationId?: unknown
      location_id?: unknown
      locationDestId?: unknown
      location_dest_id?: unknown
    }
  >(page, "stock-pickings")

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
    throw new Error("no stock picking with complete manufacturing locations")
  }
  return { pickingTypeId, locationSrcId, locationDestId }
}

async function postPreparedCommand(
  page: Page,
  command: { urlPath: string; init: RequestInit },
) {
  return page.request.post(command.urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(command.init.body)),
  })
}

async function createSetupBom(
  page: Page,
  companyId: number,
  product: { id: number; uomId: number },
  warehouseId: number,
  picking: {
    pickingTypeId: number
    locationSrcId: number
    locationDestId: number
  },
): Promise<number> {
  const before = new Set(
    (await queryRows<BomRow>(page, "mrp-boms"))
      .map((row) => scalarQueryId(row.id))
      .filter((id): id is number => id != null),
  )

  const params = toCreateBomParams(
    {
      productTmplId: product.id,
      productQty: 1,
      type: "Manufacture",
      readyToProduce: "all_available",
      consumption: "flexible",
      sequence: 10,
      pickingTypeId: picking.pickingTypeId,
      locationSrcId: picking.locationSrcId,
      locationDestId: picking.locationDestId,
      warehouseId,
      bomLines: JSON.stringify([
        {
          productId: product.id,
          productQty: 1,
          productUomId: product.uomId,
          sequence: 10,
        },
        {
          productId: product.id,
          productQty: 0.5,
          productUomId: product.uomId,
          sequence: 20,
        },
      ]),
      metadata: JSON.stringify({ cov: "07b" }),
    },
    {
      productUomId: BigInt(product.uomId),
      companyId: BigInt(companyId),
    },
  )
  if (!params) throw new Error("failed to build COV-07b BOM params")

  const response = await postPreparedCommand(
    page,
    stdbBffCommandPost("create_bom", {
      params: stdbParamsToJson(params, "CreateBomParams"),
    }),
  )
  expect(response.ok()).toBe(true)

  let createdId: number | undefined
  await expect
    .poll(
      async () => {
        const created = (await queryRows<BomRow>(page, "mrp-boms"))
          .map((row) => scalarQueryId(row.id))
          .filter((id): id is number => id != null && !before.has(id))
        createdId = created.length === 1 ? created[0] : undefined
        return created.length
      },
      { timeout: 30_000 },
    )
    .toBe(1)

  if (createdId == null) throw new Error("setup BOM disappeared")
  return createdId
}

async function createSetupMo(
  page: Page,
  companyId: number,
  product: { id: number; uomId: number },
  warehouseId: number,
  picking: {
    pickingTypeId: number
    locationSrcId: number
    locationDestId: number
  },
  bomId: number,
  origin: string,
): Promise<number> {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const params = toCreateMrpProductionParams(
    {
      productId: product.id,
      productQty: 2,
      warehouseId,
      pickingTypeId: picking.pickingTypeId,
      locationSrcId: picking.locationSrcId,
      locationDestId: picking.locationDestId,
      datePlannedStart: tomorrow,
      datePlannedFinished: tomorrow,
      consumption: "flexible",
      bomId,
      origin,
      metadata: JSON.stringify({ cov: "07b" }),
    },
    {
      productUomId: BigInt(product.uomId),
      companyId: BigInt(companyId),
    },
  )
  if (!params) throw new Error("failed to build COV-07b MO params")

  const response = await postPreparedCommand(
    page,
    stdbBffCommandPost("create_manufacturing_order", {
      params: stdbParamsToJson(params, "CreateMrpProductionParams"),
    }),
  )
  expect(response.ok()).toBe(true)

  let moId: number | undefined
  await expect
    .poll(
      async () => {
        const matches = (await queryRows<ManufacturingOrderRow>(
          page,
          "mrp-productions",
        )).filter(
          (row) =>
            String(row.origin ?? "") === origin &&
            scalarQueryId(row.companyId ?? row.company_id) === companyId,
        )
        if (matches.length > 1) {
          throw new Error(`duplicate MO origin ${origin}`)
        }
        moId = scalarQueryId(matches[0]?.id)
        return {
          id: moId,
          state: stateTag(matches[0]?.state),
          bomId: scalarQueryId(matches[0]?.bomId ?? matches[0]?.bom_id),
        }
      },
      { timeout: 30_000 },
    )
    .toEqual({ id: expect.any(Number), state: "Draft", bomId })

  if (moId == null) throw new Error("setup MO disappeared")
  return moId
}

async function fetchMaterialEffect(
  page: Page,
  moId: number,
  companyId: number,
) {
  const [orders, bomLines, moves] = await Promise.all([
    queryRows<ManufacturingOrderRow>(page, "mrp-productions"),
    queryRows<ManufacturingBomLineProjection>(page, "mrp-bom-lines"),
    queryRows<ManufacturingStockMoveProjection>(page, "stock-moves"),
  ])
  return resolveManufacturingMaterialEffect(
    orders,
    bomLines,
    moves,
    BigInt(moId),
    BigInt(companyId),
  )
}

async function componentLocationQuantity(
  page: Page,
  companyId: number,
  productId: number,
  locationId: number,
): Promise<number> {
  const quants = await queryRows<
    {
      companyId?: unknown
      company_id?: unknown
      productId?: unknown
      product_id?: unknown
      locationId?: unknown
      location_id?: unknown
      quantity?: unknown
    }
  >(page, "stock-quants")

  return quants
    .filter(
      (row) =>
        scalarQueryId(row.companyId ?? row.company_id) === companyId &&
        scalarQueryId(row.productId ?? row.product_id) === productId &&
        scalarQueryId(row.locationId ?? row.location_id) === locationId,
    )
    .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
}

async function runMoActionViaUi(
  page: Page,
  moId: number,
  origin: string,
  action: "start" | "consume",
) {
  await gotoModule(page, "/manufacturing", "manufacturing")
  await page.getByTestId("module-tab-manufacturing-orders").click()
  const panel = page.locator('[role="tabpanel"]:visible')
  await panel.getByLabel("Search records").fill(origin)
  const row = panel.getByTestId(`entity-row-${moId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()

  const formId = `manufacturing-order-row-${moId}`
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
  await page.getByTestId(`form-field-moAction-${action}`).click()

  const reducer =
    action === "start" ? "start_manufacturing_order" : "consume_mo_materials"
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        matchesOperationResponse(candidate, reducer) && candidate.ok(),
      { timeout: 60_000 },
    ),
    submitForm(page, formId),
  ])
  expect(response.ok()).toBe(true)
}

test.describe(
  "COV-07b exact manufacturing material consumption",
  { tag: ["@p0", "@cov07", "@unauthenticated"] },
  () => {
    test("warehouse operator starts one BOM-backed MO and consumes its exact raw-move set once", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page)
      const companyId = await fetchDefaultCompanyId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const product = await fetchUntrackedProduct(page)
      const picking = await fetchFirstStockPicking(page)
      const bomId = await createSetupBom(
        page,
        companyId,
        product,
        warehouseId,
        picking,
      )
      const origin = smokeName("cov07b-mo")
      const moId = await createSetupMo(
        page,
        companyId,
        product,
        warehouseId,
        picking,
        bomId,
        origin,
      )

      const confirm = await postPreparedCommand(
        page,
        stdbBffCommandPost("confirm_manufacturing_order", {
          companyId: BigInt(companyId),
          moId: BigInt(moId),
        }),
      )
      expect(confirm.ok()).toBe(true)

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

        await runMoActionViaUi(warehousePage, moId, origin, "start")
        await expect
          .poll(
            async () => {
              const rows = await queryRows<ManufacturingOrderRow>(
                page,
                "mrp-productions",
              )
              const row = rows.find((candidate) => scalarQueryId(candidate.id) === moId)
              return stateTag(row?.state)
            },
            { timeout: 30_000 },
          )
          .toBe("Progress")

        const staleStart = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("start_manufacturing_order", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          }),
        )
        expect(staleStart.status()).toBe(422)
        expect(await fetchMaterialEffect(page, moId, companyId)).toBeNull()

        await runMoActionViaUi(warehousePage, moId, origin, "consume")

        let firstEffect: Awaited<ReturnType<typeof fetchMaterialEffect>> = null
        await expect
          .poll(
            async () => {
              firstEffect = await fetchMaterialEffect(page, moId, companyId)
              return firstEffect?.stockMoveIds.length ?? 0
            },
            { timeout: 30_000 },
          )
          .toBe(2)

        if (!firstEffect) throw new Error("material effect disappeared")
        const firstMoveIds = [...firstEffect.stockMoveIds]
        const quantityAfterFirst = await componentLocationQuantity(
          page,
          companyId,
          product.id,
          picking.locationSrcId,
        )

        const replay = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("consume_mo_materials", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          }),
        )
        expect(replay.ok()).toBe(true)

        const replayedEffect = await fetchMaterialEffect(page, moId, companyId)
        expect(replayedEffect?.stockMoveIds).toEqual(firstMoveIds)
        expect(
          await componentLocationQuantity(
            page,
            companyId,
            product.id,
            picking.locationSrcId,
          ),
        ).toBe(quantityAfterFirst)

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denied = await postPreparedCommand(
          readerPage,
          stdbBffCommandPost("consume_mo_materials", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          }),
        )
        expect(denied.status()).toBe(403)

        const afterDenied = await fetchMaterialEffect(page, moId, companyId)
        expect(afterDenied?.stockMoveIds).toEqual(firstMoveIds)
        expect(
          await componentLocationQuantity(
            page,
            companyId,
            product.id,
            picking.locationSrcId,
          ),
        ).toBe(quantityAfterFirst)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
