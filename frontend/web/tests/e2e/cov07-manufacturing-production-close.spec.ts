import { expect, test, type Page } from "@playwright/test"
import {
  toCreateBomParams,
  toCreateMrpProductionParams,
} from "@lumiere/erp-shared/manufacturing-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import {
  resolveManufacturingFinishedEffect,
  type DestinationQuantSnapshot,
  type ManufacturingCloseOrderProjection,
  type ManufacturingFinishedMoveProjection,
  type ManufacturingFinishedQuantProjection,
} from "@lumiere/query-hooks/hooks/manufacturing-production-close"
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

type BomRow = { id?: unknown }

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
  }
  return String(value)
}

function optionIsAbsent(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === "object" && !Array.isArray(value) && value !== null) {
    const keys = Object.keys(value)
    return keys.length === 1 && keys[0] === "none"
  }
  return false
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
      ]),
      metadata: JSON.stringify({ cov: "07c" }),
    },
    {
      productUomId: BigInt(product.uomId),
      companyId: BigInt(companyId),
    },
  )
  if (!params) throw new Error("failed to build COV-07c BOM params")

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
      productQty: 1,
      warehouseId,
      pickingTypeId: picking.pickingTypeId,
      locationSrcId: picking.locationSrcId,
      locationDestId: picking.locationDestId,
      datePlannedStart: tomorrow,
      datePlannedFinished: tomorrow,
      consumption: "flexible",
      bomId,
      origin,
      metadata: JSON.stringify({ cov: "07c" }),
    },
    {
      productUomId: BigInt(product.uomId),
      companyId: BigInt(companyId),
    },
  )
  if (!params) throw new Error("failed to build COV-07c MO params")

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
        const matches = (
          await queryRows<ManufacturingCloseOrderProjection>(
            page,
            "mrp-productions",
          )
        ).filter(
          (row) =>
            String((row as { origin?: unknown }).origin ?? "") === origin &&
            scalarQueryId(row.companyId ?? row.company_id) === companyId,
        )
        if (matches.length > 1) throw new Error(`duplicate MO origin ${origin}`)
        moId = scalarQueryId(matches[0]?.id)
        return {
          id: moId,
          state: stateTag(matches[0]?.state),
          bomId: scalarQueryId(
            (matches[0] as { bomId?: unknown; bom_id?: unknown })?.bomId ??
              (matches[0] as { bomId?: unknown; bom_id?: unknown })?.bom_id,
          ),
        }
      },
      { timeout: 30_000 },
    )
    .toEqual({ id: expect.any(Number), state: "Draft", bomId })

  if (moId == null) throw new Error("setup MO disappeared")
  return moId
}

async function runSetupCommand(
  page: Page,
  reducer:
    | "confirm_manufacturing_order"
    | "start_manufacturing_order"
    | "consume_mo_materials",
  companyId: number,
  moId: number,
) {
  const response = await postPreparedCommand(
    page,
    stdbBffCommandPost(reducer, {
      companyId: BigInt(companyId),
      moId: BigInt(moId),
    }),
  )
  expect(response.ok()).toBe(true)
}

async function fetchExactMo(
  page: Page,
  moId: number,
  companyId: number,
): Promise<ManufacturingCloseOrderProjection> {
  const matches = (
    await queryRows<ManufacturingCloseOrderProjection>(
      page,
      "mrp-productions",
    )
  ).filter(
    (row) =>
      scalarQueryId(row.id) === moId &&
      scalarQueryId(row.companyId ?? row.company_id) === companyId,
  )
  if (matches.length !== 1) {
    throw new Error(`expected one MO ${moId}, found ${matches.length}`)
  }
  return matches[0]!
}

async function destinationQuantSnapshot(
  page: Page,
  companyId: number,
  productId: number,
  locationId: number,
): Promise<DestinationQuantSnapshot> {
  const matches = (
    await queryRows<ManufacturingFinishedQuantProjection>(page, "stock-quants")
  ).filter(
    (row) =>
      scalarQueryId(row.companyId ?? row.company_id) === companyId &&
      scalarQueryId(row.productId ?? row.product_id) === productId &&
      scalarQueryId(row.locationId ?? row.location_id) === locationId &&
      optionIsAbsent(row.lotId ?? row.lot_id) &&
      optionIsAbsent(row.packageId ?? row.package_id) &&
      optionIsAbsent(row.ownerId ?? row.owner_id),
  )

  if (matches.length > 1) {
    throw new Error(`ambiguous destination quant: ${matches.length} rows`)
  }
  if (matches.length === 0) return { quantity: 0 }

  const id = scalarQueryId(matches[0]?.id)
  const quantity = Number(matches[0]?.quantity ?? Number.NaN)
  if (id == null || !Number.isFinite(quantity)) {
    throw new Error("destination quant has invalid identity/quantity")
  }
  return { id: BigInt(id), quantity }
}

