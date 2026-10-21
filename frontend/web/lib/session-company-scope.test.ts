import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveSessionAuthorityExpiryMicros,
  resolveSessionCompanyIds,
  resolveSessionRoleIds,
  resolveSessionRoleNames,
  sessionPolicySnapshotNeedsRefresh,
} from "./session-company-scope"

const companies = [
  { id: 9, isParent: false },
  { id: 3, isParent: true },
  { id: 5, isParent: false },
]

test("organization admins may select every organization company", () => {
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["Admin"], organizationWideAccess: true }),
    [3, 5, 9],
  )
  assert.deepEqual(
    resolveSessionCompanyIds({ companies, membershipCompanyId: 3, roleNames: ["organization-admin"], organizationWideAccess: true }),
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
        { id: 1, name: "owner", organizationId: 42, isActive: true },
        { id: 2, name: "settings-reader", organizationId: 42, is_active: true },
        { id: 3, name: "expired", organizationId: 42, isActive: true },
      ],
      organizationId: 42,
      memberships: [{ role_id: 1, organizationId: 42, is_active: true }],
      assignments: [
        { roleId: 2, organizationId: 42, isActive: true, expiresAt: null },
        { roleId: 3, organizationId: 42, isActive: true, expiresAt: { microsSinceUnixEpoch: 99 } },
      ],
      nowMicros: 100,
    }),
    ["owner", "settings-reader"],
  )
})

test("session roles fail closed for ambiguous memberships", () => {
  assert.deepEqual(
    resolveSessionRoleNames({
      organizationId: 42,
      roles: [{ id: 1, name: "owner", organizationId: 42, isActive: true }],
      memberships: [
        { roleId: 1, organizationId: 42, isActive: true },
        { roleId: 1, organizationId: 42, isActive: true },
      ],
      assignments: [],
    }),
    [],
  )
})

test("session role IDs remain exact when role names collide and expose the next expiry", () => {
  const input = {
    organizationId: 42,
    roles: [
      { id: 1, name: "member", organizationId: 42, isActive: true },
      { id: 2, name: "duplicate", organizationId: 42, isActive: true },
      { id: 3, name: "duplicate", organizationId: 42, isActive: true },
    ],
    memberships: [{ roleId: 1, organizationId: 42, isActive: true }],
    assignments: [{ roleId: 2, organizationId: 42, isActive: true, expiresAt: 2_000 }],
    nowMicros: 1_000,
  }
  assert.deepEqual(resolveSessionRoleIds(input), [1, 2])
  assert.deepEqual(resolveSessionRoleNames(input), ["member", "duplicate"])
  assert.equal(resolveSessionAuthorityExpiryMicros(input), 2_000)
})

test("session roles exclude cross-organization authority", () => {
  assert.deepEqual(resolveSessionRoleIds({
    organizationId: 42,
    roles: [
      { id: 1, name: "member", organizationId: 42, isActive: true },
      { id: 2, name: "foreign", organizationId: 77, isActive: true },
    ],
    memberships: [{ roleId: 1, organizationId: 42, isActive: true }],
    assignments: [{ roleId: 2, organizationId: 77, isActive: true }],
  }), [1])
})

test("policy snapshot refreshes when authority expired after its generation", () => {
  const assignments = [{ isActive: true, expiresAt: 150 }]
  assert.equal(sessionPolicySnapshotNeedsRefresh({ assignments, refreshedAt: 100, nowMicros: 149 }), false)
  assert.equal(sessionPolicySnapshotNeedsRefresh({ assignments, refreshedAt: 100, nowMicros: 150 }), true)
  assert.equal(sessionPolicySnapshotNeedsRefresh({ assignments, refreshedAt: 200, nowMicros: 250 }), false)
})

test("an administrator role name alone never expands company access", () => {
  assert.deepEqual(resolveSessionCompanyIds({ companies, membershipCompanyId: 9, roleNames: ["Admin"] }), [9])
})
