import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  createLotTrackedProductFixture,
  createStockProductionLotFixture,
  createStockQuantFixture,
  expectCanonicalQuantFocus,
  fetchLotById,
  fetchQuantById,
  moveQuantViaInventoryUi,
  setStockProductionLotLocked,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function moveQuantRequest(
  page: Page,
  companyId: number,
  quantId: number,
  targetLocationId: number,
  quantity: number,
) {
  const { urlPath, init } = stdbBffCommandPost("move_stock_quant", {
    quantId,
    params: stdbParamsToJson({
      company_id: BigInt(companyId),
      dest_location_id: BigInt(targetLocationId),
      quantity,
    } as object),
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06e exact lot-tracked quant move",
  { tag: ["@p0", "@cov06", "@cov06e", "@unauthenticated"] },
  () => {
    test("warehouse persona relocates a lot-tracked quant and the lot's location converges; a locked lot blocks the move", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productName = smokeName("cov06e-lot-product")
      const productId = await createLotTrackedProductFixture(page, productName)
      const sourceName = smokeName("cov06e-src")
      const targetName = smokeName("cov06e-dst")
      const sourceLocationId = await createInternalLocation(page, sourceName)
      const targetLocationId = await createInternalLocation(page, targetName)

      const lotId = await createStockProductionLotFixture(
        page,
        companyId,
        productId,
        smokeName("cov06e-lot"),
      )
      const quantId = await createStockQuantFixture(
        page,
        companyId,
        productId,
        sourceLocationId,
        smokeName("cov06e-quant"),
        4,
        lotId,
      )

      expect(await fetchQuantById(page, quantId)).toMatchObject({
        id: quantId,
        productId,
        locationId: sourceLocationId,
        quantity: 4,
        availableQuantity: 4,
        reservedQuantity: 0,
      })
      expect(await fetchLotById(page, lotId)).toMatchObject({
        id: lotId,
        isLocked: false,
      })

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

        // Lock the lot: quarantined stock must not relocate.
        await setStockProductionLotLocked(page, companyId, lotId, true)
        const lockedAttempt = await moveQuantRequest(
          warehousePage,
          companyId,
          quantId,
          targetLocationId,
          4,
        )
        expect(lockedAttempt.status()).toBe(422)
        expect(await fetchQuantById(page, quantId)).toMatchObject({
          locationId: sourceLocationId,
          quantity: 4,
        })

        // Unlock and relocate the full quant: the quant's identity (id, lot)
        // is preserved because no destination quant exists yet, so the raw
        // quant relocates in place rather than being replaced.
        await setStockProductionLotLocked(page, companyId, lotId, false)

        await moveQuantViaInventoryUi(warehousePage, quantId, targetName, 4)

        await expect
          .poll(
            async () => (await fetchQuantById(page, quantId))?.locationId,
            { timeout: 30_000 },
          )
          .toBe(targetLocationId)

        expect(await fetchQuantById(page, quantId)).toMatchObject({
          id: quantId,
          productId,
          locationId: targetLocationId,
          quantity: 4,
          availableQuantity: 4,
          reservedQuantity: 0,
        })

        await expectCanonicalQuantFocus(warehousePage, quantId)

        // The lot's own denormalized location follows its now-emptied source.
        await expect
          .poll(async () => (await fetchLotById(page, lotId))?.locationId, {
            timeout: 30_000,
          })
          .toBe(targetLocationId)

        // The limited reader is denied without changing the relocated quant.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await moveQuantRequest(
          readerPage,
          companyId,
          quantId,
          sourceLocationId,
          4,
        )
        expect(denial.status()).toBe(403)
        expect(await fetchQuantById(page, quantId)).toMatchObject({
          locationId: targetLocationId,
          quantity: 4,
        })
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
