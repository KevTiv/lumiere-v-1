import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  createStockQuantFixture,
  expectCanonicalQuantFocus,
  fetchQuantById,
  fetchQuantsAtProductLocation,
  findProductIdByName,
  moveQuantViaInventoryUi,
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
  "COV-06c exact internal quant transfer",
  { tag: ["@p0", "@cov06", "@cov06c", "@unauthenticated"] },
  () => {
    test("warehouse persona moves stock with exact source/destination quant convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productId = await findProductIdByName(page, "Lumiere Dev Laptop")
      const sourceName = smokeName("cov06c-src")
      const targetName = smokeName("cov06c-dst")
      const sourceLocationId = await createInternalLocation(page, sourceName)
      const targetLocationId = await createInternalLocation(page, targetName)
      const sourceQuantId = await createStockQuantFixture(
        page,
        companyId,
        productId,
        sourceLocationId,
        smokeName("cov06c-quant"),
        3,
      )

      expect(await fetchQuantById(page, sourceQuantId)).toMatchObject({
        id: sourceQuantId,
        productId,
        locationId: sourceLocationId,
        quantity: 3,
        availableQuantity: 3,
        reservedQuantity: 0,
      })
      expect(
        await fetchQuantsAtProductLocation(page, productId, targetLocationId),
      ).toEqual([])

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

        await moveQuantViaInventoryUi(
          warehousePage,
          sourceQuantId,
          targetName,
          2,
        )

        let destination = (
          await fetchQuantsAtProductLocation(
            page,
            productId,
            targetLocationId,
          )
        )[0]
        await expect
          .poll(
            async () => {
              const rows = await fetchQuantsAtProductLocation(
                page,
                productId,
                targetLocationId,
              )
              destination = rows[0]
              return rows.length
            },
            { timeout: 30_000 },
          )
          .toBe(1)

        if (!destination) throw new Error("Expected one destination quant")

        await expectCanonicalQuantFocus(warehousePage, destination.id)

        expect(await fetchQuantById(page, sourceQuantId)).toMatchObject({
          id: sourceQuantId,
          productId,
          locationId: sourceLocationId,
          quantity: 1,
          availableQuantity: 1,
          reservedQuantity: 0,
        })
        expect(destination).toMatchObject({
          productId,
          locationId: targetLocationId,
          quantity: 2,
          availableQuantity: 2,
          reservedQuantity: 0,
        })
        expect(
          (await fetchQuantById(page, sourceQuantId))!.quantity +
            destination.quantity,
        ).toBe(3)

        // Exact replay is stale because only one unit remains at the source.
        const staleReplay = await moveQuantRequest(
          warehousePage,
          companyId,
          sourceQuantId,
          targetLocationId,
          2,
        )
        expect(staleReplay.status()).toBe(422)
        expect(await fetchQuantById(page, sourceQuantId)).toMatchObject({
          quantity: 1,
          locationId: sourceLocationId,
        })
        expect(
          await fetchQuantsAtProductLocation(
            page,
            productId,
            targetLocationId,
          ),
        ).toEqual([destination])

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await moveQuantRequest(
          readerPage,
          companyId,
          sourceQuantId,
          targetLocationId,
          1,
        )
        expect(denial.status()).toBe(403)

        expect(await fetchQuantById(page, sourceQuantId)).toMatchObject({
          quantity: 1,
          locationId: sourceLocationId,
        })
        expect(
          await fetchQuantsAtProductLocation(
            page,
            productId,
            targetLocationId,
          ),
        ).toEqual([destination])
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
