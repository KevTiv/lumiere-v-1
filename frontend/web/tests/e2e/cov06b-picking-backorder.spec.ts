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
  fetchPickingMoves,
} from "./sales-order-fixtures"
import {
  expectCanonicalPickingFocus,
  fetchPickingBackorderIds,
  fetchPickingBackorderParentId,
  fetchPickingMoveStates,
  fetchPickingState,
  partialValidatePickingViaInventoryUi,
  runPickingActionViaInventoryUi,
} from "./inventory-picking-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function validateBackorderRequest(
  page: Page,
  companyId: number,
  pickingId: number,
) {
  const { urlPath, init } = stdbBffCommandPost(
    "validate_stock_picking_backorder",
    {
      pickingId,
      params: stdbParamsToJson(
        { companyId: BigInt(companyId) },
        "CompanyScopeParams",
      ),
    },
  )
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06b exact picking backorder",
  { tag: ["@p0", "@cov06", "@cov06b", "@unauthenticated"] },
  () => {
    test("warehouse persona partially validates one picking and resolves one exact backorder", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const orderId = await createDraftSaleOrder(
        page,
        smokeName("cov06b-backorder"),
      )
      await addLaptopLine(page, orderId, "2")
      await confirmOrderViaUi(page, orderId)

      const initialPickings = await fetchOrderPickings(page, orderId)
      expect(initialPickings).toHaveLength(1)
      const [source] = initialPickings
      if (source == null) throw new Error("Expected one delivery picking")
      const sourcePickingId = source.id

      expect(await fetchPickingBackorderIds(page, sourcePickingId)).toEqual([])

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
          sourcePickingId,
          "confirm",
        )
        await runPickingActionViaInventoryUi(
          warehousePage,
          sourcePickingId,
          "assign",
        )

        const assignedMoves = await fetchPickingMoveStates(
          page,
          sourcePickingId,
        )
        expect(assignedMoves).toHaveLength(1)
        const [sourceMove] = assignedMoves
        if (sourceMove == null) throw new Error("Expected one assigned move")

        const moveDemand = await fetchPickingMoves(page, sourcePickingId)
        expect(moveDemand).toEqual([{ id: sourceMove.id, demand: 2 }])

        await partialValidatePickingViaInventoryUi(
          warehousePage,
          sourcePickingId,
          sourceMove.id,
          1,
        )

        let backorderIds: number[] = []
        await expect
          .poll(
            async () => {
              backorderIds = await fetchPickingBackorderIds(
                page,
                sourcePickingId,
              )
              return backorderIds
            },
            { timeout: 30_000 },
          )
          .toHaveLength(1)

        const [backorderId] = backorderIds
        if (backorderId == null) throw new Error("Expected one backorder")

        await expectCanonicalPickingFocus(warehousePage, backorderId)

        expect(await fetchPickingState(page, sourcePickingId)).toBe("done")
        expect(await fetchPickingState(page, backorderId)).toBe("draft")
        expect(
          await fetchPickingBackorderParentId(page, backorderId),
        ).toBe(sourcePickingId)

        const sourceMovesAfter = await fetchPickingMoveStates(
          page,
          sourcePickingId,
        )
        expect(sourceMovesAfter).toHaveLength(1)
        expect(sourceMovesAfter[0]).toMatchObject({
          id: sourceMove.id,
          state: "done",
          isDone: true,
        })

        const backorderMoves = await fetchPickingMoves(page, backorderId)
        expect(backorderMoves).toHaveLength(1)
        expect(backorderMoves[0]?.demand).toBe(1)
        expect(await fetchOrderDeliveredQty(page, orderId)).toBe(1)

        const orderPickings = await fetchOrderPickings(page, orderId)
        expect(orderPickings.map((picking) => picking.id).sort((a, b) => a - b)).toEqual(
          [sourcePickingId, backorderId].sort((a, b) => a - b),
        )

        const staleReplay = await validateBackorderRequest(
          warehousePage,
          companyId,
          sourcePickingId,
        )
        expect(staleReplay.status()).toBe(422)
        expect(
          await fetchPickingBackorderIds(page, sourcePickingId),
        ).toEqual([backorderId])

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await validateBackorderRequest(
          readerPage,
          companyId,
          sourcePickingId,
        )
        expect(denial.status()).toBe(403)
        expect(
          await fetchPickingBackorderIds(page, sourcePickingId),
        ).toEqual([backorderId])
        expect(
          await fetchPickingBackorderParentId(page, backorderId),
        ).toBe(sourcePickingId)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
