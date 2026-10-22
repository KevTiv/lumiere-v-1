import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  TEST_PASSWORD,
  fetchDefaultCompanyId,
  signIn,
  smokeName,
} from "./helpers"
import {
  cancelReplenishmentRunViaUi,
  createInternalLocation,
  createProductFixture,
  createReplenishmentRuleViaUi,
  fetchReplenishmentRuleIdByLocation,
  fetchReplenishmentScheduledRunJobId,
  scheduleReplenishmentRunViaUi,
} from "./inventory-quant-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? TEST_PASSWORD

async function scheduleRequest(
  page: Page,
  companyId: number,
  ruleId: number,
) {
  const { urlPath, init } = stdbBffCommandPost("schedule_replenishment_run", {
    companyId,
    ruleId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

async function cancelRequest(
  page: Page,
  companyId: number,
  ruleId: number,
) {
  const { urlPath, init } = stdbBffCommandPost("cancel_replenishment_run", {
    companyId,
    ruleId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

test.describe(
  "COV-06o replenishment scheduler lifecycle",
  { tag: ["@p0", "@cov06", "@cov06o", "@unauthenticated"] },
  () => {
    test("warehouse schedules and cancels with exact pointer readback, stale denial, and reader denial", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)
      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const productName = smokeName("cov06o-product")
      const productId = await createProductFixture(page, productName)
      const locationName = smokeName("cov06o-loc")
      const locationId = await createInternalLocation(page, locationName)

      await createReplenishmentRuleViaUi(
        page,
        productName,
        locationName,
        "10",
        "20",
      )
      const ruleId = await fetchReplenishmentRuleIdByLocation(
        page,
        productId,
        locationId,
      )
      expect(await fetchReplenishmentScheduledRunJobId(page, ruleId)).toBeNull()

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

        await scheduleReplenishmentRunViaUi(warehousePage, ruleId)

        let scheduledJobId: number | null = null
        await expect
          .poll(
            async () => {
              scheduledJobId = await fetchReplenishmentScheduledRunJobId(
                page,
                ruleId,
              )
              return scheduledJobId
            },
            { timeout: 30_000 },
          )
          .not.toBeNull()
        if (scheduledJobId == null) {
          throw new Error("Expected a scheduled replenishment job id")
        }

        const staleSchedule = await scheduleRequest(
          warehousePage,
          companyId,
          ruleId,
        )
        expect(staleSchedule.status()).toBe(422)
        expect(await fetchReplenishmentScheduledRunJobId(page, ruleId)).toBe(
          scheduledJobId,
        )

        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )

        const deniedCancel = await cancelRequest(readerPage, companyId, ruleId)
        expect(deniedCancel.status()).toBe(403)
        expect(await fetchReplenishmentScheduledRunJobId(page, ruleId)).toBe(
          scheduledJobId,
        )

        await cancelReplenishmentRunViaUi(warehousePage, ruleId)
        await expect
          .poll(
            () => fetchReplenishmentScheduledRunJobId(page, ruleId),
            { timeout: 30_000 },
          )
          .toBeNull()

        const deniedSchedule = await scheduleRequest(
          readerPage,
          companyId,
          ruleId,
        )
        expect(deniedSchedule.status()).toBe(403)
        expect(await fetchReplenishmentScheduledRunJobId(page, ruleId)).toBeNull()
      } finally {
        await readerContext.close()
        await warehouseContext.close()
      }
    })
  },
)
