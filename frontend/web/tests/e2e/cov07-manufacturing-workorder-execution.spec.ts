import { expect, test, type Page } from "@playwright/test"
import {
  toCreateMrpProductionParams,
  toCreateWorkcenterParams,
  toCreateWorkcenterProductivityParams,
  toCreateWorkorderParams,
} from "@lumiere/erp-shared/manufacturing-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import {
  resolveProductivityEffect,
  resolveWorkorderFinishedEffect,
  resolveWorkorderStateEffect,
  type FinishSnapshot,
  type ProductivitySnapshot,
  type WorkcenterExecutionProjection,
  type WorkorderExecutionProjection,
  type WorkorderParentProjection,
} from "@lumiere/query-hooks/hooks/manufacturing-workorder-execution"
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
  type?: unknown
  type_?: unknown
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
  }
  return String(value)
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => scalarQueryId(item))
    .filter((id): id is number => id != null)
    .map(String)
}

async function queryRows<T>(page: Page, resource: string): Promise<T[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: T[] }).data ?? []
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

async function fetchProduct(page: Page): Promise<{ id: number; uomId: number }> {
  const products = await queryRows<ProductRow>(page, "products")
  const row = products.find((candidate) => {
    const id = scalarQueryId(candidate.id)
    const uomId = scalarQueryId(candidate.uomId ?? candidate.uom_id)
    const type = String(candidate.type ?? candidate.type_ ?? "").toLowerCase()
    return id != null && uomId != null && type !== "service"
  })
  const id = scalarQueryId(row?.id)
  const uomId = scalarQueryId(row?.uomId ?? row?.uom_id)
  if (id == null || uomId == null) throw new Error("no manufacturing product")
  return { id, uomId }
}

async function fetchPickingContext(page: Page): Promise<{
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
    throw new Error("no manufacturing picking context")
  }
  return { pickingTypeId, locationSrcId, locationDestId }
}

async function createWorkcenter(
  page: Page,
  companyId: number,
  name: string,
): Promise<number> {
  const before = new Set(
    (await queryRows<WorkcenterExecutionProjection>(page, "mrp-workcenters"))
      .map((row) => scalarQueryId(row.id))
      .filter((id): id is number => id != null),
  )
  const params = toCreateWorkcenterParams(
    { name, active: true },
    BigInt(companyId),
  )
  if (!params) throw new Error("failed to build workcenter params")
  const response = await postPreparedCommand(
    page,
    stdbBffCommandPost("create_workcenter", {
      params: stdbParamsToJson(params, "CreateWorkcenterParams"),
    }),
  )
  expect(response.ok()).toBe(true)

  let createdId: number | undefined
  await expect
    .poll(async () => {
      const ids = (
        await queryRows<WorkcenterExecutionProjection>(page, "mrp-workcenters")
      )
        .map((row) => scalarQueryId(row.id))
        .filter((id): id is number => id != null && !before.has(id))
      createdId = ids.length === 1 ? ids[0] : undefined
      return ids.length
    })
    .toBe(1)
  if (createdId == null) throw new Error("workcenter disappeared")
  return createdId
}

async function createProgressMo(
  page: Page,
  companyId: number,
  product: { id: number; uomId: number },
  warehouseId: number,
  picking: {
    pickingTypeId: number
    locationSrcId: number
    locationDestId: number
  },
  origin: string,
): Promise<number> {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
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
      origin,
    },
    {
      productUomId: BigInt(product.uomId),
      companyId: BigInt(companyId),
    },
  )
  if (!params) throw new Error("failed to build MO params")
  const created = await postPreparedCommand(
    page,
    stdbBffCommandPost("create_manufacturing_order", {
      params: stdbParamsToJson(params, "CreateMrpProductionParams"),
    }),
  )
  expect(created.ok()).toBe(true)

  let moId: number | undefined
  await expect
    .poll(async () => {
      const rows = await queryRows<WorkorderParentProjection>(
        page,
        "mrp-productions",
      )
      const matches = rows.filter(
        (row) => String((row as { origin?: unknown }).origin ?? "") === origin,
      )
      if (matches.length > 1) throw new Error("duplicate setup MO origin")
      moId = scalarQueryId(matches[0]?.id)
      return moId
    })
    .toEqual(expect.any(Number))
  if (moId == null) throw new Error("setup MO disappeared")

  for (const reducer of [
    "confirm_manufacturing_order",
    "start_manufacturing_order",
  ] as const) {
    const response = await postPreparedCommand(
      page,
      stdbBffCommandPost(reducer, {
        companyId: BigInt(companyId),
        moId: BigInt(moId),
      }),
    )
    expect(response.ok()).toBe(true)
  }
  return moId
}

