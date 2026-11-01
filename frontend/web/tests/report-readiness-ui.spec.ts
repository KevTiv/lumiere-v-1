import { expect, test } from "@playwright/test"

test("stale configuration blocks paid dispatch and a fresh check enables the production form", async ({ page }) => {
  let ready = false
  let paid = 0
  await page.route("**/api/query/ai-agents", (route) => route.fulfill({ json: { data: [{ id: 7, organizationId: 11, companyId: null, isActive: true, name: "Approved report agent" }] } }))
  await page.route("**/api/ai/skills/report-analysis/readiness", (route) => {
    const { companyId, agentId } = route.request().postDataJSON()
    return route.fulfill({ json: { companyId, agentId, status: ready ? "ready" : "blocked", code: ready ? null : "release_not_ready", billableCalls: 0 } })
  })
  await page.route("**/api/ai/skills/report-analysis", (route) => {
    paid++
    return route.fulfill({ status: 409, json: { error: "Configuration changed", analysisStarted: false,
      readiness: { companyId: 13, agentId: 7, status: "blocked", code: "release_not_ready", billableCalls: 0 } } })
  })
  await page.goto("/report-readiness")
  await page.getByRole("combobox", { name: "AI agent", exact: true }).click()
  await page.getByRole("option", { name: "Approved report agent", exact: true }).click()
  await page.getByRole("textbox").fill("Inspect available report evidence")
  await expect(page.getByText(/report skill release is missing, invalid or stale/i)).toBeVisible()
  await expect(page.getByRole("button", { name: "Analyze report", exact: true })).toBeDisabled()
  expect(paid).toBe(0)
  ready = true
  await page.getByRole("button", { name: "Check AI readiness", exact: true }).click()
  await expect(page.getByRole("button", { name: "Analyze report", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Analyze report", exact: true }).click()
  await expect(page.getByRole("button", { name: "Analyze report", exact: true })).toBeDisabled()
  await expect(page.getByText(/may have saved a run/i)).toHaveCount(0)
  expect(paid).toBe(1)
})

test("a late old-company readiness reply cannot enable the newly selected company", async ({ page }) => {
  let releaseOld!: () => void
  let beganOld!: () => void
  const oldStarted = new Promise<void>((resolve) => { beganOld = resolve })
  const oldReply = new Promise<void>((resolve) => { releaseOld = resolve })
  await page.route("**/api/query/ai-agents", (route) => route.fulfill({ json: { data: [{ id: 7, organizationId: 11, companyId: null, isActive: true, name: "Approved report agent" }] } }))
  await page.route("**/api/ai/skills/report-analysis/readiness", async (route) => {
    const { companyId, agentId } = route.request().postDataJSON()
    if (companyId === 13) { beganOld(); await oldReply }
    await route.fulfill({ json: { companyId, agentId, status: companyId === 13 ? "ready" : "blocked", code: companyId === 13 ? null : "skill_binding", billableCalls: 0 } }).catch(() => undefined)
  })
  await page.goto("/report-readiness")
  await page.getByRole("combobox", { name: "AI agent", exact: true }).click()
  await page.getByRole("option", { name: "Approved report agent", exact: true }).click()
  await oldStarted
  await page.getByRole("combobox", { name: "Company", exact: true }).click()
  await page.getByRole("option", { name: "Acceptance company", exact: true }).click()
  await page.getByRole("combobox", { name: "AI agent", exact: true }).click()
  await page.getByRole("option", { name: "Approved report agent", exact: true }).click()
  await page.getByRole("textbox").fill("Inspect available report evidence")
  await expect(page.getByText(/agent and policy binding is missing/i)).toBeVisible()
  releaseOld()
  await expect(page.getByRole("button", { name: "Analyze report", exact: true })).toBeDisabled()
  await expect(page.getByText(/agent and policy binding is missing/i)).toBeVisible()
})
