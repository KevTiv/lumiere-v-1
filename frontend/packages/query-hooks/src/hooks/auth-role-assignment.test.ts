import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveActiveRoleAssignmentEffect,
  resolveRevokedRoleAssignmentEffect,
  type RoleAssignmentProjection,
} from "./auth-role-assignment"

const ALICE = "ab".repeat(32)
const BOB = "cd".repeat(32)

const row = (
  id: bigint,
  organizationId: bigint,
  userIdentity: string,
  roleId: bigint,
  isActive: boolean,
): RoleAssignmentProjection => ({ id, organizationId, userIdentity, roleId, isActive })

test("assign resolves the single active assignment for user + role + organization", () => {
  const rows = [
    row(1n, 1n, ALICE, 7n, false),
    row(2n, 1n, ALICE, 7n, true),
    row(3n, 1n, BOB, 7n, true),
    row(4n, 2n, ALICE, 7n, true),
    row(5n, 1n, ALICE, 8n, true),
  ]
  assert.deepEqual(resolveActiveRoleAssignmentEffect(rows, 1n, `0x${ALICE.toUpperCase()}`, 7n), {
    resource: "user-role-assignment",
    id: "2",
  })
})

test("assign accepts snake_case rows and object identities", () => {
  assert.deepEqual(
    resolveActiveRoleAssignmentEffect(
      [{ id: "9", organization_id: "1", user_identity: { __identity__: `0x${ALICE}` }, role_id: "7", is_active: true }],
      1n,
      ALICE,
      7n,
    ),
    { resource: "user-role-assignment", id: "9" },
  )
})

test("assign returns null when no active assignment exists", () => {
  assert.equal(resolveActiveRoleAssignmentEffect([row(1n, 1n, ALICE, 7n, false)], 1n, ALICE, 7n), null)
  assert.equal(resolveActiveRoleAssignmentEffect([row(1n, 1n, ALICE, 7n, true)], 1n, "", 7n), null)
})

test("assign throws when two active assignments match", () => {
  assert.throws(
    () => resolveActiveRoleAssignmentEffect([row(1n, 1n, ALICE, 7n, true), row(2n, 1n, ALICE, 7n, true)], 1n, ALICE, 7n),
    AmbiguousOperationEffectError,
  )
})

test("revoke resolves the same assignment id once inactive", () => {
  assert.deepEqual(resolveRevokedRoleAssignmentEffect([row(2n, 1n, ALICE, 7n, false)], 1n, 2n), {
    resource: "user-role-assignment",
    id: "2",
  })
})

test("revoke returns null while active, missing or in another organization", () => {
  assert.equal(resolveRevokedRoleAssignmentEffect([row(2n, 1n, ALICE, 7n, true)], 1n, 2n), null)
  assert.equal(resolveRevokedRoleAssignmentEffect([row(3n, 1n, ALICE, 7n, false)], 1n, 2n), null)
  assert.equal(resolveRevokedRoleAssignmentEffect([row(2n, 2n, ALICE, 7n, false)], 1n, 2n), null)
})

test("revoke throws on duplicate assignment ids", () => {
  assert.throws(
    () => resolveRevokedRoleAssignmentEffect([row(2n, 1n, ALICE, 7n, false), row(2n, 1n, ALICE, 7n, false)], 1n, 2n),
    AmbiguousOperationEffectError,
  )
})
