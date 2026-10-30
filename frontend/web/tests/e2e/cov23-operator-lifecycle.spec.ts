import { expect, request as playwrightRequest, test, type Browser, type Page, type Response } from "@playwright/test"

import { toCreateCompanyParams } from "@lumiere/erp-shared/settings-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { bootstrapFixtureAccountSession } from "./fixture-account"
import { postGeneratedOperationOk } from "./generated-operation"
import {
  fetchSessionOrganizationId,
  fetchDefaultCompanyId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  chooseSelectOptionByTriggerValue,
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
  const grant = reducer === "assign_role"
  await expect(checkbox).toHaveAttribute("aria-checked", grant ? "false" : "true")
  await checkbox.click()
  await expect(checkbox).toHaveAttribute("aria-checked", grant ? "true" : "false")
  const [accepted] = await Promise.all([
    // Settings saves the complete revision-bound access snapshot atomically.
    page.waitForResponse((response) => matchesOperationResponse(response, "erp.set_member_access"), { timeout: 30_000 }),
    page.getByTestId("settings-user-save").click(),
  ])
  expect(accepted.ok(), await accepted.text()).toBe(true)
  return accepted
}

/**
 * Setup through the authenticated generated operation (session-scoped, contract-validated).
 * The Settings → Roles → Create Role form cannot be used: it posts `create_role` without the
 * CreateRoleParams type name, so optional fields reach the module un-encoded and the call
 * fails with HTTP 500 ("invalid type: string ... metadata"). Granting is still driven in the UI.
 */
async function createRoleViaOperation(page: Page, name: string, permission: string): Promise<number> {
  await postGeneratedOperationOk(page, "create_role", {
    params: stdbParamsToJson(
      {
        name,
        description: null,
        parentId: null,
        permissions: [permission],
        isActive: true,
        metadata: null,
      },
      "CreateRoleParams",
    ),
  })
  const created = (await rows(page, "/api/query/roles")).filter((row) => row.name === name)
  expect(created).toHaveLength(1)
  const roleId = scalarQueryId(created[0]?.id)
  if (roleId == null) throw new Error("created role has no id")
  return roleId
}

/**
 * Setup through the generated operations. The Settings forms for these two steps are not usable
 * here: Add existing user (role ID) posts the identity as a bare "0x…" string and fails with
 * HTTP 500 (the module expects an identity object), and the Settings → Organization → Create
 * company button sends no request in this build. Grant, switch, revoke and recovery are UI-driven.
 */
async function createBranchCompany(page: Page, name: string): Promise<number> {
  const defaultCompanyId = await fetchDefaultCompanyId(page)
  const parent = (await rows(page, "/api/query/companies")).find(
    (row) => scalarQueryId(row.id) === defaultCompanyId,
  )
  const currencyId = scalarQueryId(parent?.currencyId ?? parent?.currency_id)
  if (currencyId == null) throw new Error("default company has no currency")
  const params = toCreateCompanyParams(
    {
      name,
      code: name.slice(-12),
      parentId: String(defaultCompanyId),
      currencyId: BigInt(currencyId),
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      isParent: false,
    },
    { currencyId: BigInt(currencyId) },
  )
  if (!params) throw new Error("company params rejected")
  await postGeneratedOperationOk(page, "create_company", {
    params: stdbParamsToJson(params as object, "CreateCompanyParams"),
  })
  await expect
    .poll(async () => (await rows(page, "/api/query/companies")).filter((row) => row.name === name).length, {
      timeout: 30_000,
    })
    .toBe(1)
  const id = scalarQueryId((await rows(page, "/api/query/companies")).find((row) => row.name === name)?.id)
  if (id == null) throw new Error("created company has no id")
  return id
}

