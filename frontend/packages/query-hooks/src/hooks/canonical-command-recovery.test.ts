import assert from "node:assert/strict"
import test from "node:test"

import { WorkflowError } from "@lumiere/erp-workflows"

import { executeCommandWithAppliedRecovery } from "./canonical-command-recovery"

test("ambiguous transport failure converges when canonical readback proves the effect", async () => {
  let dispatches = 0
  let readbacks = 0

  await executeCommandWithAppliedRecovery(
    async () => {
      dispatches += 1
      throw new TypeError("response connection closed")
    },
    async () => {
      readbacks += 1
      return { outcome: "applied" }
    },
  )

  assert.equal(dispatches, 1)
  assert.equal(readbacks, 1)
})

test("already-applied rejection converges through the same exact readback", async () => {
  await executeCommandWithAppliedRecovery(
    async () => {
      throw new WorkflowError("already_applied", "order already confirmed", { status: 422 })
    },
    async () => ({ outcome: "applied" }),
  )
})

test("permission denial is preserved without probing canonical state", async () => {
  const denied = new WorkflowError("permission_denied", "permission denied", { status: 403 })
  let readbacks = 0

  await assert.rejects(
    executeCommandWithAppliedRecovery(
      async () => {
        throw denied
      },
      async () => {
        readbacks += 1
        return { outcome: "applied" }
      },
    ),
    (error: unknown) => error === denied,
  )
  assert.equal(readbacks, 0)
})

test("approval-pending does not falsely resolve an ambiguous confirmation", async () => {
  const ambiguous = new TypeError("response connection closed")
  await assert.rejects(
    executeCommandWithAppliedRecovery(
      async () => {
        throw ambiguous
      },
      async () => ({ outcome: "approval_pending" }),
    ),
    (error: unknown) => error === ambiguous,
  )
})

test("missing or failed readback preserves the original command failure", async () => {
  for (const observe of [
    async () => ({}),
    async () => {
      throw new Error("projection unavailable")
    },
  ]) {
    const ambiguous = new TypeError("response connection closed")
    await assert.rejects(
      executeCommandWithAppliedRecovery(
        async () => {
          throw ambiguous
        },
        observe,
      ),
      (error: unknown) => error === ambiguous,
    )
  }
})
