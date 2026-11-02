import assert from "node:assert/strict"
import test from "node:test"
import { HttpResponseError } from "@lumiere/api-client/response-error"
import {
  isAiActionDraftOutcomeUnknown,
  mutateAiActionDraftWithReadback,
} from "./ai-action-draft-result"

test("an acknowledged approval returns the exact authoritative record instead of an optimistic status", async () => {
  let writes = 0
  const observed = { status: "approved", executionRecordId: "9007199254740993" }
  const result = await mutateAiActionDraftWithReadback({
    dispatch: async () => {
      writes++
    },
    read: async () => observed,
    expectedStatus: "approved",
  })
  assert.equal(result, observed)
  assert.equal(writes, 1)
})

test("a lost command reply is reconciled by reading once and never redispatching", async () => {
  let writes = 0,
    reads = 0
  const result = await mutateAiActionDraftWithReadback({
    dispatch: async () => {
      writes++
      throw new TypeError("reply lost")
    },
    read: async () => {
      reads++
      return { status: "approved", executionRecordId: 42 }
    },
    expectedStatus: "approved",
  })
  assert.equal(result.executionRecordId, 42)
  assert.deepEqual({ writes, reads }, { writes: 1, reads: 1 })
})

test("pending or unavailable readback after approval remains unknown", async () => {
  for (const read of [
    async () => ({ status: "pending" }),
    async () => {
      throw new Error("read unavailable")
    },
  ]) {
    let writes = 0
    await assert.rejects(
      mutateAiActionDraftWithReadback({
        dispatch: async () => {
          writes++
        },
        read,
        expectedStatus: "approved",
      }),
      isAiActionDraftOutcomeUnknown,
    )
    assert.equal(writes, 1)
  }
})

test("authorization denials are not turned into success from an unrelated read", async () => {
  let reads = 0
  const denied = new HttpResponseError(403, "Denied")
  await assert.rejects(
    mutateAiActionDraftWithReadback({
      dispatch: async () => {
        throw denied
      },
      read: async () => {
        reads++
        return { status: "approved" }
      },
      expectedStatus: "approved",
    }),
    (error) => error === denied,
  )
  assert.equal(reads, 0)
})

test("a conflicting terminal outcome is preserved and never mislabeled approved", async () => {
  const result = await mutateAiActionDraftWithReadback({
    dispatch: async () => {},
    read: async () => ({ status: "rejected" }),
    expectedStatus: "approved",
  })
  assert.equal(result.status, "rejected")
})

test("a timed out parameter update cannot establish that a pending draft contains the requested values", async () => {
  await assert.rejects(
    mutateAiActionDraftWithReadback({
      dispatch: async () => {
        throw new HttpResponseError(408, "Timeout")
      },
      read: async () => ({ status: "pending" }),
      expectedStatus: "pending",
    }),
    isAiActionDraftOutcomeUnknown,
  )
})
