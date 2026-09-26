import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
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

    // Setup only: a fresh, minimal role so the assignment is unambiguous and
    // grants nothing beyond what the persona already has.
    const roleName = smokeName("cov23-role")
    await callReducerBff(page, "create_role", [organizationId, {
      name: roleName,
      description: "COV-23 role assignment proof",
      parent_id: null,
      permissions: ["organization:read"],
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

    const staleAssign = await replay(page, assigned.request())
    expect(staleAssign.status()).toBe(422)
    expect(await roleAssignments(page, organizationId, roleId)).toEqual([active])

    // Revoke through the same dialog by clearing the checkbox.
    const revoked = await toggleRoleInSettings(page, roleId, "revoke_role")
    const effect = [{ id: assignmentId, identity: targetIdentity, isActive: false }]
    await expect.poll(() => roleAssignments(page, organizationId, roleId), { timeout: 30_000 }).toEqual(effect)

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
})
