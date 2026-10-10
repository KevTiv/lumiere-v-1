import assert from "node:assert/strict"
import test from "node:test"

import {
  proposalBidDecisionIds,
  resolveProposalBidDecisionEffect,
} from "./proposal-bid-decision-effect"

test("resolves the one new exact proposal decision", () => {
  const before = [{ id: 4n, organizationId: 1n, companyId: 2n, proposalId: 3n }]
  const after = [
    ...before,
    {
      id: 5n,
      organizationId: 1n,
      companyId: 2n,
      proposalId: 3n,
      decision: { tag: "Bid" },
      rationale: "Proceed",
    },
  ]
  assert.deepEqual(
    resolveProposalBidDecisionEffect(
      after,
      proposalBidDecisionIds(before),
      1n,
      2n,
      3n,
      "bid",
      "Proceed",
    ),
    { resource: "proposal-bid-decisions", id: "5", href: "/proposals/3" },
  )
})

test("pre-existing and foreign decisions do not prove this dispatch", () => {
  const row = {
    id: 5n,
    organizationId: 1n,
    companyId: 2n,
    proposalId: 3n,
    decision: "bid",
    rationale: "Proceed",
  }
  assert.equal(
    resolveProposalBidDecisionEffect([row], new Set([5n]), 1n, 2n, 3n, "bid", "Proceed"),
    null,
  )
  assert.equal(
    resolveProposalBidDecisionEffect([{ ...row, organizationId: 9n }], new Set(), 1n, 2n, 3n, "bid", "Proceed"),
    null,
  )
})
