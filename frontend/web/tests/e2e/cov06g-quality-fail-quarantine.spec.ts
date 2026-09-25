import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { fetchDefaultCompanyId, scalarQueryId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  createProductFixture,
  createQualityCheckViaUi,
  createStockQuantFixture,
  expectCanonicalQuantFocus,
  failQualityCheckViaUi,
  fetchQuantsAtProductLocation,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function failQualityCheckRequest(
  page: Page,
  companyId: number,
  checkId: number,
  quarantineLocationId: number,
) {
  const { urlPath, init } = stdbBffCommandPost("fail_quality_check", {
    companyId,
    checkId,
    qtyFailed: 1,
    note: null,
    pictureFail: null,
    failureLocationId: quarantineLocationId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

async function fetchQualityCheckIdByName(
  page: Page,
  name: string,
): Promise<number> {
  const response = await page.request.get("/api/query/quality-checks")
  if (!response.ok()) throw new Error("Failed to query quality checks")
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) => String(row.name ?? "") === name,
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one quality check named ${name}, got ${matches.length}`)
  }
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error(`Quality check ${name} has no id`)
  return id
}

test.describe(
  "COV-06g exact quality-check fail quarantine",
  { tag: ["@p0", "@cov06", "@cov06g", "@unauthenticated"] },
  () => {
    test("warehouse persona fails a quality check with exact quarantine quant convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productName = smokeName("cov06g-product")
      const productId = await createProductFixture(page, productName)
      const sourceName = smokeName("cov06g-src")
      const sourceLocationId = await createInternalLocation(page, sourceName)
      const qcName = smokeName("cov06g-qc")
      const qcLocationId = await createInternalLocation(page, qcName)

      await createStockQuantFixture(
        page,
        companyId,
        productId,
        sourceLocationId,
        smokeName("cov06g-quant"),
        10,
      )

      const checkName = smokeName("cov06g-check")
      await createQualityCheckViaUi(page, productName, checkName)
      const checkId = await fetchQualityCheckIdByName(page, checkName)

      expect(
        await fetchQuantsAtProductLocation(page, productId, qcLocationId),
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

        await failQualityCheckViaUi(
          warehousePage,
          checkId,
          qcLocationId,
          "Damaged in transit",
        )

        let quarantineQuant = (
          await fetchQuantsAtProductLocation(page, productId, qcLocationId)
        )[0]
        await expect
          .poll(
            async () => {
              const rows = await fetchQuantsAtProductLocation(
                page,
                productId,
                qcLocationId,
              )
              quarantineQuant = rows[0]
              return rows.length
            },
            { timeout: 30_000 },
          )
          .toBe(1)
        if (!quarantineQuant) throw new Error("Expected one quarantine quant")

        expect(quarantineQuant).toMatchObject({
          productId,
          locationId: qcLocationId,
          quantity: 1,
          availableQuantity: 0,
        })

        expect(
          await fetchQuantsAtProductLocation(page, productId, sourceLocationId),
        ).toMatchObject([{ quantity: 9, availableQuantity: 9 }])

        await expectCanonicalQuantFocus(warehousePage, quarantineQuant.id)

        // Exact replay is stale: the check is already completed.
        const staleReplay = await failQualityCheckRequest(
          warehousePage,
          companyId,
          checkId,
          qcLocationId,
        )
        expect(staleReplay.status()).toBe(422)
        expect(
          await fetchQuantsAtProductLocation(page, productId, qcLocationId),
        ).toEqual([quarantineQuant])
        expect(
          await fetchQuantsAtProductLocation(page, productId, sourceLocationId),
        ).toMatchObject([{ quantity: 9, availableQuantity: 9 }])

        // The limited reader is denied without changing any quant.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await failQualityCheckRequest(
          readerPage,
          companyId,
          checkId,
          qcLocationId,
        )
        expect(denial.status()).toBe(403)
        expect(
          await fetchQuantsAtProductLocation(page, productId, qcLocationId),
        ).toEqual([quarantineQuant])
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
