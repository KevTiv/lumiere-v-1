import { expect, test, type Browser, type Page, type Request, type Response } from "@playwright/test"

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

// COV-23 — see docs/plan/erp-cov23-role-assignment-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const TARGET_EMAIL = "fixture.hr-project@example.test"

type Row = Record<string, unknown>

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

function identityHex(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return identityHex(record.hex ?? record.Hex ?? record.__identity__ ?? "")
  }
  return String(value ?? "").trim().replace(/^0x/i, "").toLowerCase()
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

/** Every assignment of the test role in the organization, active or not. */
async function roleAssignments(page: Page, organizationId: number, roleId: number) {
  return (await rows(page, "/api/query/user-role-assignment"))
    .filter(
      (row) =>
        scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
        scalarQueryId(row.roleId ?? row.role_id) === roleId,
    )
    .map((row) => ({
      id: scalarQueryId(row.id),
      identity: identityHex(row.userIdentity ?? row.user_identity),
      isActive: (row.isActive ?? row.is_active) === true,
    }))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

async function toggleRoleInSettings(page: Page, roleId: number, reducer: string): Promise<Response> {
  await gotoModule(page, "/settings")
  await page.getByTestId("settings-section-users").click()
  // The users list is capped (limit=100) and other specs add users; search on
  // the server for the target persona so its row is always loaded.
  // The row must come from the server-side users search; assert the API first
  // so a missing persona is reported with the payload rather than a timeout.
  const listed = await page.request.get(`/api/settings/users?limit=100&search=${encodeURIComponent(TARGET_EMAIL)}`)
  const listedBody = await listed.text()
  expect(listed.status(), listedBody).toBe(200)
  expect(listedBody, `settings users search for ${TARGET_EMAIL}`).toContain(TARGET_EMAIL)
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

async function targetCanOpenProfileSettings(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const targetPage = await context.newPage()
    await signIn(targetPage, TARGET_EMAIL, PERSONA_PASSWORD)
    await gotoModule(targetPage, "/settings")
    // isVisible() is an immediate snapshot (its timeout option does not wait).
    // Wait for the hydrated permission-filtered settings content on a new login.
    return await targetPage.getByTestId("settings-section-profile")
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true, () => false)
  } finally {
    await context.close()
  }
}

