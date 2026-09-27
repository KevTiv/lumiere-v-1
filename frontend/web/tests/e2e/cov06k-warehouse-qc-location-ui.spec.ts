import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { fetchDefaultCompanyId, fetchFirstWarehouseId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  fetchWarehouseQcLocationId,
  setWarehouseQcLocationViaUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function updateWarehouseRequest(
  page: Page,
  companyId: number,
  warehouseId: number,
  qcLocationId: number,
) {
  const { urlPath, init } = stdbBffCommandPost("update_warehouse", {
    companyId,
    warehouseId,
    params: stdbParamsToJson(
      { whQcStockLocId: { some: qcLocationId } } as object,
      "UpdateWarehouseParams",
    ),
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06k exact warehouse QC location configuration",
  { tag: ["@p0", "@cov06", "@cov06k", "@unauthenticated"] },
  () => {
    test("an admin configures a warehouse's QC location through the edit form and can clear it again", async ({
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const warehouseId = await fetchFirstWarehouseId(page)
      const locationName = smokeName("cov06k-qc-loc")
      const locationId = await createInternalLocation(page, locationName)

      expect(await fetchWarehouseQcLocationId(page, warehouseId)).toBeUndefined()

      await setWarehouseQcLocationViaUi(page, warehouseId, locationName)

      await expect
        .poll(() => fetchWarehouseQcLocationId(page, warehouseId), {
          timeout: 30_000,
        })
        .toBe(locationId)

      // Clear it back to unconfigured.
      await setWarehouseQcLocationViaUi(page, warehouseId, undefined)
      await expect
        .poll(() => fetchWarehouseQcLocationId(page, warehouseId), {
          timeout: 30_000,
        })
        .toBeUndefined()

      // The limited reader is denied without changing the warehouse.
      const readerContext = await page.context().browser()?.newContext({
        storageState: { cookies: [], origins: [] },
      })
      if (!readerContext) throw new Error("Expected a browser context")
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await updateWarehouseRequest(
          readerPage,
          companyId,
          warehouseId,
          locationId,
        )
        expect(denial.status()).toBe(403)
        expect(
          await fetchWarehouseQcLocationId(page, warehouseId),
        ).toBeUndefined()
      } finally {
        await readerContext.close()
      }
    })
  },
)
