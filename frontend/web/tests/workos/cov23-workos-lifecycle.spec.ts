import { existsSync } from "node:fs"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"

const ADMIN_STATE = path.resolve(process.cwd(), "../../.tmp/workos/admin.json")

type Row = Record<string, unknown>

test.skip(!existsSync(ADMIN_STATE), "capture the admin WorkOS session first (see scripts/workos-docker-stack.sh)")
test.use({ storageState: ADMIN_STATE })

function id(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function openSettingsSection(page: Page, name: RegExp) {
  await page.goto("/settings")
  await expect(page.getByTestId("dashboard-sidebar")).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole("button", { name }).first().click()
  await expect(page.getByRole("button", { name: /back to settings/i })).toBeVisible({ timeout: 30_000 })
}

test.describe("COV-23 WorkOS organization lifecycle", { tag: ["@cov23", "@workos"] }, () => {
  test("first sign-in provisioned exactly one organization, owner assignment and default company", async ({ page }) => {
    await page.goto("/settings")
    const memberships = (await rows(page, "user-organization")).filter((row) => row.isActive !== false)
    expect(memberships).toHaveLength(1)
    const membership = memberships[0]!
    expect(membership.isDefault).toBe(true)
    const organizationId = id(membership.organizationId)
    const roleId = id(membership.roleId)
    expect(organizationId).not.toBeNull()

    const assignments = (await rows(page, "user-roles")).filter(
      (row) => id(row.organizationId) === organizationId && row.isActive !== false,
    )
    expect(assignments).toHaveLength(1)
    expect(id(assignments[0]!.roleId)).toBe(roleId)
    const role = (await rows(page, "roles")).find((row) => id(row.id) === roleId)
    expect(role?.isSystem).toBe(true)
    expect(String(role?.name ?? "").toLowerCase()).toBe("owner")

    const companies = (await rows(page, "companies")).filter((row) => id(row.organizationId) === organizationId)
    expect(companies.filter((row) => row.code === "ALPHA")).toHaveLength(1)
  })

  test("settings expose the organization, user and role sections to the owner", async ({ page }) => {
    await openSettingsSection(page, /^Organization/i)
    await expect(page.getByTestId("settings-admin-action-createCompany")).toBeVisible({ timeout: 30_000 })
    await openSettingsSection(page, /User Management/i)
    await expect(page.getByText(/Users \(1\)/)).toBeVisible({ timeout: 30_000 })
    await openSettingsSection(page, /Roles & Permissions/i)
    await expect(page.getByRole("button", { name: /create role/i })).toBeVisible({ timeout: 30_000 })
  })

  test("the operator creates a second company and switches to it, and the switch survives a reload", async ({ page }) => {
    const code = `C23${Date.now().toString(36).toUpperCase().slice(-6)}`
    const name = `COV23 company ${code}`
    await openSettingsSection(page, /^Organization/i)
    const form = page.locator("form").filter({ has: page.getByTestId("form-submit-settings-company-create") })
    await expect(form).toBeVisible({ timeout: 30_000 })
    await form.getByTestId("form-field-name").fill(name)
    await form.getByTestId("form-field-code").fill(code)
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("erp.create_company") && r.request().method() === "POST"),
      form.getByTestId("form-submit-settings-company-create").click(),
    ])
    expect(created.status()).toBeLessThan(400)

    const company = await expect
      .poll(async () => (await rows(page, "companies")).filter((row) => row.code === code).length, { timeout: 30_000 })
      .toBe(1)
      .then(async () => (await rows(page, "companies")).find((row) => row.code === code)!)
    const companyId = id(company.id)!
    expect(String(company.name)).toBe(name)

    // The switcher is interactive once there is more than one company.
    await page.goto("/accounting")
    await expect(page.getByTestId("company-switcher-trigger")).toBeVisible({ timeout: 30_000 })
    await page.getByTestId("company-switcher-trigger").click()
    const scoped: string[] = []
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith("/api/query/") && url.searchParams.get("companyId") === String(companyId)) {
        scoped.push(url.pathname)
      }
    })
    await page.getByTestId(`company-switcher-option-${companyId}`).click()
    await expect.poll(() => scoped.length, { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByTestId("company-switcher-trigger")).toContainText(name)

    await page.reload()
    await expect(page.getByTestId("company-switcher-trigger")).toContainText(name, { timeout: 30_000 })
  })

  test("the operator creates a custom role that persists exactly once", async ({ page }) => {
    const roleName = `cov23-role-${Date.now().toString(36)}`
    const before = (await rows(page, "roles")).length
    await openSettingsSection(page, /Roles & Permissions/i)
    await page.getByRole("button", { name: /^Create Role$/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.locator("input[name='name'], #name").first().fill(roleName)
    await dialog.locator("textarea[name='description'], #description").first().fill("COV-23 acceptance role")
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("create_role") && r.request().method() === "POST"),
      dialog.getByRole("button", { name: /^Create Role$/i }).click(),
    ])
    expect(created.status()).toBeLessThan(400)
    await expect
      .poll(async () => (await rows(page, "roles")).filter((row) => row.name === roleName).length, { timeout: 30_000 })
      .toBe(1)
    expect((await rows(page, "roles")).length).toBe(before + 1)
    const role = (await rows(page, "roles")).find((row) => row.name === roleName)!
    expect(role.isSystem).toBe(false)
  })
})
