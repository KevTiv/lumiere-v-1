import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { signIn, smokeName } from "./helpers"
import {
  blockSerialViaUi,
  createSerialTrackedProductFixture,
  createSerialViaUi,
  fetchSerialById,
  fetchSerialIdByName,
  reserveSerialViaUi,
  useSerialViaUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function useSerialRequest(page: Page, serialId: number) {
  const { urlPath, init } = stdbBffCommandPost("use_serial", { serialId })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06l exact serial use/block lifecycle",
  { tag: ["@p0", "@cov06", "@cov06l", "@unauthenticated"] },
  () => {
    test("warehouse persona marks a reserved serial in use and blocks a free one, both with exact state convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const productName = smokeName("cov06l-product")
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

        // use_serial: free -> reserved -> in_use.
        const useSerialName = smokeName("cov06l-use-serial")
        await createSerialViaUi(warehousePage, productId, useSerialName)
        const useSerialId = await fetchSerialIdByName(page, useSerialName)
        await reserveSerialViaUi(warehousePage, useSerialId)
        await expect
          .poll(async () => (await fetchSerialById(page, useSerialId))?.state, {
            timeout: 30_000,
          })
          .toBe("reserved")

        await useSerialViaUi(warehousePage, useSerialId)
        await expect
          .poll(async () => (await fetchSerialById(page, useSerialId))?.state, {
            timeout: 30_000,
          })
          .toBe("in_use")

        // Exact replay is stale: the serial is no longer reserved.
        const staleReplay = await useSerialRequest(warehousePage, useSerialId)
        expect(staleReplay.status()).toBe(422)
        expect(await fetchSerialById(page, useSerialId)).toMatchObject({
          state: "in_use",
        })

        // The limited reader is denied without changing the serial.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await useSerialRequest(readerPage, useSerialId)
        expect(denial.status()).toBe(403)
        expect(await fetchSerialById(page, useSerialId)).toMatchObject({
          state: "in_use",
        })

        // block_serial: free -> blocked directly, no reserve/use required.
        const blockSerialName = smokeName("cov06l-block-serial")
        await createSerialViaUi(warehousePage, productId, blockSerialName)
        const blockSerialId = await fetchSerialIdByName(page, blockSerialName)
        expect(await fetchSerialById(page, blockSerialId)).toMatchObject({
          state: "free",
        })

        await blockSerialViaUi(warehousePage, blockSerialId, "Damaged in transit")
        await expect
          .poll(async () => (await fetchSerialById(page, blockSerialId))?.state, {
            timeout: 30_000,
          })
          .toBe("blocked")
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
