import assert from "node:assert/strict"
import test from "node:test"
import type { FieldAccessContext } from "@lumiere/stdb/server"
import {
  sessionAllowsPermission,
  type SessionPermissionAuthority,
} from "./session-permissions"

const actor = "a".repeat(64)
function authority(
  overrides: Partial<FieldAccessContext> = {},
): SessionPermissionAuthority {
  return {
    identityHex: actor,
    organizationId: 7,
    fieldAccess: {
      identityHex: actor,
      organizationId: 7,
      roleId: 2,
      roleName: "skill-admin",
      isSuperuser: false,
      rolePermissions: ["ai_skill:create"],
      fieldPermissions: [],
      ...overrides,
    },
  }
}

test("session permissions require policy for the same organization and actor", () => {
  assert.equal(sessionAllowsPermission(authority(), "ai_skill", "create"), true)
  assert.equal(
    sessionAllowsPermission(
      authority({ identityHex: `0x${actor.toUpperCase()}` }),
      "ai_skill",
      "create",
    ),
    true,
  )
  for (const session of [
    { identityHex: actor, organizationId: 7 },
    authority({ identityHex: "b".repeat(64) }),
    authority({ organizationId: 8 }),
    { ...authority({ isSuperuser: true }), organizationId: undefined },
  ]) {
    assert.equal(sessionAllowsPermission(session, "ai_skill", "create"), false)
  }
})

test("organization denials override role grants and explicit organization grants remain supported", () => {
  for (const permissions of [["*:*"], ["ai_skill:*"], ["ai_skill:create"]]) {
    const session = authority({ rolePermissions: permissions })
    assert.equal(sessionAllowsPermission(session, "ai_skill", "create"), true)
    session.fieldAccess!.orgPermissions = [
      { resource: "ai_skill", action: "create", allow: false },
    ]
    assert.equal(sessionAllowsPermission(session, "ai_skill", "create"), false)
  }
  const granted = authority({
    rolePermissions: [],
    orgPermissions: [{ resource: "ai_skill", action: "create", allow: true }],
  })
  assert.equal(sessionAllowsPermission(granted, "ai_skill", "create"), true)
  assert.equal(sessionAllowsPermission(granted, "ai_skill", "delete"), false)
  assert.equal(
    sessionAllowsPermission(
      authority({ rolePermissions: ["ai_skill:read"] }),
      "ai_skill",
      "create",
    ),
    false,
  )
  assert.equal(
    sessionAllowsPermission(
      authority({ isSuperuser: true, rolePermissions: [] }),
      "ai_skill",
      "create",
    ),
    true,
  )
})
