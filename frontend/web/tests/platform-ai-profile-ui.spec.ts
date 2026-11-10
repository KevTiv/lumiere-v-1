import { expect, test } from "@playwright/test"

const model = {
  provider: "mistral", model: "generation-test-1", max_tokens: 2048,
  context_window: 32000, timeout_ms: 30000, max_concurrency: 2,
  input_cost_per_1k_microunits: 100, output_cost_per_1k_microunits: 200,
}
const profile = {
  id: 1, template_key: "alpha-default", template_version: 1,
  generation_profile: model, review_profile: { ...model, model: "review-test-1" },
  currency: "USD", monthly_limit_units: 5000000, rate_limit_per_minute: 10,
  max_enrolled_organizations: 20,
}

test("profile form preserves reviewed values, blocks invalid models and submits one new version", async ({ page }) => {
  const writes: unknown[] = []
  await page.route("**/api/ai/harness/profile", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON())
      return route.fulfill({ status: 409, json: { error: "Profile version changed; reload before publishing" } })
    }
    return route.fulfill({ json: { active_template: profile, templates: [{ id: 1, template_key: "alpha-default", template_version: 1 }] } })
  })
  await page.goto("/platform-ai-profile")
  await expect(page.locator('[name="template_version"]')).toHaveValue("2")
  await expect(page.locator('[name="monthly_limit_units"]')).toHaveValue("5000000")
  await page.locator('[name="review_profile.model"]').fill(model.model)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole("alert")).toContainText("distinct review model")
  expect(writes).toHaveLength(0)
  await page.locator('[name="review_profile.model"]').fill("review-test-2")
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole("alert")).toContainText("Profile version changed")
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ template_version: 2, monthly_limit_units: 5000000 })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
