import { expect, request as playwrightRequest, test, type Browser, type Page, type Response } from "@playwright/test"

import { bootstrapFixtureAccountSession } from "./fixture-account"
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

async function toggleRoleInSettings(page: Page, roleId: number, reducer: string, targetEmail = TARGET_EMAIL): Promise<Response> {
  await gotoModule(page, "/settings")
  await page.getByTestId("settings-section-users").click()
  await page.getByTestId("settings-users-search").fill(targetEmail)
  const actions = page.getByTestId(`settings-user-actions-${targetEmail}`)
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

async function runGrantSwitchRevokeRecover(
  browser: Browser,
  page: Page,
  personaEmail: string,
  personaPassword: string,
  afterPersonaSignIn?: (persona: Page) => Promise<void>,
) {
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
    await signIn(persona, personaEmail, personaPassword)
    await afterPersonaSignIn?.(persona)
    const profileVisible = async () => {
      await persona.reload({ waitUntil: "domcontentloaded" })
      await gotoModule(persona, "/settings")
      return persona.getByTestId("settings-section-profile").isVisible({ timeout: 10_000 })
    }
    expect(await profileVisible()).toBe(false)

    // 1. Operator grants the role in Settings; the live session converges without re-login.
    await toggleRoleInSettings(page, roleId, "assign_role", personaEmail)
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
      await toggleRoleInSettings(adminPage, roleId, "revoke_role", personaEmail)
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
    await toggleRoleInSettings(page, roleId, "assign_role", personaEmail)
    await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(1)
    await expect.poll(profileVisible, { timeout: 60_000 }).toBe(true)
    expect(await activeAssignmentCount(page, organizationId, roleId)).toBe(1)

    // Leave shared fixtures clean: a final UI revoke must also converge the live session.
    await toggleRoleInSettings(page, roleId, "revoke_role", personaEmail)
    await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(0)
    await expect.poll(profileVisible, { timeout: 60_000 }).toBe(false)
  } finally {
    await personaContext.close()
  }
}

test.describe("COV-23 operator lifecycle", { tag: ["@p0", "@cov23"] }, () => {
  test("grant, company switch, revoke and recovery converge on one live persona session", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    await runGrantSwitchRevokeRecover(browser, page, TARGET_EMAIL, PERSONA_PASSWORD)
  })

  test("bootstrap through onboarding, then grant, switch, revoke and recover in the new organization", async ({
    browser,
  }) => {
    test.setTimeout(300_000)
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
    const password = "Password123$"
    const suffix = smokeName("c23-boot").toLowerCase()
    const ownerEmail = `${suffix}-owner@example.test`
    const memberEmail = `${suffix}-member@example.test`

    // Trusted setup only: org-less fixture accounts (public registration is disabled).
    const identities: Record<string, string> = {}
    for (const email of [ownerEmail, memberEmail]) {
      const isolated = await playwrightRequest.newContext({ baseURL })
      try {
        identities[email] = await bootstrapFixtureAccountSession(isolated, email, password)
      } finally {
        await isolated.dispose()
      }
    }

    const ownerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const owner = await ownerContext.newPage()

      // 1. Bootstrap: an organization-less account creates its organization in the onboarding UI.
      await owner.goto("/sign-in")
      await owner.getByLabel(/email/i).fill(ownerEmail)
      await owner.getByLabel(/password/i).fill(password)
      await owner.getByRole("button", { name: /sign in/i }).click()
      await expect(owner).not.toHaveURL(/\/sign-in(?:\?|$)/, { timeout: 30_000 })
      if (!/\/onboarding/.test(owner.url())) await owner.goto("/onboarding")
      await expect(owner).toHaveURL(/\/onboarding/)
      const orgName = `COV23 ${suffix}`
      await owner.locator("#name").fill(orgName)
      await owner.locator("#code").fill(suffix.replace(/[^a-z0-9]/g, "").slice(-10))
      const bootstrap = owner.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/bootstrap/tenant" && response.ok(),
        { timeout: 60_000 },
      )
      await owner.locator('form button[type="submit"]').click()
      await bootstrap
      await expect(owner.getByTestId("dashboard-sidebar").first()).toBeVisible({ timeout: 60_000 })
      await expect(owner).not.toHaveURL(/\/onboarding/)

      const organizationId = await fetchSessionOrganizationId(owner)
      const memberships = await rows(owner, "/api/query/user-organization")
      expect(memberships.map((row) => scalarQueryId(row.organizationId ?? row.organization_id))).toEqual([
        organizationId,
      ])
      // Let the post-bootstrap redirect and refresh finish before navigating again.
      await owner.waitForLoadState("networkidle")
      await gotoModule(owner, "/settings")
      await expect(owner.getByTestId("settings-section-users")).toBeVisible({ timeout: 30_000 })

      // Setup in the new organization: a base role, then the second account as a member of it.
      const baseRole = smokeName("c23-base")
      await callReducerBff(owner, "create_role", [organizationId, {
        name: baseRole,
        description: "COV-23 bootstrap lifecycle base role",
        parent_id: null,
        permissions: ["organization:read"],
        is_active: true,
        metadata: null,
      }])
      await callReducerBff(owner, "add_org_member", [
        identities[memberEmail],
        organizationId,
        {
          role_name: baseRole,
          company_id: await fetchDefaultCompanyId(owner),
          job_title: null,
          department_id: null,
          employee_id: null,
          is_active: true,
          is_default: true,
          metadata: null,
        },
      ])

      // 2-5. Grant, company switch, revoke and recovery in the freshly bootstrapped organization.
      await runGrantSwitchRevokeRecover(browser, owner, memberEmail, password, async (member) => {
        // The member's own profile update projects their email into the new organization's
        // profile row, which is what the Settings Users list searches.
        const projected = await member.request.patch("/api/auth/profile", {
          data: { name: "COV23 Bootstrap Member" },
        })
        expect(projected.ok(), await projected.text()).toBe(true)
      })
    } finally {
      await ownerContext.close()
    }
  })
})
