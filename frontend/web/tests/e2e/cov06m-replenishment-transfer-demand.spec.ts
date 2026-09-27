import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { fetchDefaultCompanyId, scalarQueryId, signIn, smokeName } from "./helpers"
import {
  createInternalLocation,
  createProductFixture,
  createReplenishmentRuleViaUi,
  createStockQuantFixture,
  executeReplenishmentRuleViaUi,
} from "./inventory-quant-fixtures"
import { expectCanonicalPickingFocus } from "./inventory-picking-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function fetchReplenishmentRuleIdByLocation(
  page: Page,
  productId: number,
  locationId: number,
): Promise<number> {
  const response = await page.request.get("/api/query/replenishment-rules")
  if (!response.ok()) throw new Error("Failed to query replenishment rules")
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) =>
      scalarQueryId(row.productId ?? row.product_id) === productId &&
      scalarQueryId(row.locationId ?? row.location_id) === locationId,
  )
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one replenishment rule, got ${matches.length}`)
  }
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error("Replenishment rule has no id")
  return id
}

async function fetchTransferPickingIdByName(
  page: Page,
  name: string,
): Promise<number | undefined> {
  const response = await page.request.get("/api/query/stock-pickings")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) => String(row.name ?? "") === name,
  )
  if (matches.length !== 1) return undefined
  return scalarQueryId(matches[0]?.id) ?? undefined
}

async function executeReplenishmentRuleRequest(
  page: Page,
  companyId: number,
  ruleId: number,
  idempotencyKey: string,
) {
  const { urlPath, init } = stdbBffCommandPost("execute_replenishment_rule", {
    companyId,
    ruleId,
    idempotencyKey,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06m exact replenishment internal-transfer demand execution",
  { tag: ["@p0", "@cov06", "@cov06m", "@unauthenticated"] },
  () => {
    test("warehouse persona executes a replenishment rule with exact internal-transfer picking convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productName = smokeName("cov06m-product")
      const productId = await createProductFixture(page, productName)
      const sourceName = smokeName("cov06m-src")
      const sourceLocationId = await createInternalLocation(page, sourceName)
      const destName = smokeName("cov06m-dst")
      const destLocationId = await createInternalLocation(page, destName)

      // No vendor supplier info for this product: the transfer-demand path
      // fires instead of the buy-demand path, sourced from this location.
      await createStockQuantFixture(
        page,
        companyId,
        productId,
        sourceLocationId,
        smokeName("cov06m-quant"),
        20,
      )

      await createReplenishmentRuleViaUi(page, productName, destName, "10", "20")
      const ruleId = await fetchReplenishmentRuleIdByLocation(
        page,
        productId,
        destLocationId,
      )
      const pickingName = `INT-RPL-${ruleId}`

      expect(await fetchTransferPickingIdByName(page, pickingName)).toBeUndefined()

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

        await executeReplenishmentRuleViaUi(warehousePage, ruleId)

        let pickingId: number | undefined
        await expect
          .poll(
            async () => {
              pickingId = await fetchTransferPickingIdByName(page, pickingName)
              return pickingId
            },
            { timeout: 30_000 },
          )
          .toBeDefined()
        if (pickingId == null) throw new Error("Expected exactly one transfer picking")

        await expectCanonicalPickingFocus(warehousePage, pickingId)

        // Idempotent replay with the SAME idempotency key: no second picking.
        const idempotentKey = `cov06m-replay-${ruleId}`
        const first = await executeReplenishmentRuleRequest(
          warehousePage,
          companyId,
          ruleId,
          idempotentKey,
        )
        expect(first.ok()).toBe(true)
        const replay = await executeReplenishmentRuleRequest(
          warehousePage,
          companyId,
          ruleId,
          idempotentKey,
        )
        expect(replay.ok()).toBe(true)
        expect(await fetchTransferPickingIdByName(page, pickingName)).toBe(pickingId)

        // The limited reader is denied without creating or changing any picking.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await executeReplenishmentRuleRequest(
          readerPage,
          companyId,
          ruleId,
          `cov06m-deny-${ruleId}`,
        )
        expect(denial.status()).toBe(403)
        expect(await fetchTransferPickingIdByName(page, pickingName)).toBe(pickingId)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
