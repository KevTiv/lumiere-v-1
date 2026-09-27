import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  hrLeaveStateTag,
  resolveLeaveStateEffect,
  type HrLeaveEffectProjection,
} from "./hr-leave-approval"

const row = (
  id: bigint,
  organizationId: bigint,
  companyId: bigint,
  state: unknown,
): HrLeaveEffectProjection => ({ id, organizationId, companyId, state })

const APPROVED = ["ValidatedOne", "Validated"] as const

test("normalises SATS enum shapes", () => {
  assert.equal(hrLeaveStateTag("Confirm"), "Confirm")
  assert.equal(hrLeaveStateTag({ tag: "ValidatedOne" }), "ValidatedOne")
  assert.equal(hrLeaveStateTag({ refused: [] }), "Refused")
  assert.equal(hrLeaveStateTag(null), "")
})

test("resolves the exact leave in an expected state", () => {
  const rows = [row(4n, 1n, 3n, { tag: "Confirm" }), row(5n, 1n, 3n, { tag: "Validated" })]
  assert.deepEqual(resolveLeaveStateEffect(rows, 1n, 3n, 5n, APPROVED), { resource: "leave-requests", id: "5" })
  assert.deepEqual(resolveLeaveStateEffect([row(5n, 1n, 3n, "ValidatedOne")], 1n, 3n, 5n, APPROVED), {
    resource: "leave-requests",
    id: "5",
  })
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolveLeaveStateEffect([{ id: "5", organization_id: "1", company_id: "3", state: { tag: "Refused" } }], 1n, 3n, 5n, ["Refused"]),
    { resource: "leave-requests", id: "5" },
  )
})

test("returns null for the wrong state, e.g. approval routed to review", () => {
  assert.equal(resolveLeaveStateEffect([row(5n, 1n, 3n, { tag: "Confirm" })], 1n, 3n, 5n, APPROVED), null)
})

test("returns null for a missing leave or another organization or company", () => {
  assert.equal(resolveLeaveStateEffect([row(6n, 1n, 3n, "Validated")], 1n, 3n, 5n, APPROVED), null)
  assert.equal(resolveLeaveStateEffect([row(5n, 2n, 3n, "Validated")], 1n, 3n, 5n, APPROVED), null)
  assert.equal(resolveLeaveStateEffect([row(5n, 1n, 4n, "Validated")], 1n, 3n, 5n, APPROVED), null)
})

test("throws on duplicate leave ids", () => {
  assert.throws(
    () => resolveLeaveStateEffect([row(5n, 1n, 3n, "Validated"), row(5n, 1n, 3n, "Validated")], 1n, 3n, 5n, APPROVED),
    AmbiguousOperationEffectError,
  )
})
