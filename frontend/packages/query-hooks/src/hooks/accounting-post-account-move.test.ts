import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolvePostedAccountMoveEffect } from "./accounting/moves"
import { AmbiguousOperationEffectError } from "./operation-effect"

const postedMove = {
  id: "41",
  state: { tag: "Posted" },
} as never

describe("resolvePostedAccountMoveEffect", () => {
  it("returns the exact posted account move", () => {
    assert.deepEqual(resolvePostedAccountMoveEffect([postedMove], 41n), {
      resource: "account-moves",
      id: "41",
      state: "Posted",
    })
    assert.deepEqual(
      resolvePostedAccountMoveEffect([{ id: 41n, state: { posted: [] } } as never], 41n),
      { resource: "account-moves", id: "41", state: "Posted" },
    )
  })

  it("fails closed for identity or state mismatch", () => {
    assert.equal(resolvePostedAccountMoveEffect([postedMove], 42n), null)
    assert.equal(
      resolvePostedAccountMoveEffect([{ id: "41", state: { tag: "Draft" } } as never], 41n),
      null,
    )
  })

  it("rejects duplicate exact posted rows", () => {
    assert.throws(
      () => resolvePostedAccountMoveEffect([postedMove, postedMove], 41n),
      AmbiguousOperationEffectError,
    )
  })
})
