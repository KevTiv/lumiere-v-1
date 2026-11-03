import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { fetchSessionOrganizationId } from "./helpers"

// Production registry UI with synthetic boundaries; no provider calls or ERP writes.
async function registry(page: Page) {
  const organizationId = await fetchSessionOrganizationId(page)
  const skillId = 900001
  const versionId = 900002
  const sourceHash = `sha256:${"a".repeat(64)}`
  const runtimeHash = `sha256:${"b".repeat(64)}`
  const manifest = {
    limits: { max_steps: 8, max_tool_calls: 12 },
    output_types: ["analytics.report_analysis.result.v1"],
    permissions: ["report:read"],
    resources: ["analytics.report_analysis.v1"],
    risk: "green", schema_version: 1, skill_key: "report_analysis",
    source_hash: sourceHash, version: "1.0.0",
  }
  const data: Record<string, unknown[]> = {
    "ai-skills": [{ id: skillId, organizationId, skillKey: "report_analysis", name: "Native validation proof", category: "analytics", isSystem: false }],
    "ai-skill-versions": [{ id: versionId, skillId, version: "1.0.8", risk: "green" }],
    "ai-skill-fixtures": [{ id: 900003, skillId, name: "Grounded synthetic report" }],
    "ai-skill-releases": [],
  }
  for (const [resource, rows] of Object.entries(data)) {
    await page.route(`**/api/query/${resource}`, (route) => route.fulfill({ json: { data: rows } }))
  }
  await page.route("**/api/ai/knowledge/skill-promotions/company/*", (route) => route.fulfill({ json: { data: [] } }))
  await page.route("**/api/ai/skills/certifications*", (route) => {
    if (new URL(route.request().url()).searchParams.get("view") === "native-bindings") {
      return route.fulfill({ json: { runtimeHash, certificationConfigured: true, bindings: [{ skillKey: "report_analysis", adapterMajor: 1, manifest }] } })
    }
    return route.fulfill({ json: { data: [{ id: 900004, skillVersionId: versionId, fixtureId: 900003,
      status: "Completed", hasCurrentPassingEvidence: true, readiness: { ready: true, code: "ready" },
      evidence: { id: 900005, skillVersionId: versionId, fixtureId: 900003, status: "Passed" } }] } })
  })
  return { skillId, versionId, sourceHash, runtimeHash, manifest }
}

test("activation requires a human note and confirmation and preserves server rejection", { tag: ["@p0", "@ai-registry"] }, async ({ page }) => {
  const { versionId } = await registry(page)
  const { urlPath } = stdbBffCommandPost("promote_ai_skill_version", { skillVersionId: versionId, reason: "proof" })
  const submissions: unknown[] = []
  await page.route(`**${urlPath}`, async (route) => {
    submissions.push(route.request().postDataJSON())
    await route.fulfill({ status: 403, json: { error: "Current administrator authority is required" } })
  })
  await page.goto("/ai-skills")
  await page.getByRole("button", { name: "Review and activate", exact: true }).click()
  const dialog = page.getByRole("dialog")
  const activate = dialog.getByRole("button", { name: "Activate certified skill", exact: true })
  await expect(activate).toBeDisabled()
  await dialog.getByRole("textbox", { name: "Validation note", exact: true }).fill("Reviewed the synthetic fixture and intended scope")
  await expect(activate).toBeDisabled()
  expect(submissions).toHaveLength(0)
  await dialog.getByRole("checkbox").check()
  await activate.click()
  await expect(dialog.getByRole("alert")).toContainText("Current administrator authority is required")
  expect(submissions).toHaveLength(1)
  expect(JSON.stringify(submissions[0])).toContain("Reviewed the synthetic fixture and intended scope")
  await expect(dialog).toBeVisible()
})

test("new skill versions attach to the discovered harness without a manifest editor", { tag: ["@p0", "@ai-registry"] }, async ({ page }) => {
  const { skillId, sourceHash, runtimeHash } = await registry(page)
  const { urlPath } = stdbBffCommandPost("create_ai_skill_version", { params: { skill_id: skillId, manifest_json: "{}", review_notes: null, metadata: null } })
  let submitted = ""
  await page.route(`**${urlPath}`, async (route) => {
    submitted = route.request().postData() ?? ""
    await route.fulfill({ json: { ok: true } })
  })
  await page.goto("/ai-skills")
  await expect(page.getByRole("textbox", { name: "Skill version", exact: true })).toHaveValue("1.0.9")
  await page.getByRole("button", { name: "Prepare validation", exact: true }).click()
  await expect(page.getByText(/Attached to current harness/)).toBeVisible()
  const create = page.getByRole("button", { name: "Create version for validation", exact: true })
  await expect(create).toBeDisabled()
  await page.getByRole("textbox", { name: "Validation note", exact: true }).fill("Prepared using the current harness")
  await create.click()
  await expect.poll(() => submitted).toContain(sourceHash)
  expect(submitted).toContain(runtimeHash)
  expect(submitted).toContain("1.0.9")
})

test("a changed harness requires another review before creating the version", { tag: ["@p0", "@ai-registry"] }, async ({ page }) => {
  const { manifest } = await registry(page)
  let commands = 0
  await page.route("**/api/operations/**", async (route) => {
    commands++
    await route.fulfill({ status: 500, json: { error: "No command should be sent" } })
  })
  await page.goto("/ai-skills")
  await page.getByRole("button", { name: "Prepare validation", exact: true }).click()
  await expect(page.getByText(/Attached to current harness/)).toBeVisible()
  await page.getByRole("textbox", { name: "Validation note", exact: true }).fill("Prepared before the harness changed")
  manifest.source_hash = `sha256:${"c".repeat(64)}`
  await page.getByRole("button", { name: "Create version for validation", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("The harness changed")
  expect(commands).toBe(0)
})
