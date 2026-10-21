import assert from "node:assert/strict"
import test from "node:test"

import { resolveDocumentLockEffect, type DocumentLockProjection } from "./document-lock-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const row = (id: bigint, organizationId: bigint, isLocked: boolean, lockedBy: unknown): DocumentLockProjection => ({
  id,
  organizationId,
  isLocked,
  lockedBy,
})

test("resolves the exact document that reads back locked with a holder", () => {
  assert.deepEqual(
    resolveDocumentLockEffect([row(4n, 1n, false, null), row(5n, 1n, true, "0xabc")], 1n, 5n, "locked"),
    { resource: "documents", id: "5" },
  )
})

test("resolves the exact document that reads back unlocked with no holder", () => {
  assert.deepEqual(resolveDocumentLockEffect([row(5n, 1n, false, null)], 1n, 5n, "unlocked"), {
    resource: "documents",
    id: "5",
  })
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolveDocumentLockEffect(
      [{ id: "5", organization_id: "1", is_locked: true, locked_by: "0xabc" }],
      1n,
      5n,
      "locked",
    ),
    { resource: "documents", id: "5" },
  )
})

test("returns null while the lock state has not converged", () => {
  assert.equal(resolveDocumentLockEffect([row(5n, 1n, false, null)], 1n, 5n, "locked"), null)
  assert.equal(resolveDocumentLockEffect([row(5n, 1n, true, "0xabc")], 1n, 5n, "unlocked"), null)
  assert.equal(resolveDocumentLockEffect([row(5n, 1n, true, null)], 1n, 5n, "locked"), null)
  assert.equal(resolveDocumentLockEffect([row(5n, 1n, false, "0xabc")], 1n, 5n, "unlocked"), null)
})

test("returns null for a missing or foreign-organization document", () => {
  assert.equal(resolveDocumentLockEffect([row(6n, 1n, true, "0xabc")], 1n, 5n, "locked"), null)
  assert.equal(resolveDocumentLockEffect([row(5n, 2n, true, "0xabc")], 1n, 5n, "locked"), null)
})

test("throws on duplicate document ids", () => {
  assert.throws(
    () =>
      resolveDocumentLockEffect([row(5n, 1n, true, "0xabc"), row(5n, 1n, true, "0xabc")], 1n, 5n, "locked"),
    AmbiguousOperationEffectError,
  )
})
