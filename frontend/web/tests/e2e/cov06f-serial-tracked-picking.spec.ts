import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  addSaleOrderLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  fetchOrderPickings,
} from "./sales-order-fixtures"
import {
  expectCanonicalPickingFocus,
  fetchPickingMoveStates,
  fetchPickingState,
  runPickingActionViaInventoryUi,
} from "./inventory-picking-fixtures"
import {
  createInternalLocation,
  createSerialTrackedProductFixture,
  createStockProductionSerialFixture,
  createStockQuantFixture,
  fetchQuantsAtProductLocation,
  fetchSerialById,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function pickingRequest(
  page: Page,
  reducer: "confirm_stock_picking" | "assign_stock_picking" | "validate_stock_picking",
  companyId: number,
  pickingId: number,
) {
  const { urlPath, init } = stdbBffCommandPost(reducer, {
    pickingId,
    params: stdbParamsToJson(
      { companyId: BigInt(companyId) },
      "CompanyScopeParams",
    ),
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06f exact serial-tracked picking",
  { tag: ["@p0", "@cov06", "@cov06f", "@unauthenticated"] },
  () => {
    test("warehouse persona validates a serial-tracked delivery and the serial converges free → reserved → in_use", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productName = smokeName("cov06f-serial-product")
      const productId = await createSerialTrackedProductFixture(page, productName)
      const sourceName = smokeName("cov06f-src")
      const sourceLocationId = await createInternalLocation(page, sourceName)

      // On-hand quant for ATP plus exactly one free serial — the bounded case.
      await createStockQuantFixture(
        page,
        companyId,
        productId,
        sourceLocationId,
        smokeName("cov06f-quant"),
        1,
      )
      const serialId = await createStockProductionSerialFixture(
        page,
        companyId,
        productId,
        smokeName("cov06f-serial"),
      )
      expect(await fetchSerialById(page, serialId)).toMatchObject({
        id: serialId,
        state: "free",
      })

      const orderId = await createDraftSaleOrder(page, smokeName("cov06f-so"))
      await addSaleOrderLine(page, orderId, productName, "1")
      await confirmOrderViaUi(page, orderId)

      const initialPickings = await fetchOrderPickings(page, orderId)
      expect(initialPickings).toHaveLength(1)
      const [initialPicking] = initialPickings
      if (initialPicking == null) throw new Error("Expected one delivery picking")
      const pickingId = initialPicking.id

      expect(await fetchPickingState(page, pickingId)).toBe("draft")

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

        await runPickingActionViaInventoryUi(warehousePage, pickingId, "confirm")
        await expect
          .poll(() => fetchPickingState(page, pickingId), { timeout: 30_000 })
          .toBe("confirmed")

        await runPickingActionViaInventoryUi(warehousePage, pickingId, "assign")
        await expect
          .poll(() => fetchPickingState(page, pickingId), { timeout: 30_000 })
          .toBe("assigned")

        // Assign reserves ATP: the one free serial converges to reserved.
        await expect
          .poll(async () => (await fetchSerialById(page, serialId))?.state, {
            timeout: 30_000,
          })
          .toBe("reserved")

        await runPickingActionViaInventoryUi(warehousePage, pickingId, "validate")
        await expectCanonicalPickingFocus(warehousePage, pickingId)
        await expect
          .poll(() => fetchPickingState(page, pickingId), { timeout: 30_000 })
          .toBe("done")

        expect(
          (await fetchPickingMoveStates(page, pickingId)).every(
            (move) => move.state === "done" && move.isDone,
          ),
        ).toBe(true)

        // Validate consumes the reservation: the serial converges to in_use.
        await expect
          .poll(async () => (await fetchSerialById(page, serialId))?.state, {
            timeout: 30_000,
          })
          .toBe("in_use")

        // The source quant is fully depleted by the one-unit delivery.
        await expect
          .poll(async () => {
            const rows = await fetchQuantsAtProductLocation(
              page,
              productId,
              sourceLocationId,
            )
            return rows[0]?.quantity ?? 0
          }, { timeout: 30_000 })
          .toBe(0)

        // Exact replay is stale: the picking is already done.
        const staleValidate = await pickingRequest(
          warehousePage,
          "validate_stock_picking",
          companyId,
          pickingId,
        )
        expect(staleValidate.status()).toBe(422)
        expect(await fetchSerialById(page, serialId)).toMatchObject({
          state: "in_use",
        })

        // The limited reader is denied without changing the serial or picking.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await pickingRequest(
          readerPage,
          "validate_stock_picking",
          companyId,
          pickingId,
        )
        expect(denial.status()).toBe(403)
        expect(await fetchPickingState(page, pickingId)).toBe("done")
        expect(await fetchSerialById(page, serialId)).toMatchObject({
          state: "in_use",
        })
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
