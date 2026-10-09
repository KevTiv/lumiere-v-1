import assert from "node:assert/strict"
import test from "node:test"

import {
  ProposalSectionConflictError,
  isProposalSectionConflictError,
  parseProposalSectionConflictMessage,
  proposalSectionUpsertError,
} from "./proposal-section-conflict"

test("parses the reducer conflict message", () => {
  assert.deepEqual(
    parseProposalSectionConflictMessage("Section conflict: expected revision 3, found 5"),
    { expectedRevision: 3, foundRevision: 5 },
  )
  assert.deepEqual(
    parseProposalSectionConflictMessage("Reducer failed: Section conflict: expected revision 0, found 12 (at proposals.rs)"),
    { expectedRevision: 0, foundRevision: 12 },
  )
})

test("malformed messages do not parse", () => {
  for (const bad of [
    "",
    "Section conflict",
    "Section conflict: expected revision x, found 5",
    "Section conflict: expected revision 3, found",
    "Section conflict: expected revision -1, found 2",
    "Section conflict: expected revision 99999999999, found 2",
    "Section 4 not found",
    null,
    undefined,
    42,
  ]) {
    assert.equal(parseProposalSectionConflictMessage(bad), null, String(bad))
  }
})

test("a conflict in the error body becomes a typed error", () => {
  const err = proposalSectionUpsertError(JSON.stringify({ error: "Section conflict: expected revision 2, found 4" }))
  assert.ok(isProposalSectionConflictError(err))
  assert.ok(err instanceof ProposalSectionConflictError)
  assert.equal(err.expectedRevision, 2)
  assert.equal(err.foundRevision, 4)
  const viaDetail = proposalSectionUpsertError(
    JSON.stringify({ error: "Reducer call failed", detail: "Section conflict: expected revision 7, found 8" }),
  )
  assert.ok(isProposalSectionConflictError(viaDetail))
  const raw = proposalSectionUpsertError("Section conflict: expected revision 1, found 9")
  assert.ok(isProposalSectionConflictError(raw))
})

test("other errors keep the generic message", () => {
  for (const body of [
    "",
    "not json",
    JSON.stringify({ error: "Permission denied" }),
    JSON.stringify({ error: "Section does not belong to this proposal" }),
    JSON.stringify({ error: "Section conflict: expected revision a, found b" }),
  ]) {
    const err = proposalSectionUpsertError(body)
    assert.equal(isProposalSectionConflictError(err), false)
    assert.equal(err.message, "Failed to upsert proposal section")
  }
})
