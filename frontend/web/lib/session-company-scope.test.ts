import assert from "node:assert/strict"
import test from "node:test"

import { resolveSessionCompanyIds, resolveSessionRoleNames } from "./session-company-scope"

const companies = [
  { id: 9, isParent: false },
  { id: 3, isParent: true },
  { id: 5, isParent: false },
]

test("organization admins may select every organization company", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["Admin"] }),
    [3, 5, 9],
  )
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["organization-admin"] }),
    [3, 5, 9],
  )
})

test("company-bound users remain pinned to their membership company", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 9, roleNames: ["accountant"] }),
    [9],
  )
})

test("invalid membership falls back deterministically without expanding authority", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 999, roleNames: [] }),
    [3],
  )
  assert.deepEqual(resolveSessionCompanyIds({ companies: [], roleNames: ["owner"] }), [])
})

test("session roles include the membership base role and current additive assignments", () => {
  assert.deepEqual(
    resolveSessionRoleNames({
      roles: [
        { id: 1, name: "owner", isActive: true },
        { id: 2, name: "settings-reader", is_active: true },
        { id: 3, name: "expired", isActive: true },
      ],
      memberships: [{ role_id: 1, is_active: true }],
      assignments: [
        { roleId: 2, isActive: true, expiresAt: null },
        { roleId: 3, isActive: true, expiresAt: { microsSinceUnixEpoch: 99 } },
      ],
      nowMicros: 100,
    }),
    ["owner", "settings-reader"],
  )
})

test("session roles fail closed for ambiguous memberships", () => {
  assert.deepEqual(
    resolveSessionRoleNames({
      roles: [{ id: 1, name: "owner", isActive: true }],
      memberships: [
        { roleId: 1, isActive: true },
        { roleId: 1, isActive: true },
      ],
      assignments: [],
    }),
    [],
  )
})