async function fetchFinishedEffect(
  page: Page,
  moId: number,
  companyId: number,
  before: DestinationQuantSnapshot,
) {
  const [orders, moves, quants] = await Promise.all([
    queryRows<ManufacturingCloseOrderProjection>(page, "mrp-productions"),
    queryRows<ManufacturingFinishedMoveProjection>(page, "stock-moves"),
    queryRows<ManufacturingFinishedQuantProjection>(page, "stock-quants"),
  ])
  return resolveManufacturingFinishedEffect(
    orders,
    moves,
    quants,
    BigInt(moId),
    BigInt(companyId),
    before,
  )
}

async function runMoActionViaUi(
  page: Page,
  moId: number,
  origin: string,
  action: "produce" | "finish",
  produceQty?: number,
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
  if (action === "produce" && produceQty != null) {
    await page.getByTestId("form-field-produceQty").fill(String(produceQty))
  }

  const reducer =
    action === "produce"
      ? "produce_manufacturing_order"
      : "finish_manufacturing_order"
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
  "COV-07c exact production output and close",
  { tag: ["@p0", "@cov07", "@unauthenticated"] },
  () => {
    test("warehouse operator records exact output and closes one finished-goods effect", async ({
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
      const origin = smokeName("cov07c-mo")
      const moId = await createSetupMo(
        page,
        companyId,
        product,
        warehouseId,
        picking,
        bomId,
        origin,
      )

      await runSetupCommand(page, "confirm_manufacturing_order", companyId, moId)
      await runSetupCommand(page, "start_manufacturing_order", companyId, moId)
      await runSetupCommand(page, "consume_mo_materials", companyId, moId)

      const overproduce = await postPreparedCommand(
        page,
        stdbBffCommandPost("produce_manufacturing_order", {
          companyId: BigInt(companyId),
          moId: BigInt(moId),
          qtyProducing: 2,
        }),
      )
      expect(overproduce.status()).toBe(422)
      const afterOverproduce = await fetchExactMo(page, moId, companyId)
      expect(stateTag(afterOverproduce.state)).toBe("Progress")
      expect(Number(afterOverproduce.qtyProduced ?? afterOverproduce.qty_produced ?? 0)).toBe(0)

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

        await runMoActionViaUi(warehousePage, moId, origin, "produce", 1)

        await expect
          .poll(
            async () => {
              const produced = await fetchExactMo(page, moId, companyId)
              return {
                state: stateTag(produced.state),
                qtyProduced: Number(
                  produced.qtyProduced ?? produced.qty_produced ?? Number.NaN,
                ),
                finishedCount: Number(
                  produced.moveFinishedCount ??
                    produced.move_finished_count ??
                    Number.NaN,
                ),
              }
            },
            { timeout: 30_000 },
          )
          .toEqual({
            state: "ToClose",
            qtyProduced: 1,
            finishedCount: 0,
          })

        const staleProduce = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("produce_manufacturing_order", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
            qtyProducing: 0.1,
          }),
        )
        expect(staleProduce.status()).toBe(422)

        const destinationBefore = await destinationQuantSnapshot(
          page,
          companyId,
          product.id,
          picking.locationDestId,
        )

        await runMoActionViaUi(warehousePage, moId, origin, "finish")

        let firstEffect: Awaited<ReturnType<typeof fetchFinishedEffect>> = null
        await expect
          .poll(
            async () => {
              firstEffect = await fetchFinishedEffect(
                page,
                moId,
                companyId,
                destinationBefore,
              )
              return firstEffect?.finishedMoveId
            },
            { timeout: 30_000 },
          )
          .toEqual(expect.any(String))

        if (!firstEffect) throw new Error("finished-goods effect disappeared")
        const firstFinishedMoveId = firstEffect.finishedMoveId
        const firstDestinationQuantId = firstEffect.destinationQuantId

        const replay = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("finish_manufacturing_order", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          }),
        )
        expect(replay.status()).toBe(422)

        const replayedEffect = await fetchFinishedEffect(
          page,
          moId,
          companyId,
          destinationBefore,
        )
        expect(replayedEffect?.finishedMoveId).toBe(firstFinishedMoveId)
        expect(replayedEffect?.destinationQuantId).toBe(firstDestinationQuantId)

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denied = await postPreparedCommand(
          readerPage,
          stdbBffCommandPost("finish_manufacturing_order", {
            companyId: BigInt(companyId),
            moId: BigInt(moId),
          }),
        )
        expect(denied.status()).toBe(403)

        const afterDenied = await fetchFinishedEffect(
          page,
          moId,
          companyId,
          destinationBefore,
        )
        expect(afterDenied?.finishedMoveId).toBe(firstFinishedMoveId)
        expect(afterDenied?.destinationQuantId).toBe(firstDestinationQuantId)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
