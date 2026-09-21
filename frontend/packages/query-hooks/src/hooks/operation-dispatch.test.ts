import assert from "node:assert/strict"
import test from "node:test"

import {
  OperationRequestError,
  decodeOperationDispatch,
} from "@lumiere/api-client"

test("legacy ok response still decodes only as transport acceptance", async () => {
  const receipt = await decodeOperationDispatch(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )

  assert.deepEqual(receipt, { kind: "accepted" })
})

test("server operation receipt preserves canonical operation and correlation metadata", async () => {
  const receipt = await decodeOperationDispatch(
    new Response(
      JSON.stringify({
        ok: true,
        operationId: "erp.convert_opportunity_to_sale_order",
        correlationId: "corr-12",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  )

  assert.equal(receipt.kind, "accepted")
  assert.equal(receipt.operationId, "erp.convert_opportunity_to_sale_order")
  assert.equal(receipt.correlationId, "corr-12")
})

test("conflict is typed as refresh-required rather than string parsing", async () => {
  await assert.rejects(
    () =>
      decodeOperationDispatch(
        new Response(JSON.stringify({ error: "stale version" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof OperationRequestError)
      assert.equal(error.code, "conflict")
      assert.equal(error.retry, "refresh")
      return true
    },
  )
})

test("server ambiguity is reconcile-required and must not be auto-retried", async () => {
  await assert.rejects(
    () =>
      decodeOperationDispatch(
        new Response(JSON.stringify({ error: "Service temporarily unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof OperationRequestError)
      assert.equal(error.code, "dependency_unavailable")
      assert.equal(error.retry, "reconcile")
      return true
    },
  )
})
