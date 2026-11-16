import { expect, test } from "@playwright/test"
import { fetchDefaultCompanyId } from "./helpers"

test("report composer retries a failed catalog and selects the newly loaded default", async ({ page }) => {
  let catalogAvailable = false
  await page.route("**/api/reports/catalog", async (route) => {
    if (!catalogAvailable) {
      await route.fulfill({ status: 503, json: { error: "Catalog unavailable" } })
      return
    }
    await route.fulfill({
      json: {
        catalogSchemaVersion: 1,
        reports: [{
          key: "daily_business_summary_v1",
          title: "Daily business summary",
          schemaVersion: 1,
          availability: "preview",
          mandatorySections: [],
          authoritativeSources: [],
          maxWindowDays: 1,
        }],
      },
    })
  })

  await page.goto("/ai-harness?tab=report-composer")
  const unavailable = page.getByRole("alert").filter({ hasText: "The report catalog could not be loaded." })
  await expect(unavailable).toBeVisible()
  await expect(page.getByTestId("report-composer-run")).toHaveCount(0)

  catalogAvailable = true
  await unavailable.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByTestId("report-composer-report-trigger")).toContainText("Daily business summary")
  await expect(unavailable).toHaveCount(0)
})

test("skills runs use selected-company reads and show a cancellation rejection on the selected row", async ({ page }) => {
  const companyId = await fetchDefaultCompanyId(page)
  const runId = "901"
  let runsAvailable = false
  await page.route((url) => url.pathname === "/api/query/ai-agent-runs", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("companyId")).toBe(String(companyId))
    if (!runsAvailable) {
      await route.fulfill({ status: 503, json: { error: "Runs unavailable" } })
      return
    }
    await route.fulfill({ json: { data: [{ id: runId, companyId, runKey: "Selected company run", status: "running" }] } })
  })
  await page.route("**/api/operations/erp.cancel_ai_agent_run", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ companyId, runId })
    await route.fulfill({ status: 409, json: { error: "This run has already finished." } })
  })

  await page.goto("/ai-skills")
  const panel = page.getByTestId("ai-agent-runs-panel")
  const unavailable = panel.getByRole("alert").filter({ hasText: "Agent runs could not be loaded for this company." })
  await expect(unavailable).toBeVisible()
  runsAvailable = true
  await unavailable.getByRole("button", { name: "Retry" }).click()

  const run = panel.getByRole("listitem").filter({ hasText: "Selected company run" })
  await run.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(run.getByRole("alert")).toHaveText("This run has already finished.")
})

test("skills assignments distinguish unavailable and verified empty lists", async ({ page }) => {
  let assignmentsAvailable = false
  await page.route("**/api/query/ai-team-member-skills", async (route) => {
    await route.fulfill(assignmentsAvailable
      ? { json: { data: [] } }
      : { status: 503, json: { error: "Assignments unavailable" } })
  })

  await page.goto("/ai-skills")
  const assignments = page.getByTestId("ai-skill-assignments-panel")
  const unavailable = assignments.getByRole("alert")
  await expect(unavailable).toContainText("Skill assignments are unavailable.")
  await expect(assignments.getByTestId("ai-skills-assign")).toBeDisabled()
  await expect(assignments.getByText("No skill assignments yet.")).toHaveCount(0)

  assignmentsAvailable = true
  await unavailable.getByRole("button", { name: "Retry" }).click()
  await expect(unavailable).toHaveCount(0)
  await expect(assignments.getByText("No skill assignments yet.")).toBeVisible()
})
