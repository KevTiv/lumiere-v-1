import { expect, test } from "@playwright/test"

import {
  deletePivotReportViaUi,
  expectNoAppError,
  fetchFiscalYearIdByName,
  fillField,
  openFiscalSetupWizard,
  savePivotReportViaUi,
  smokeName,
  submitForm,
} from "./helpers"

test.describe(
  "Parity phase 4 — accounting and reports mutations",
  { tag: ["@p0", "@parity-phase-4"] },
  () => {
    test("runs fiscal setup wizard and creates a fiscal year", async ({ page }) => {
      test.setTimeout(120_000)

      const fiscalYearName = smokeName("fy")
      // Seed includes a fiscal year for the calendar year — use a unique far-future range.
      const year = 2150 + (Date.now() % 40)

      await openFiscalSetupWizard(page)
      await fillField(page, "fiscalYearName", fiscalYearName)
      await fillField(page, "dateFrom", `${year}-01-01`)
      await fillField(page, "dateTo", `${year}-12-31`)

      const [setupRes] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/call/setup_fiscal_calendar") && res.ok(),
          { timeout: 60_000 },
        ),
        submitForm(page, "fiscal-setup-wizard"),
      ])
      expect(setupRes.ok()).toBe(true)

      const fiscalYearId = await fetchFiscalYearIdByName(page, fiscalYearName)
      expect(fiscalYearId).toBeGreaterThan(0)

      await expectNoAppError(page)
    })

    test("saves and deletes a pivot report definition", async ({ page }) => {
      test.setTimeout(120_000)

      const reportName = smokeName("pivot")

      await savePivotReportViaUi(page, reportName)
      await deletePivotReportViaUi(page, reportName)

      await expectNoAppError(page)
    })
  },
)
