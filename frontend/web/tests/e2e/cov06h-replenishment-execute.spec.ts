import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  fetchContactIdByName,
  fetchDefaultCompanyId,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import {
  createInternalLocation,
  createProductFixture,
  createProductSupplierInfoFixture,
  createReplenishmentRuleViaUi,
  executeReplenishmentRuleViaUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const SEEDED_VENDOR_NAME = "Globex Corp"

async function fetchPurchaseOrderIdByPartnerRef(
  page: Page,
  partnerRef: string,
): Promise<number | undefined> {
  const response = await page.request.get("/api/query/purchase-orders")
  if (!response.ok()) return undefined
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const matches = (payload.data ?? []).filter(
    (row) => String(row.partnerRef ?? row.partner_ref ?? "") === partnerRef,
  )
  if (matches.length !== 1) return undefined
  return scalarQueryId(matches[0]?.id) ?? undefined
}

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
  "COV-06h exact replenishment buy-demand execution",
  { tag: ["@p0", "@cov06", "@cov06h", "@unauthenticated"] },
  () => {
    test("warehouse persona executes a replenishment rule with exact draft PO convergence", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const vendorId = await fetchContactIdByName(page, SEEDED_VENDOR_NAME)
      const currenciesRes = await page.request.get("/api/bootstrap/currencies")
      if (!currenciesRes.ok()) throw new Error("Failed to query currencies")
      const currencies = (await currenciesRes.json()) as {
        data?: Array<Record<string, unknown>>
      }
      const currencyId = scalarQueryId(currencies.data?.[0]?.id)
      if (currencyId == null) throw new Error("No currency in seed data")
      const productName = smokeName("cov06h-product")
      const productId = await createProductFixture(page, productName)
      const locationName = smokeName("cov06h-loc")
      const locationId = await createInternalLocation(page, locationName)

      // Below min at an empty location with a configured vendor: execute must
      // create a buy-demand draft PO, not an internal transfer.
      await createProductSupplierInfoFixture(
        page,
        productId,
        vendorId,
        currencyId,
        1,
        12,
      )

      await createReplenishmentRuleViaUi(page, productName, locationName, "10", "20")
      const ruleId = await fetchReplenishmentRuleIdByLocation(
        page,
        productId,
        locationId,
      )
      const partnerRef = `RPL-${ruleId}`

      expect(await fetchPurchaseOrderIdByPartnerRef(page, partnerRef)).toBeUndefined()

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

        let poId: number | undefined
        await expect
          .poll(
            async () => {
              poId = await fetchPurchaseOrderIdByPartnerRef(page, partnerRef)
              return poId
            },
            { timeout: 30_000 },
          )
          .toBeDefined()
        if (poId == null) throw new Error("Expected exactly one draft PO")

        // Idempotent replay with the SAME idempotency key: no second PO.
        const idempotentKey = `cov06h-replay-${ruleId}`
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
        expect(await fetchPurchaseOrderIdByPartnerRef(page, partnerRef)).toBe(poId)

        // The limited reader is denied without creating or changing any PO.
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denial = await executeReplenishmentRuleRequest(
          readerPage,
          companyId,
          ruleId,
          `cov06h-deny-${ruleId}`,
        )
        expect(denial.status()).toBe(403)
        expect(await fetchPurchaseOrderIdByPartnerRef(page, partnerRef)).toBe(poId)
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
