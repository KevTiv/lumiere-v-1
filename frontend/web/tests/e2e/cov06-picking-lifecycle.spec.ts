import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  addLaptopLine,
  confirmOrderViaUi,
  createDraftSaleOrder,
  fetchOrderDeliveredQty,
  fetchOrderPickings,
} from "./sales-order-fixtures"
import {
  expectCanonicalPickingFocus,
  fetchPickingMoveStates,
  fetchPickingState,
  runPickingActionViaInventoryUi,
} from "./inventory-picking-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type PickingReducer =
  | "confirm_stock_picking"
  | "assign_stock_picking"
  | "validate_stock_picking"

async function pickingRequest(
  page: Page,
  reducer: PickingReducer,
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
  "COV-06 stock picking lifecycle",
  { tag: ["@p0", "@cov06", "@unauthenticated"] },
  () => {
    test("warehouse persona drives one exact picking draft → confirmed → assigned → done", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      // Setup creates one normal outgoing picking; the claimed COV-06 transitions
      // below are all warehouse-operator actions in Inventory.
      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const orderId = await createDraftSaleOrder(
        page,
        smokeName("cov06-picking"),
      )
      await addLaptopLine(page, orderId, "1")
      await confirmOrderViaUi(page, orderId)

      const initialPickings = await fetchOrderPickings(page, orderId)
      expect(initialPickings).toHaveLength(1)
      const [initialPicking] = initialPickings
      if (initialPicking == null) throw new Error("Expected one delivery picking")
      const pickingId = initialPicking.id

      expect(await fetchPickingState(page, pickingId)).toBe("draft")
      const initialMoves = await fetchPickingMoveStates(page, pickingId)
      expect(initialMoves.length).toBeGreaterThan(0)
      const moveIds = initialMoves.map((move) => move.id)

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

        await runPickingActionViaInventoryUi(
          warehousePage,
          pickingId,
          "confirm",
        )
        await expectCanonicalPickingFocus(warehousePage, pickingId)
        await expect
          .poll(() => fetchPickingState(page, pickingId), {
            timeout: 30_000,
          })
          .toBe("confirmed")
        expect(
          (await fetchPickingMoveStates(page, pickingId)).map((move) => move.id),
        ).toEqual(moveIds)

        const staleConfirm = await pickingRequest(
          warehousePage,
          "confirm_stock_picking",
          companyId,
          pickingId,
        )
        expect(staleConfirm.status()).toBe(422)
        expect(await fetchPickingState(page, pickingId)).toBe("confirmed")

        await runPickingActionViaInventoryUi(
          warehousePage,
          pickingId,
          "assign",
        )
        await expectCanonicalPickingFocus(warehousePage, pickingId)
        await expect
          .poll(() => fetchPickingState(page, pickingId), {
            timeout: 30_000,
          })
          .toBe("assigned")
        expect(
          (await fetchPickingMoveStates(page, pickingId)).map((move) => move.id),
        ).toEqual(moveIds)

        const staleAssign = await pickingRequest(
          warehousePage,
          "assign_stock_picking",
          companyId,
          pickingId,
        )
        expect(staleAssign.status()).toBe(422)
        expect(await fetchPickingState(page, pickingId)).toBe("assigned")

        await runPickingActionViaInventoryUi(
          warehousePage,
          pickingId,
          "validate",
        )
        await expectCanonicalPickingFocus(warehousePage, pickingId)
        await expect
          .poll(() => fetchPickingState(page, pickingId), {
            timeout: 30_000,
          })
          .toBe("done")

        const completedMoves = await fetchPickingMoveStates(page, pickingId)
        expect(completedMoves.map((move) => move.id)).toEqual(moveIds)
        expect(completedMoves.every((move) => move.state === "done")).toBe(true)
        expect(completedMoves.every((move) => move.isDone)).toBe(true)
        expect(await fetchOrderDeliveredQty(page, orderId)).toBe(1)
        expect((await fetchOrderPickings(page, orderId)).map((p) => p.id)).toEqual([
          pickingId,
        ])

        const staleValidate = await pickingRequest(
          warehousePage,
          "validate_stock_picking",
          companyId,
          pickingId,
        )
        expect(staleValidate.status()).toBe(422)
        expect(await fetchPickingState(page, pickingId)).toBe("done")
        expect(
          (await fetchPickingMoveStates(page, pickingId)).map((move) => move.id),
        ).toEqual(moveIds)

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
        expect((await fetchOrderPickings(page, orderId)).map((p) => p.id)).toEqual([
          pickingId,
        ])
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
