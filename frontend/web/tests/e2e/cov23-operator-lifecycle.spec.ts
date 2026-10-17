import { expect, test, type Page, type Response } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-23 — one operator lifecycle: grant, live-session convergence, company
// switch, revoke, live-session revocation, and recovery by re-grant.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const TARGET_EMAIL = "fixture.hr-project@example.test"

type Row = Record<string, unknown>

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function roleAssignments(page: Page, organizationId: number, roleId: number) {
  return (await rows(page, "/api/query/user-role-assignment"))
    .filter(
      (row) =>
        scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
        scalarQueryId(row.roleId ?? row.role_id) === roleId,
    )
    .map((row) => ({
      id: scalarQueryId(row.id),
      isActive: (row.isActive ?? row.is_active) === true,
    }))
}

async function activeAssignmentCount(page: Page, organizationId: number, roleId: number) {
  return (await roleAssignments(page, organizationId, roleId)).filter((a) => a.isActive).length
}

async function toggleRoleInSettings(page: Page, roleId: number, reducer: string): Promise<Response> {
  await gotoModule(page, "/settings")
  await page.getByTestId("settings-section-users").click()
  await page.getByTestId("settings-users-search").fill(TARGET_EMAIL)
  const actions = page.getByTestId(`settings-user-actions-${TARGET_EMAIL}`)
  await expect(actions).toBeVisible({ timeout: 30_000 })
  await actions.click()
  await page.getByTestId("settings-user-edit").click()
  const checkbox = page.getByTestId(`settings-user-role-${roleId}`)
  await expect(checkbox).toBeVisible()
  await checkbox.click()
  const [accepted] = await Promise.all([
    page.waitForResponse((response) => matchesOperationResponse(response, reducer), { timeout: 30_000 }),
    page.getByTestId("settings-user-save").click(),
  ])
  expect(accepted.ok()).toBe(true)
  return accepted
}

async function activeCompanyId(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("lumiere:active-company")
    return raw ? Number((JSON.parse(raw) as { companyId?: number }).companyId) : null
  })
}

test.describe("COV-23 operator lifecycle", { tag: ["@p0", "@cov23", "@unauthenticated"] }, () => {
  test("grant, company switch, revoke and recovery converge on one live persona session", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const defaultCompanyId = await fetchDefaultCompanyId(page)
    const defaultCompany = (await rows(page, "/api/query/companies")).find(
      (row) => scalarQueryId(row.id) === defaultCompanyId,
    )
    const currencyId = scalarQueryId(defaultCompany?.currencyId ?? defaultCompany?.currency_id)
    if (currencyId == null) throw new Error("default company has no currency")

    // Setup only: a role granting a capability the persona does not already hold.
    const roleName = smokeName("cov23-life-role")
    await callReducerBff(page, "create_role", [organizationId, {
      name: roleName,
      description: "COV-23 operator lifecycle proof",
      parent_id: null,
      permissions: ["dashboard:settings:read"],
      is_active: true,
      metadata: null,
    }])
    const created = (await rows(page, "/api/query/roles")).filter((row) => row.name === roleName)
    expect(created).toHaveLength(1)
    const roleId = scalarQueryId(created[0]?.id)
    if (roleId == null) throw new Error("created role has no id")

    // The persona signs in ONCE and keeps this session for the whole lifecycle.
    const personaContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const persona = await personaContext.newPage()
      await signIn(persona, TARGET_EMAIL, PERSONA_PASSWORD)
      const profileVisible = async () => {
        await persona.reload({ waitUntil: "domcontentloaded" })
        await gotoModule(persona, "/settings")
        return persona.getByTestId("settings-section-profile").isVisible({ timeout: 10_000 })
      }
      expect(await profileVisible()).toBe(false)

      // 1. Operator grants the role in Settings; the live session converges without re-login.
      await toggleRoleInSettings(page, roleId, "assign_role")
      await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(1)
      await expect.poll(profileVisible, { timeout: 60_000 }).toBe(true)

      // 2. Operator switches to a new branch company through the switcher.
      const branchName = smokeName("cov23-life-branch")
      await callReducerBff(page, "create_company", [organizationId, {
        name: branchName,
        code: smokeName("c23l").slice(-12),
        currency_id: currencyId,
        fiscal_year_end_month: 12,
        fiscal_year_end_day: 31,
        is_parent: false,
        parent_id: { some: defaultCompanyId },
        tax_id: { none: [] },
        company_registry: { none: [] },
        address_street: { none: [] },
        address_city: { none: [] },
        address_zip: { none: [] },
        address_country_code: { some: "NL" },
        metadata: { some: JSON.stringify({ fixture: "COV-23", purpose: "operator-lifecycle" }) },
      }])
      await expect.poll(async () =>
        (await rows(page, "/api/query/companies")).find((row) => row.name === branchName) ?? null,
        { timeout: 30_000 }).not.toBeNull()
      const branchId = scalarQueryId(
        (await rows(page, "/api/query/companies")).find((row) => row.name === branchName)?.id,
      )
      if (branchId == null) throw new Error("branch company has no id")

      const adminPage = await page.context().newPage()
      try {
        await gotoModule(adminPage, "/settings")
        await expect(adminPage.getByTestId("company-switcher-trigger")).toBeVisible({ timeout: 45_000 })
        await adminPage.getByTestId("company-switcher-trigger").click()
        await adminPage.getByTestId(`company-switcher-option-${branchId}`).click()
        await expect.poll(() => activeCompanyId(adminPage)).toBe(branchId)

        // 3. Revoke while the switch is in force; the switch must not mask or revive access.
        await toggleRoleInSettings(adminPage, roleId, "revoke_role")
        await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(0)
        expect(await activeCompanyId(adminPage)).toBe(branchId)
      } finally {
        await adminPage.close()
      }

      // The SAME persona session loses the capability on its next load (no re-login),
      // by reload and by direct navigation to the settings route.
      await expect.poll(profileVisible, { timeout: 60_000 }).toBe(false)
      await persona.goto("/settings", { waitUntil: "domcontentloaded" })
      await expect(persona.getByTestId("settings-section-profile")).toBeHidden()
      await expect(persona.getByTestId("settings-section-users")).toBeHidden()

      // 4. Recovery: re-grant converges the same live session back, with one active assignment.
      await toggleRoleInSettings(page, roleId, "assign_role")
      await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(1)
      await expect.poll(profileVisible, { timeout: 60_000 }).toBe(true)
      expect(await activeAssignmentCount(page, organizationId, roleId)).toBe(1)
    } finally {
      await personaContext.close()
    }
  })
})