test.describe("COV-23 exact role assignment", { tag: ["@p0", "@cov23"] }, () => {
  test("assigns then revokes one role and preserves it on stale and denied replay", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)

    // The persona's identity comes from its own sign-in session cookie
    // (`/api/settings/*` is not proxied to the api-server in E2E).
    const targetContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    let targetIdentity = ""
    try {
      await signIn(await targetContext.newPage(), TARGET_EMAIL, PERSONA_PASSWORD)
      targetIdentity = identityHex(
        (await targetContext.cookies()).find((cookie) => cookie.name === "stdb_identity")?.value,
      )
    } finally {
      await targetContext.close()
    }
    expect(targetIdentity).toMatch(/^[0-9a-f]{64}$/)

    // Setup only: a fresh role granting one capability the persona does not
    // already hold, so a new browser session proves assignment and revocation.
    const roleName = smokeName("cov23-role")
    await callReducerBff(page, "create_role", [organizationId, {
      name: roleName,
      description: "COV-23 role assignment proof",
      parent_id: null,
      permissions: ["dashboard:settings:read"],
      is_active: true,
      metadata: null,
    }])
    const createdRoles = (await rows(page, "/api/query/roles")).filter((row) => row.name === roleName)
    expect(createdRoles).toHaveLength(1)
    const roleId = scalarQueryId(createdRoles[0]?.id)
    if (roleId == null) throw new Error("created role has no id")
    expect(await roleAssignments(page, organizationId, roleId)).toEqual([])

    // Assign through Settings → Users → Edit → role checkbox → Save.
    const assigned = await toggleRoleInSettings(page, roleId, "assign_role")
    await expect.poll(() => roleAssignments(page, organizationId, roleId), { timeout: 30_000 }).toHaveLength(1)
    const [active] = await roleAssignments(page, organizationId, roleId)
    expect(active).toMatchObject({ identity: targetIdentity, isActive: true })
    const assignmentId = active!.id
    await expect
      .poll(() => targetCanOpenProfileSettings(browser), { timeout: 45_000 })
      .toBe(true)

    const staleAssign = await replay(page, assigned.request())
    expect(staleAssign.status()).toBe(422)
    expect(await roleAssignments(page, organizationId, roleId)).toEqual([active])

    // Revoke through the same dialog by clearing the checkbox.
    const revoked = await toggleRoleInSettings(page, roleId, "revoke_role")
    const effect = [{ id: assignmentId, identity: targetIdentity, isActive: false }]
    await expect.poll(() => roleAssignments(page, organizationId, roleId), { timeout: 30_000 }).toEqual(effect)
    await expect
      .poll(() => targetCanOpenProfileSettings(browser), { timeout: 45_000 })
      .toBe(false)

    // Before COV-23 a replayed revoke re-audited and rebuilt the policy
    // snapshot; the reducer now rejects an already-revoked assignment.
    const staleRevoke = await replay(page, revoked.request())
    expect(staleRevoke.status()).toBe(422)
    expect(await roleAssignments(page, organizationId, roleId)).toEqual(effect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const deniedAssign = await replay(readerPage, assigned.request())
      expect(deniedAssign.status()).toBe(403)
      const deniedRevoke = await replay(readerPage, revoked.request())
      expect(deniedRevoke.status()).toBe(403)
      expect(await roleAssignments(page, organizationId, roleId)).toEqual(effect)
    } finally {
      await readerContext.close()
    }
  })

  test("admin switches companies while a bound persona rejects a forged selection and recovers", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const defaultCompanyId = await fetchDefaultCompanyId(page)
    const companyRows = await rows(page, "/api/query/companies")
    const defaultCompany = companyRows.find((row) => scalarQueryId(row.id) === defaultCompanyId)
    const currencyId = scalarQueryId(defaultCompany?.currencyId ?? defaultCompany?.currency_id)
    if (currencyId == null) throw new Error("default company has no currency")

    const branchName = smokeName("cov23-branch")
    await callReducerBff(page, "create_company", [organizationId, {
      name: branchName,
      code: smokeName("c23b").slice(-12),
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
      metadata: { some: JSON.stringify({ fixture: "COV-23", purpose: "company-switch" }) },
    }])
    await expect.poll(async () => {
      const companies = await rows(page, "/api/query/companies")
      return companies.find((row) => row.name === branchName) ?? null
    }, { timeout: 30_000 }).not.toBeNull()
    const branch = (await rows(page, "/api/query/companies")).find((row) => row.name === branchName)
    const branchId = scalarQueryId(branch?.id)
    if (branchId == null) throw new Error("branch company has no id")

    // A new document forces a fresh server render after the company becomes
    // visible. Reusing the current document can retain the old company scope.
    const adminPage = await page.context().newPage()
    try {
      await gotoModule(adminPage, "/settings")
      await expect(adminPage.getByTestId("company-switcher-trigger")).toBeVisible({ timeout: 45_000 })
      await adminPage.getByTestId("company-switcher-trigger").click()
      await expect(adminPage.getByTestId(`company-switcher-option-${branchId}`)).toBeVisible()
      await adminPage.getByTestId(`company-switcher-option-${branchId}`).click()
      await expect.poll(() => adminPage.evaluate(() => {
        const raw = localStorage.getItem("lumiere:active-company")
        return raw ? Number((JSON.parse(raw) as { companyId?: number }).companyId) : null
      })).toBe(branchId)

      await adminPage.reload()
      await expect.poll(() => adminPage.evaluate(() => {
        const raw = localStorage.getItem("lumiere:active-company")
        return raw ? Number((JSON.parse(raw) as { companyId?: number }).companyId) : null
      })).toBe(branchId)
    } finally {
      await adminPage.close()
    }

    // A company-bound persona cannot turn a forged local preference into
    // authority. Session hydration repairs it to the membership company.
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const membershipRows = await rows(readerPage, "/api/query/user-organization")
      const activeMembership = membershipRows.find(
        (row) => (row.isActive ?? row.is_active) === true,
      )
      const membershipCompanyId = scalarQueryId(
        activeMembership?.companyId ?? activeMembership?.company_id,
      )
      if (membershipCompanyId == null) throw new Error("reader membership company is missing")
      await readerPage.evaluate(({ organizationId: org, companyId }) => {
        localStorage.setItem("lumiere:active-company", JSON.stringify({ organizationId: org, companyId }))
      }, { organizationId, companyId: branchId })
      await readerPage.reload()
      await expect.poll(() => readerPage.evaluate(() => {
        const raw = localStorage.getItem("lumiere:active-company")
        return raw ? Number((JSON.parse(raw) as { companyId?: number }).companyId) : null
      })).toBe(membershipCompanyId)
      await expect(readerPage.getByTestId(`company-switcher-option-${branchId}`)).toHaveCount(0)
    } finally {
      await readerContext.close()
    }
  })
})
