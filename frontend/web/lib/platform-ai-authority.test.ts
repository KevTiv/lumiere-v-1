import assert from "node:assert/strict"
import test from "node:test"
import { canManagePlatformAiProfile } from "./platform-ai-authority"

const actor = "a".repeat(64)
const session = {
  identityHex: actor,
  organizationId: 7,
  fieldAccess: {
    identityHex: actor,
    organizationId: 7,
    roleId: 1,
    roleName: "owner",
    rolePermissions: ["*:*"],
    fieldPermissions: [],
    isSuperuser: false,
  },
}

test("organization owners cannot configure platform AI defaults", () => {
  assert.equal(canManagePlatformAiProfile(session), false)
  assert.equal(canManagePlatformAiProfile({ ...session, fieldAccess: undefined }), false)
})

test("platform profile management requires superuser authority bound to the session", () => {
  const fieldAccess = { ...session.fieldAccess, isSuperuser: true }
  assert.equal(canManagePlatformAiProfile({ ...session, fieldAccess }), true)
  assert.equal(canManagePlatformAiProfile({ ...session, fieldAccess: { ...fieldAccess, organizationId: 8 } }), false)
  assert.equal(canManagePlatformAiProfile({ ...session, fieldAccess: { ...fieldAccess, identityHex: "b".repeat(64) } }), false)
  assert.equal(canManagePlatformAiProfile({ ...session, identityHex: "", fieldAccess: { ...fieldAccess, identityHex: "" } }), false)
})
