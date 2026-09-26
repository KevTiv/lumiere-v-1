import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  proposalStatusKey,
  resolveProposalConversionEffect,
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

const proposal = (status: unknown, saleOrderId: unknown) => ({
  id: 5n,
  organizationId: 1n,
  companyId: 3n,
  status,
  saleOrderId,
})
const order = (id: bigint, organizationId = 1n, companyId = 3n) => ({ id, organizationId, companyId })

test("conversion resolves the sale order through the proposal relation", () => {
  assert.deepEqual(
    resolveProposalConversionEffect([proposal("Awarded", 40n)], [order(39n), order(40n), order(41n)], 1n, 3n, 5n),
    { resource: "sale-orders", id: "40" },
  )
})

test("conversion returns null before the relation is set or the order is visible", () => {
  assert.equal(resolveProposalConversionEffect([proposal("Awarded", null)], [order(40n)], 1n, 3n, 5n), null)
  assert.equal(resolveProposalConversionEffect([proposal("Awarded", 40n)], [order(41n)], 1n, 3n, 5n), null)
  assert.equal(resolveProposalConversionEffect([proposal("Submitted", 40n)], [order(40n)], 1n, 3n, 5n), null)
})

test("conversion rejects an order in another organization or company", () => {
  assert.equal(resolveProposalConversionEffect([proposal("Awarded", 40n)], [order(40n, 2n)], 1n, 3n, 5n), null)
  assert.equal(resolveProposalConversionEffect([proposal("Awarded", 40n)], [order(40n, 1n, 4n)], 1n, 3n, 5n), null)
})

test("conversion throws on duplicate sale order ids", () => {
  assert.throws(
    () => resolveProposalConversionEffect([proposal("Awarded", 40n)], [order(40n), order(40n)], 1n, 3n, 5n),
    AmbiguousOperationEffectError,
  )
})
