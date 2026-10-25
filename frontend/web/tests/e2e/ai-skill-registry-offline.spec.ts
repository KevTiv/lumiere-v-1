import { expect, test } from "@playwright/test"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"
import { fetchSessionOrganizationId, scalarQueryId, smokeName } from "./helpers"
import { matchesOperationResponse } from "./operation-response"

test("registered skill administration survives an unavailable AI runtime", { tag: ["@p0", "@ai-registry"] }, async ({ page }) => {
  test.setTimeout(120_000)
  let runtimeCatalogRequests = 0
  await page.route("**/api/ai/skills", async (route) => {
    runtimeCatalogRequests += 1
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "AI execution is disabled" }) })
  })
  const organizationId = await fetchSessionOrganizationId(page)
  const skillKey = smokeName("offline-registry")
  const name = smokeName("Registered skill")
  await page.goto("/ai-skills")
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await page.getByTestId("ai-skills-create").click()
  const modal = page.getByTestId("form-modal-ai-skills-create")
  await modal.getByLabel("Skill key", { exact: true }).fill(skillKey)
  await modal.getByLabel("Name", { exact: true }).fill(name)
  await modal.getByLabel("Prompt template", { exact: true }).fill("Read-only test skill. Do not run a provider.")
  const [created] = await Promise.all([
    page.waitForResponse((response) => matchesOperationResponse(response, "create_ai_skill")),
    modal.getByRole("button", { name: /^create skill$/i }).click(),
  ])
  expect(created.ok(), await created.text()).toBe(true)
  await expect(modal).toBeHidden()
  await expect(page.getByText(name, { exact: true })).toBeVisible()

  const readback = await page.request.get("/api/query/ai-skills")
  expect(readback.ok(), await readback.text()).toBe(true)
  const body = await readback.json() as { data: QueryRowFor<"ai-skills">[] }
  const registered = body.data.filter((row) => row.skillKey === skillKey)
  expect(registered).toHaveLength(1)
  expect(scalarQueryId(registered[0]!.id)).toBeGreaterThan(0)
  expect(Number(registered[0]!.organizationId)).toBe(organizationId)

  await page.reload()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  expect(runtimeCatalogRequests).toBe(0)
})
