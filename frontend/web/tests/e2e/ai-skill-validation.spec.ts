import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { fetchSessionOrganizationId } from "./helpers"

// Publishing depends on the version and release, even if the retired endpoint is down.
async function registry(page: Page) {
  const organizationId = await fetchSessionOrganizationId(page)
  const skillId = 900001
  const versionId = 900002
  const data: Record<string, unknown[]> = {
    "ai-skills": [
      { id: skillId, organizationId, skillKey: "tenant_stock_review", name: "Tenant stock review", category: "analytics", isSystem: false },
      { id: 900003, organizationId, skillKey: "rag_generation", name: "RAG Generation", category: "analytics", isSystem: false },
    ],
    "ai-skill-versions": [{ id: versionId, skillId, version: "1.0.0", risk: "green" }],
    "ai-skill-releases": [],
  }
  for (const [resource, rows] of Object.entries(data)) {
    await page.route(`**/api/query/${resource}`, (route) => route.fulfill({ json: { data: rows } }))
  }
  await page.route("**/api/ai/knowledge/skill-promotions/company/*", (route) => route.fulfill({ json: { data: [] } }))
  const certificationRequests: string[] = []
  await page.route("**/api/ai/skills/certifications*", (route) => {
    certificationRequests.push(route.request().url())
    return route.fulfill({ status: 503 })
  })
  return { versionId, certificationRequests }
}

test("activation requires a human note and confirmation and preserves server rejection", { tag: ["@p0", "@ai-registry"] }, async ({ page }) => {
  const { versionId, certificationRequests } = await registry(page)
  const { urlPath } = stdbBffCommandPost("promote_ai_skill_version", { skillVersionId: versionId, reason: "proof" })
  const submissions: unknown[] = []
  await page.route(`**${urlPath}`, async (route) => {
    submissions.push(route.request().postDataJSON())
    await route.fulfill({ status: 403, json: { error: "Current administrator authority is required" } })
  })
  await page.goto("/ai-skills")
  await page.getByRole("button", { name: "Review and activate", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const activate = dialog.getByRole("button", { name: "Activate skill version", exact: true })
  await expect(activate).toBeDisabled()
  await dialog.getByRole("textbox", { name: "Approval note", exact: true }).fill("Reviewed the skill version and intended scope")
  await expect(activate).toBeDisabled()
  expect(submissions).toHaveLength(0)
  await dialog.getByRole("checkbox").check()
  await activate.click()
  await expect(dialog.getByRole("alert")).toContainText("Current administrator authority is required")
  expect(submissions).toHaveLength(1)
  expect(JSON.stringify(submissions[0])).toContain("Reviewed the skill version and intended scope")
  await expect(dialog).toBeVisible()
  expect(certificationRequests).toEqual([])
})