async function createExactWorkorder(
  page: Page,
  moId: number,
  workcenterId: number,
  name: string,
): Promise<number> {
  const beforeParent = (
    await queryRows<WorkorderParentProjection>(page, "mrp-productions")
  ).find((row) => scalarQueryId(row.id) === moId)
  const beforeIds = new Set(
    idList(beforeParent?.workorderIds ?? beforeParent?.workorder_ids),
  )

  const params = toCreateWorkorderParams(
    {
      woName: name,
      woDuration: 10,
      woSequence: 10,
    },
    {
      productionId: BigInt(moId),
      workcenterId: BigInt(workcenterId),
    },
  )
  if (!params) throw new Error("failed to build workorder params")

  const response = await postPreparedCommand(
    page,
    stdbBffCommandPost("create_workorder", { params }),
  )
  expect(response.ok()).toBe(true)

  let workorderId: number | undefined
  await expect
    .poll(async () => {
      const parent = (
        await queryRows<WorkorderParentProjection>(page, "mrp-productions")
      ).find((row) => scalarQueryId(row.id) === moId)
      const afterIds = idList(parent?.workorderIds ?? parent?.workorder_ids)
      const created = afterIds.filter((id) => !beforeIds.has(id))
      workorderId = created.length === 1 ? Number(created[0]) : undefined
      return created.length
    })
    .toBe(1)
  if (workorderId == null) throw new Error("workorder disappeared")
  return workorderId
}

async function executionRows(page: Page) {
  const [workorders, productions, workcenters] = await Promise.all([
    queryRows<WorkorderExecutionProjection>(page, "mrp-workorders"),
    queryRows<WorkorderParentProjection>(page, "mrp-productions"),
    queryRows<WorkcenterExecutionProjection>(page, "mrp-workcenters"),
  ])
  return { workorders, productions, workcenters }
}

async function runWorkorderAction(
  page: Page,
  workorderId: number,
  name: string,
  action: "start" | "log_productivity" | "finish",
  duration?: number,
) {
  await gotoModule(page, "/manufacturing", "manufacturing")
  await page.getByTestId("module-tab-manufacturing-workorders").click()
  const panel = page.locator('[role="tabpanel"]:visible')
  await panel.getByLabel("Search records").fill(name)
  const row = panel.getByTestId(`entity-row-${workorderId}`)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()

  const formId = `manufacturing-wo-row-${workorderId}`
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
  await page.getByTestId(`form-field-woAction-${action}`).click()
  if (action === "log_productivity" && duration != null) {
    await page.getByTestId("form-field-woLogDuration").fill(String(duration))
    await page
      .getByTestId("form-field-woLogDescription")
      .fill("COV-07d operator productivity")
  }

  const reducer =
    action === "start"
      ? "start_workorder"
      : action === "finish"
        ? "finish_workorder"
        : "log_workcenter_productivity"
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => matchesOperationResponse(candidate, reducer) && candidate.ok(),
      { timeout: 60_000 },
    ),
    submitForm(page, formId),
  ])
  expect(response.ok()).toBe(true)
}

