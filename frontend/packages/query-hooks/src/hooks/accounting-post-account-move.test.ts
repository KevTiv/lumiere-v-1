import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveManualInvoiceDraftEffect,
  resolvePostedAccountMoveEffect,
} from "./accounting/moves"
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

describe("resolveManualInvoiceDraftEffect", () => {
  const requestId = "create-manual-invoice:retry-safe"
  const draft = {
    id: "73",
    companyId: "9",
    state: { tag: "Draft" },
    metadata: JSON.stringify({ manualInvoiceRequestId: requestId }),
  } as never

  it("returns the exact company-scoped draft correlated by the server", () => {
    assert.deepEqual(resolveManualInvoiceDraftEffect([draft], 9n, requestId), {
      resource: "account-moves",
      id: "73",
      state: "Draft",
      requestId,
    })
  })

  it("fails closed for company, state, request, malformed metadata, or duplicates", () => {
    assert.equal(resolveManualInvoiceDraftEffect([draft], 10n, requestId), null)
    assert.equal(resolveManualInvoiceDraftEffect([draft], 9n, "another-request"), null)
    assert.equal(
      resolveManualInvoiceDraftEffect(
        [
          {
            id: "73",
            companyId: "9",
            state: { tag: "Posted" },
            metadata: JSON.stringify({ manualInvoiceRequestId: requestId }),
          } as never,
        ],
        9n,
        requestId,
      ),
      null,
    )
    assert.equal(
      resolveManualInvoiceDraftEffect(
        [{ id: "73", companyId: "9", state: { tag: "Draft" }, metadata: "{" } as never],
        9n,
        requestId,
      ),
      null,
    )
    assert.throws(
      () => resolveManualInvoiceDraftEffect([draft, draft], 9n, requestId),
      AmbiguousOperationEffectError,
    )
  })
})