async function addMemberViaOperation(page: Page, identityHex: string, roleName: string) {
  await postGeneratedOperationOk(page, "add_org_member", {
    userIdentity: { __identity__: `0x${identityHex}` } as never,
    params: stdbParamsToJson(
      {
        roleName,
        companyId: BigInt(await fetchDefaultCompanyId(page)),
        jobTitle: null,
        departmentId: null,
        employeeId: null,
        isActive: true,
        isDefault: true,
        metadata: null,
      },
      "AddOrgMemberParams",
    ),
  })
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
  // Setup: a role granting a capability the persona does not hold.
  const roleName = smokeName("cov23-life-role")
  const roleId = await createRoleViaOperation(page, roleName, "dashboard:settings:read")

  // The persona signs in ONCE and keeps this session for the whole lifecycle.
  const personaContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const persona = await personaContext.newPage()
    await signIn(persona, personaEmail, personaPassword)
    await afterPersonaSignIn?.(persona)
    const profileVisible = async () => {
      await persona.reload({ waitUntil: "domcontentloaded" })
      await gotoModule(persona, "/settings")
      // isVisible() ignores its timeout; give the permission-filtered client
      // content time to hydrate before accepting an absent capability.
      return persona.getByTestId("settings-section-profile")
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true, () => false)
    }
    expect(await profileVisible()).toBe(false)

    // 1. Operator grants the role in Settings; the live session converges without re-login.
    await toggleRoleInSettings(page, roleId, "assign_role", personaEmail)
    await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(1)
    await expect.poll(profileVisible, { timeout: 60_000 }).toBe(true)

    // 2. Operator switches to a new branch company through the switcher.
    const branchName = smokeName("cov23-life-branch")
    const branchId = await createBranchCompany(page, branchName)

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
    try {
      // A failed UI wait can leave its real grant behind. Revoke only this run's
      // uniquely created role so retries and other role specs retain their baseline.
      const active = (await roleAssignments(page, organizationId, roleId)).filter((assignment) => assignment.isActive)
      for (const assignment of active) {
        if (assignment.id == null) throw new Error("active lifecycle assignment has no canonical id")
        await postGeneratedOperationOk(page, "revoke_role", { assignmentId: assignment.id })
      }
      await expect.poll(() => activeAssignmentCount(page, organizationId, roleId), { timeout: 30_000 }).toBe(0)
    } finally {
      await personaContext.close()
    }
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
      // Currency readiness proves hydration completed before filling controlled inputs.
      const submit = owner.locator('form button[type="submit"]')
      await expect(owner.locator("#currency")).toBeEnabled({ timeout: 30_000 })
      await expect(submit).toBeDisabled()
      // Company accounting settings are explicit choices, not hidden USD/UTC defaults.
      await chooseSelectOptionByTriggerValue(owner, owner.locator("#currency"), "USD")
      await chooseSelectOptionByTriggerValue(owner, owner.locator("#timezone"), "Africa/Kigali")
      await owner.getByLabel("Month (1–12)", { exact: true }).fill("6")
      await owner.getByLabel("Day", { exact: true }).fill("30")
      const setupConfirmation = owner.getByRole("checkbox", { name: "I have checked the base currency, company timezone and fiscal year-end.", exact: true })
      await expect(setupConfirmation).toBeVisible()
      await setupConfirmation.check({ timeout: 15_000 })
      await expect(submit).toBeEnabled()
      await owner.locator("#name").fill(orgName)
      const shortCode = suffix.replace(/[^a-z0-9]/g, "").slice(-8).toUpperCase()
      await owner.locator("#code").fill(shortCode)
      await expect(owner.locator("#code")).toHaveValue(shortCode)
      expect(await owner.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true)
      const [bootstrap] = await Promise.all([
        owner.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/bootstrap/tenant",
          { timeout: 60_000 },
        ),
        submit.click(),
      ])
      expect(bootstrap.ok(), await bootstrap.text()).toBe(true)
      expect(bootstrap.request().postDataJSON()).toMatchObject({
        organization: { timezone: "Africa/Kigali" },
        defaultCompanyCurrencyCode: "USD",
        fiscalYearEndMonth: 6,
        fiscalYearEndDay: 30,
      })
      await expect(owner.getByTestId("dashboard-sidebar").first()).toBeVisible({ timeout: 60_000 })
      await expect(owner).not.toHaveURL(/\/onboarding/)

      const organizationId = await fetchSessionOrganizationId(owner)
      const memberships = await rows(owner, "/api/query/user-organization")
      expect(memberships.map((row) => scalarQueryId(row.organizationId ?? row.organization_id))).toEqual([
        organizationId,
      ])
      // Let the post-bootstrap redirect and refresh finish before navigating again.
      await owner.waitForLoadState("networkidle")
      await expect(async () => {
        await gotoModule(owner, "/settings")
      }).toPass({ timeout: 60_000 })
      await expect(owner.getByTestId("settings-section-users")).toBeVisible({ timeout: 30_000 })

      // A base role is seeded; the owner then admits the second account by generated operation (the Settings add-member form fails, see helper).
      const baseRole = smokeName("c23-base")
      await createRoleViaOperation(owner, baseRole, "dashboard:tasks:read")
      await addMemberViaOperation(owner, identities[memberEmail], baseRole)

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
