import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { fetchDefaultCompanyId, fetchFirstUomId, scalarQueryId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  expectCanonicalQuantFocus,
  fetchQuantsAtProductLocation,
  findProductIdByName,
  runCycleCountToPostedViaWizardUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function fetchPostedCycleCountIdByLocation(
  page: Page,
  locationId: number,
): Promise<number> {
  const response = await page.request.get("/api/query/stock-cycle-counts")
  if (!response.ok()) throw new Error("Failed to query cycle counts")
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) =>
      scalarQueryId(row.locationId ?? row.location_id) === locationId &&
      String(row.state ?? "") === "posted",
  )
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one posted cycle count at location ${locationId}, got ${matches.length}`,
    )
  }
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error("Posted cycle count has no id")
  return id
}

async function postCycleCountAdjustmentsRequest(
  page: Page,
  companyId: number,
  cycleCountId: number,
) {
  const { urlPath, init } = stdbBffCommandPost("post_cycle_count_adjustments", {
    companyId,
    cycleCountId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06d exact cycle-count quant adjustment",
  { tag: ["@p0", "@cov06", "@cov06d", "@unauthenticated"] },
  () => {
    test("warehouse persona posts a cycle count with exact quant convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productId = await findProductIdByName(page, "Lumiere Dev Laptop")
      const uomId = await fetchFirstUomId(page)
      const locationName = smokeName("cov06d-loc")
      const locationId = await createInternalLocation(page, locationName)

      expect(
        await fetchQuantsAtProductLocation(page, productId, locationId),
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

        await runCycleCountToPostedViaWizardUi(warehousePage, {
          locationId,
          productId,
          uomId,
          countedQty: 8,
        })

        let created = (
          await fetchQuantsAtProductLocation(page, productId, locationId)
        )[0]
        await expect
          .poll(
            async () => {
              const rows = await fetchQuantsAtProductLocation(
                page,
                productId,
                locationId,
              )
              created = rows[0]
              return rows.length
            },
            { timeout: 30_000 },
          )
          .toBe(1)

        if (!created) throw new Error("Expected exactly one adjusted quant")

        expect(created).toMatchObject({
          productId,
          locationId,
          quantity: 8,
          availableQuantity: 8,
          reservedQuantity: 0,
        })

        await expectCanonicalQuantFocus(warehousePage, created.id)

        const cycleCountId = await fetchPostedCycleCountIdByLocation(
          page,
          locationId,
        )

        // Exact replay is stale: the cycle count is already posted.
        const staleReplay = await postCycleCountAdjustmentsRequest(
          warehousePage,
          companyId,
          cycleCountId,
        )
        expect(staleReplay.status()).toBe(422)
        expect(
          await fetchQuantsAtProductLocation(page, productId, locationId),
        ).toEqual([created])

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await postCycleCountAdjustmentsRequest(
          readerPage,
          companyId,
          cycleCountId,
        )
        expect(denial.status()).toBe(403)

        expect(
          await fetchQuantsAtProductLocation(page, productId, locationId),
        ).toEqual([created])
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
