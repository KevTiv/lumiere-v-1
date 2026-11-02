import { expect, test } from "@playwright/test"
import type { BrowserContext, Page } from "@playwright/test"
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

// Fixture teardown has its own budget, outside the scenario's 180 seconds.
// Playwright retains a scenario failure even if a context also fails to close.
const qualityTest = test.extend<{
  personaPages: { warehouse: Page; reader: Page }
}>({
  personaPages: [async ({ browser }, use) => {
    const contexts: BrowserContext[] = []
    try {
      const warehouse = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      contexts.push(warehouse)
      const reader = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      contexts.push(reader)
      await use({ warehouse: await warehouse.newPage(), reader: await reader.newPage() })
    } finally {
      const results = await Promise.allSettled(contexts.map((context) => context.close()))
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
      if (failures.length) throw new AggregateError(failures, "Quality-check persona context cleanup failed")
    }
  }, { timeout: 30_000 }],
})

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

qualityTest.describe(
  "COV-06g exact quality-check fail quarantine",
  { tag: ["@p0", "@cov06", "@cov06g", "@unauthenticated"] },
  () => {
    qualityTest("warehouse persona fails a quality check with exact quarantine quant convergence", async ({
      page,
      personaPages: { warehouse: warehousePage, reader: readerPage },
    }) => {
      qualityTest.setTimeout(180_000)

      const companyId = await qualityTest.step("Sign in fixture owner and resolve company", async () => {
        await signIn(page, "test@email.com", PERSONA_PASSWORD)
        return fetchDefaultCompanyId(page)
      }, { timeout: 30_000 })

      const { productId, sourceLocationId, qcName, qcLocationId, checkId } = await qualityTest.step("Create exact product, locations, source quant and quality check", async () => {
        const productName = smokeName("cov06g-product")
        const productId = await createProductFixture(page, productName)
        const sourceLocationId = await createInternalLocation(page, smokeName("cov06g-src"))
        const qcName = smokeName("cov06g-qc")
        const qcLocationId = await createInternalLocation(page, qcName)
        await createStockQuantFixture(page, companyId, productId, sourceLocationId, smokeName("cov06g-quant"), 10)
        const checkName = smokeName("cov06g-check")
        await createQualityCheckViaUi(page, productName, checkName)
        const checkId = await fetchQualityCheckIdByName(page, checkName)
        expect(await fetchQuantsAtProductLocation(page, productId, qcLocationId)).toEqual([])
        return { productId, sourceLocationId, qcName, qcLocationId, checkId }
      }, { timeout: 60_000 })

      await qualityTest.step("Sign in warehouse persona", async () => {
        await signIn(warehousePage, "fixture.warehouse@example.test", PERSONA_PASSWORD)
      }, { timeout: 30_000 })

      await qualityTest.step("Fail exact quality check through quarantine UI", async () => {
        await failQualityCheckViaUi(warehousePage, checkId, qcName, "Damaged in transit")
      }, { timeout: 45_000 })

      const quarantineQuant = await qualityTest.step("Verify exact quarantine and source quantities and canonical focus", async () => {
        let quant = (await fetchQuantsAtProductLocation(page, productId, qcLocationId))[0]
        await expect.poll(async () => {
          const rows = await fetchQuantsAtProductLocation(page, productId, qcLocationId)
          quant = rows[0]
          return rows.length
        }, { timeout: 30_000 }).toBe(1)
        if (!quant) throw new Error("Expected one quarantine quant")
        expect(quant).toMatchObject({ productId, locationId: qcLocationId, quantity: 1, availableQuantity: 0 })
        expect(await fetchQuantsAtProductLocation(page, productId, sourceLocationId))
          .toMatchObject([{ quantity: 9, availableQuantity: 9 }])
        await expectCanonicalQuantFocus(warehousePage, quant.id)
        return quant
      }, { timeout: 45_000 })

      await qualityTest.step("Reject stale warehouse replay without changing either quant", async () => {
        const staleReplay = await failQualityCheckRequest(warehousePage, companyId, checkId, qcLocationId)
        expect(staleReplay.status()).toBe(422)
        expect(await fetchQuantsAtProductLocation(page, productId, qcLocationId)).toEqual([quarantineQuant])
        expect(await fetchQuantsAtProductLocation(page, productId, sourceLocationId))
          .toMatchObject([{ quantity: 9, availableQuantity: 9 }])
      }, { timeout: 30_000 })

      await qualityTest.step("Sign in limited reader persona", async () => {
        await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      }, { timeout: 30_000 })

      await qualityTest.step("Deny limited reader mutation and preserve quarantine quant", async () => {
        const denial = await failQualityCheckRequest(readerPage, companyId, checkId, qcLocationId)
        expect(denial.status()).toBe(403)
        expect(await fetchQuantsAtProductLocation(page, productId, qcLocationId)).toEqual([quarantineQuant])
      }, { timeout: 30_000 })
    })
  },
)