test.describe(
  "COV-07d exact workorder execution",
  { tag: ["@p0", "@cov07", "@unauthenticated"] },
  () => {
    test("warehouse operator starts, logs productivity, and finishes the exact MO-owned workorder", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page)
      const companyId = await fetchDefaultCompanyId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const product = await fetchProduct(page)
      const picking = await fetchPickingContext(page)
      const workcenterId = await createWorkcenter(
        page,
        companyId,
        smokeName("cov07d-wc"),
      )
      const origin = smokeName("cov07d-mo")
      const moId = await createProgressMo(
        page,
        companyId,
        product,
        warehouseId,
        picking,
        origin,
      )
      const workorderName = smokeName("cov07d-wo")
      const workorderId = await createExactWorkorder(
        page,
        moId,
        workcenterId,
        workorderName,
      )

      const initial = await executionRows(page)
      expect(
        resolveWorkorderStateEffect(
          initial.workorders,
          initial.productions,
          initial.workcenters,
          BigInt(workorderId),
          BigInt(companyId),
          "progress",
        ),
      ).toBeNull()
      const initialCenter = initial.workcenters.find(
        (row) => scalarQueryId(row.id) === workcenterId,
      )
      expect(idList(initialCenter?.orderIds ?? initialCenter?.order_ids)).toContain(
        String(workorderId),
      )

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

        await runWorkorderAction(
          warehousePage,
          workorderId,
          workorderName,
          "start",
        )

        await expect
          .poll(async () => {
            const rows = await executionRows(page)
            return resolveWorkorderStateEffect(
              rows.workorders,
              rows.productions,
              rows.workcenters,
              BigInt(workorderId),
              BigInt(companyId),
              "progress",
            )?.id
          })
          .toBe(String(workorderId))

        const staleStart = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("start_workorder", {
            companyId: BigInt(companyId),
            workorderId: BigInt(workorderId),
          }),
        )
        expect(staleStart.status()).toBe(422)

        const beforeProductivityRows = await executionRows(page)
        const beforeWorkorder = beforeProductivityRows.workorders.find(
          (row) => scalarQueryId(row.id) === workorderId,
        )
        const beforeCenter = beforeProductivityRows.workcenters.find(
          (row) => scalarQueryId(row.id) === workcenterId,
        )
        const beforeProductivity: ProductivitySnapshot = {
          workorderTimeIds: idList(
            beforeWorkorder?.timeIds ?? beforeWorkorder?.time_ids,
          ),
          workorderDuration: Number(beforeWorkorder?.duration ?? 0),
          workcenterProductivityIds: idList(
            beforeCenter?.productivityIds ?? beforeCenter?.productivity_ids,
          ),
          workcenterProductiveTime: Number(
            beforeCenter?.productiveTime ?? beforeCenter?.productive_time ?? 0,
          ),
        }

        await runWorkorderAction(
          warehousePage,
          workorderId,
          workorderName,
          "log_productivity",
          2.5,
        )

        let productivityId: string | undefined
        await expect
          .poll(async () => {
            const rows = await executionRows(page)
            const effect = resolveProductivityEffect(
              rows.workorders,
              rows.productions,
              rows.workcenters,
              BigInt(workorderId),
              BigInt(companyId),
              BigInt(workcenterId),
              2.5,
              beforeProductivity,
            )
            productivityId = effect?.id
            return productivityId
          })
          .toEqual(expect.any(String))

        const params = toCreateWorkcenterProductivityParams({
          logWorkorderId: workorderId,
          logDuration: 1,
          logDescription: "denied replay",
        })
        if (!params) throw new Error("failed to build denied productivity params")

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const deniedLog = await postPreparedCommand(
          readerPage,
          stdbBffCommandPost("log_workcenter_productivity", {
            workcenterId: BigInt(workcenterId),
            params,
          }),
        )
        expect(deniedLog.status()).toBe(403)

        const beforeFinishRows = await executionRows(page)
        const beforeFinishWorkorder = beforeFinishRows.workorders.find(
          (row) => scalarQueryId(row.id) === workorderId,
        )
        const beforeFinishCenter = beforeFinishRows.workcenters.find(
          (row) => scalarQueryId(row.id) === workcenterId,
        )
        const beforeFinish: FinishSnapshot = {
          workorderTimeIds: idList(
            beforeFinishWorkorder?.timeIds ?? beforeFinishWorkorder?.time_ids,
          ),
          workorderDuration: Number(beforeFinishWorkorder?.duration ?? 0),
          workcenterCount: Number(
            beforeFinishCenter?.workorderCount ??
              beforeFinishCenter?.workorder_count ??
              0,
          ),
          workcenterProgressCount: Number(
            beforeFinishCenter?.workorderProgressCount ??
              beforeFinishCenter?.workorder_progress_count ??
              0,
          ),
        }
        expect(beforeFinish.workorderTimeIds).toEqual([productivityId!])

        await runWorkorderAction(
          warehousePage,
          workorderId,
          workorderName,
          "finish",
        )

        await expect
          .poll(async () => {
            const rows = await executionRows(page)
            return resolveWorkorderFinishedEffect(
              rows.workorders,
              rows.productions,
              rows.workcenters,
              BigInt(workorderId),
              BigInt(companyId),
              beforeFinish,
            )?.id
          })
          .toBe(String(workorderId))

        const staleFinish = await postPreparedCommand(
          warehousePage,
          stdbBffCommandPost("finish_workorder", {
            companyId: BigInt(companyId),
            workorderId: BigInt(workorderId),
          }),
        )
        expect(staleFinish.status()).toBe(422)

        const deniedFinish = await postPreparedCommand(
          readerPage,
          stdbBffCommandPost("finish_workorder", {
            companyId: BigInt(companyId),
            workorderId: BigInt(workorderId),
          }),
        )
        expect(deniedFinish.status()).toBe(403)

        const finalRows = await executionRows(page)
        const finished = finalRows.workorders.find(
          (row) => scalarQueryId(row.id) === workorderId,
        )
        expect(stateTag(finished?.state)).toBe("Done")
        expect(idList(finished?.timeIds ?? finished?.time_ids)).toEqual([
          productivityId!,
        ])
        expect(Number(finished?.duration ?? 0)).toBe(2.5)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
