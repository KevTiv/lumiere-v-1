import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  proposalStatusKey,
  resolveProposalStatusEffect,
  type ProposalStatusProjection,
} from "./proposal-award"

const row = (
  id: bigint,
  organizationId: bigint,
  companyId: bigint,
  status: unknown,
): ProposalStatusProjection => ({ id, organizationId, companyId, status })

test("normalises status shapes case-insensitively", () => {
  assert.equal(proposalStatusKey("Awarded"), "awarded")
  assert.equal(proposalStatusKey({ tag: "Submitted" }), "submitted")
  assert.equal(proposalStatusKey({ review: [] }), "review")
  assert.equal(proposalStatusKey(null), "")
})

test("resolves the exact proposal in the requested status", () => {
  const rows = [row(4n, 1n, 3n, { tag: "Submitted" }), row(5n, 1n, 3n, { tag: "Awarded" })]
  assert.deepEqual(resolveProposalStatusEffect(rows, 1n, 3n, 5n, "awarded"), { resource: "proposals", id: "5" })
})

test("accepts snake_case projection rows", () => {
  assert.deepEqual(
    resolveProposalStatusEffect([{ id: "5", organization_id: "1", company_id: "3", status: "Awarded" }], 1n, 3n, 5n, "awarded"),
    { resource: "proposals", id: "5" },
  )
})

test("returns null while the status has not changed", () => {
  assert.equal(resolveProposalStatusEffect([row(5n, 1n, 3n, { tag: "Submitted" })], 1n, 3n, 5n, "awarded"), null)
})

test("returns null for a missing proposal or another organization or company", () => {
  assert.equal(resolveProposalStatusEffect([row(6n, 1n, 3n, "Awarded")], 1n, 3n, 5n, "awarded"), null)
  assert.equal(resolveProposalStatusEffect([row(5n, 2n, 3n, "Awarded")], 1n, 3n, 5n, "awarded"), null)
  assert.equal(resolveProposalStatusEffect([row(5n, 1n, 4n, "Awarded")], 1n, 3n, 5n, "awarded"), null)
})

test("throws on duplicate proposal ids", () => {
  assert.throws(
    () => resolveProposalStatusEffect([row(5n, 1n, 3n, "Awarded"), row(5n, 1n, 3n, "Awarded")], 1n, 3n, 5n, "awarded"),
    AmbiguousOperationEffectError,
  )
})
