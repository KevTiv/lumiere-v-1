import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { fetchDefaultCompanyId, signIn, smokeName } from "./helpers"
import {
  cancelReplenishmentRunViaUi,
  createInternalLocation,
  createProductFixture,
  createReplenishmentRuleViaUi,
  fetchReplenishmentRuleIdByLocation,
  fetchReplenishmentScheduledRunJobId,
  scheduleReplenishmentRunViaUi,
} from "./inventory-quant-fixtures"

function personaPassword(): string {
  const password = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD
  if (!password) {
    throw new Error("E2E_FIRST_ORG_PERSONA_PASSWORD is required")
  }
  return password
}

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
      const password = personaPassword()

      await signIn(page, "test@email.com", password)
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
          password,
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
          password,
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
