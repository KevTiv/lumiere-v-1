import assert from "node:assert/strict"
import test from "node:test"

import {
  executeOperationWithCanonicalReadback,
  type CanonicalRecordRef,
} from "./operation-effect"

const ref: CanonicalRecordRef = {
  resource: "sale-orders",
  id: "77",
  href: "/sales?orderId=77",
}

const noWait = async () => undefined

test("cache refresh failure does not downgrade a canonically resolved effect", async () => {
  let reads = 0
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => {
      reads += 1
      return reads > 1 ? ref : null
    },
    dispatch: async () => ({ kind: "accepted", correlationId: "corr-77" }),
    afterDispatch: async () => {
      throw new Error("query cache unavailable")
    },
    wait: noWait,
  })

  assert.equal(outcome.kind, "converged")
  if (outcome.kind === "converged") {
    assert.equal(outcome.ref.id, "77")
    assert.deepEqual(outcome.warnings, ["refresh-failed"])
  }
})

test("cache refresh failure remains a warning when readback is unknown", async () => {
  const outcome = await executeOperationWithCanonicalReadback({
    resolveEffect: async () => null,
    dispatch: async () => ({ kind: "accepted", correlationId: "corr-missing" }),
    afterDispatch: async () => {
      throw new Error("query cache unavailable")
    },
    readbackAttempts: 1,
    wait: noWait,
  })

  assert.equal(outcome.kind, "outcome-unknown")
  if (outcome.kind === "outcome-unknown") {
    assert.equal(outcome.reason, "readback-missing")
    assert.deepEqual(outcome.warnings, ["refresh-failed"])
  }
})
