import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { signIn, smokeName } from "./helpers"
import {
  createSerialTrackedProductFixture,
  createSerialViaUi,
  expectCanonicalSerialFocus,
  fetchSerialById,
  fetchSerialIdByName,
  reserveSerialViaUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function reserveSerialRequest(page: Page, serialId: number) {
  const { urlPath, init } = stdbBffCommandPost("reserve_serial", { serialId })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06i exact serial reserve lifecycle",
  { tag: ["@p0", "@cov06", "@cov06i", "@unauthenticated"] },
  () => {
    test("a UI-created serial starts free and the warehouse persona reserves it with exact state convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const productName = smokeName("cov06i-product")
      const productId = await createSerialTrackedProductFixture(page, productName)

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

        const serialName = smokeName("cov06i-serial")
        await createSerialViaUi(warehousePage, productId, serialName)
        const serialId = await fetchSerialIdByName(page, serialName)

        // The create action must produce a genuinely reservable serial —
        // "free" is the only state the reserve/use/block lifecycle
        // recognizes as a starting point.
        expect(await fetchSerialById(page, serialId)).toMatchObject({
          id: serialId,
          state: "free",
        })

        await reserveSerialViaUi(warehousePage, serialId)

        await expect
          .poll(async () => (await fetchSerialById(page, serialId))?.state, {
            timeout: 30_000,
          })
          .toBe("reserved")

        await expectCanonicalSerialFocus(warehousePage, serialId)

        // Exact replay is stale: the serial is no longer free.
        const staleReplay = await reserveSerialRequest(warehousePage, serialId)
        expect(staleReplay.status()).toBe(422)
        expect(await fetchSerialById(page, serialId)).toMatchObject({
          state: "reserved",
        })

        // The limited reader is denied without changing the serial.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await reserveSerialRequest(readerPage, serialId)
        expect(denial.status()).toBe(403)
        expect(await fetchSerialById(page, serialId)).toMatchObject({
          state: "reserved",
        })
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
