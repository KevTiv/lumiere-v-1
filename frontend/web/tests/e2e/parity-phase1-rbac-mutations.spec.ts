import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  fetchAdminRoleId,
  fetchOrgPermissionId,
  grantPermissionViaSettings,
  revokePermissionViaSettings,
  smokeName,
  waitForOrgPermissionAbsent,
} from "./helpers"

test.describe("Parity phase 1 — RBAC mutations", { tag: ["@p0", "@parity-phase-1"] }, () => {
  test("grants and revokes an organization permission via Settings admin actions", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const resource = smokeName("rbac-resource")
    const roleId = await fetchAdminRoleId(page)

    await grantPermissionViaSettings(page, {
      roleId,
      resource,
      action: "read",
    })

    const permissionId = await fetchOrgPermissionId(page, resource)
    expect(permissionId).toBeGreaterThan(0)

    await revokePermissionViaSettings(page, permissionId)

    await waitForOrgPermissionAbsent(page, resource)

    await expectNoAppError(page)
  })
})
