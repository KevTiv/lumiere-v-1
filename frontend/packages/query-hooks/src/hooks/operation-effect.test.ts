import assert from "node:assert/strict"
import test from "node:test"

import { OperationRequestError } from "@lumiere/api-client"

import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  resolveUniqueEffect,
  type CanonicalRecordRef,
} from "./operation-effect"

const ref = (id: string): CanonicalRecordRef => ({
  resource: "sale-orders",
  id,
  href: `/sales?orderId=${id}`,
})

const noWait = async () => undefined

test("returns AlreadyApplied without dispatch when exact effect already exists", async () => {
  let dispatches = 0
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => ref("42"),
    dispatch: async () => {
      dispatches += 1
      return { kind: "accepted" }
    },
    wait: noWait,
  })

  assert.equal(outcome.kind, "already-applied")
  assert.equal(dispatches, 0)
})

test("returns Applied only after canonical readback resolves the resulting record", async () => {
  let reads = 0
  let dispatches = 0
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => {
      reads += 1
      return reads >= 3 ? ref("77") : null
    },
    dispatch: async () => {
      dispatches += 1
      return {
        kind: "accepted",
        operationId: "erp.convert_opportunity_to_sale_order",
        correlationId: "corr-1",
      }
    },
    wait: noWait,
  })

  assert.equal(outcome.kind, "applied")
  assert.equal(dispatches, 1)
  if (outcome.kind === "applied") {
    assert.equal(outcome.ref.id, "77")
    assert.equal(outcome.receipt.correlationId, "corr-1")
  }
})

test("returns typed rejection for non-ambiguous server rejection", async () => {
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => null,
    dispatch: async () => {
      throw new OperationRequestError({
        code: "conflict",
        status: 409,
        retry: "refresh",
        message: "stale version",
      })
    },
    wait: noWait,
  })

  assert.equal(outcome.kind, "rejected")
  if (outcome.kind === "rejected") {
    assert.equal(outcome.error.code, "conflict")
    assert.equal(outcome.error.retry, "refresh")
  }
})

test("does not blind-retry an ambiguous server failure", async () => {
  let dispatches = 0
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => null,
    dispatch: async () => {
      dispatches += 1
      throw new OperationRequestError({
        code: "dependency_unavailable",
        status: 503,
        retry: "reconcile",
        message: "upstream unavailable",
        correlationId: "corr-unknown",
      })
    },
    wait: noWait,
  })

  assert.equal(outcome.kind, "outcome-unknown")
  assert.equal(dispatches, 1)
  if (outcome.kind === "outcome-unknown") {
    assert.equal(outcome.reason, "dispatch-unknown")
    assert.equal(outcome.correlationId, "corr-unknown")
  }
})

test("returns OutcomeUnknown when successful dispatch has no exact readback", async () => {
  let reads = 0
  let dispatches = 0
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => {
      reads += 1
      return null
    },
    dispatch: async () => {
      dispatches += 1
      return { kind: "accepted", correlationId: "corr-missing" }
    },
    readbackAttempts: 3,
    wait: noWait,
  })

  assert.equal(outcome.kind, "outcome-unknown")
  assert.equal(dispatches, 1)
  assert.equal(reads, 4)
  if (outcome.kind === "outcome-unknown") {
    assert.equal(outcome.reason, "readback-missing")
    assert.equal(outcome.correlationId, "corr-missing")
  }
})

test("duplicate exact effects fail instead of choosing newest", () => {
  const rows = [
    { id: "100", opportunityId: "7" },
    { id: "101", opportunityId: "7" },
  ]

  assert.throws(
    () =>
      resolveUniqueEffect(
        rows,
        (row) => row.opportunityId === "7",
        (row) => ref(row.id),
      ),
    AmbiguousOperationEffectError,
  )
})
