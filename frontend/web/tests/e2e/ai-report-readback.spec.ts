import { expect, test } from "@playwright/test"
import { fetchDefaultCompanyId } from "./helpers"

const RUN_ID = 901
const savedRun = {
  runId: RUN_ID,
  status: "completed",
  stepCount: 1,
  tokensUsed: 15,
  transcript: [{ id: 71, stepNo: 1, toolName: "analytics.get_report_data", outputRowCount: 2, durationMs: 12, error: false }],
  economics: {
    providerModels: [{ provider: "mistral", model: "mistral-small-2603" }],
    providerModelsTruncated: false,
    attemptCount: 1,
    attemptStatuses: ["succeeded"],
    reservationStatuses: ["settled"],
    outcomeUnknown: false,
    inputTokens: 10,
    outputTokens: 5,
    currency: "USD",
    reservedUnits: 0,
    settledUnits: 42,
    truncated: false,
  },
}

// These UI regressions use synthetic inspection responses. They never run AI.
for (const outcome of ["success", "denied", "wrong-run"] as const) {
  test(`saved report readback: ${outcome}`, { tag: "@p0" }, async ({ page }) => {
    const companyId = await fetchDefaultCompanyId(page)
    const reads: unknown[] = []
    const unexpected: string[] = []
    await page.route("**/api/ai/**", async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path !== "/api/ai/evidence/runs/inspect") {
        unexpected.push(path)
        await route.abort()
        return
      }
      reads.push(route.request().postDataJSON())
      await route.fulfill({
        status: outcome === "denied" ? 403 : 200,
        json: outcome === "denied" ? { error: "private denial detail" }
          : { ...savedRun, runId: outcome === "wrong-run" ? RUN_ID + 1 : RUN_ID },
      })
    })
    await page.goto(`/ai-harness?tab=report-analysis&companyId=${companyId}&runId=${RUN_ID}`)
    if (outcome === "success") {
      await expect(page.getByText("Governed tool transcript", { exact: true })).toBeVisible()
      await expect(page.getByText("analytics.get_report_data", { exact: true })).toBeVisible()
      await expect(page.getByText("mistral / mistral-small-2603", { exact: true })).toBeVisible()
      await expect(page.getByText("0.000042 USD settled", { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText("0.000042 USD settled", { exact: true })).toBeVisible()
    } else {
      await expect(page.getByText("Transcript unavailable", { exact: true })).toBeVisible()
      await expect(page.getByText("analytics.get_report_data", { exact: true })).toHaveCount(0)
      await expect(page.getByText("private denial detail", { exact: true })).toHaveCount(0)
    }
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((body) => JSON.stringify(body) === JSON.stringify({ companyId, runId: RUN_ID }))).toBe(true)
    expect(unexpected).toEqual([])
  })
}
