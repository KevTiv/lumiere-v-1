import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import {
  createLumiereApiClient,
  registerLumiereApiClient,
} from "@lumiere/api-client"
import { HttpResponseError } from "@lumiere/api-client/response-error"

import {
  applyHistoricalPaymentAllocationsCommand,
  type ApplyHistoricalPaymentAllocationsParams,
  type HistoricalPaymentAllocationInput,
} from "./accounting/payments"

const realFetch = globalThis.fetch

function captureResponse(status: number, body: string) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  return requests
}

beforeEach(() => {
  registerLumiereApiClient(
    createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }),
  )
})

afterEach(() => {
  globalThis.fetch = realFetch
  registerLumiereApiClient(null)
})

describe("historical payment allocation command", () => {
  const allocations: HistoricalPaymentAllocationInput[] = [
    {
      documentMoveId: 101n,
      allocatedAmount: 75.25,
      expectedResidualAfter: 24.75,
      completesDocumentHistory: true,
    },
    {
      documentMoveId: 102n,
      allocatedAmount: 24.75,
      expectedResidualAfter: 0,
      completesDocumentHistory: true,
    },
  ]
  const params: ApplyHistoricalPaymentAllocationsParams = {
    idempotencyKey: "historical-payment:batch-7",
    companyId: 9n,
    paymentTransactionId: 44n,
    currencyId: 3n,
    allocations,
    metadata: '{"source":"legacy-ledger"}',
  }

  it("sends one typed, JSON-safe atomic batch to the scoped accounting endpoint", async () => {
    const requests = captureResponse(
      200,
      JSON.stringify({
        data: {
          message: "Historical payment allocations applied successfully",
          paymentTransactionId: 44,
        },
      }),
    )

    await applyHistoricalPaymentAllocationsCommand(params)

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, "http://api.test/api/accounting/historical-payment-allocations")
    assert.equal(requests[0]?.init?.method, "POST")
    assert.equal(new Headers(requests[0]?.init?.headers).get("Content-Type"), "application/json")
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      params: {
        idempotency_key: "historical-payment:batch-7",
        company_id: 9,
        payment_transaction_id: 44,
        currency_id: 3,
        allocations: [
          {
            document_move_id: 101,
            allocated_amount: 75.25,
            expected_residual_after: 24.75,
            completes_document_history: true,
          },
          {
            document_move_id: 102,
            allocated_amount: 24.75,
            expected_residual_after: 0,
            completes_document_history: true,
          },
        ],
        metadata: { some: '{"source":"legacy-ledger"}' },
      },
    })
  })

  it("encodes absent optional metadata and rejects unsafe u64 values before fetch", async () => {
    const requests = captureResponse(200, JSON.stringify({ data: {} }))

    await applyHistoricalPaymentAllocationsCommand({ ...params, metadata: undefined })
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)).params.metadata, { none: [] })

    await assert.rejects(
      applyHistoricalPaymentAllocationsCommand({
        ...params,
        paymentTransactionId: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }),
      /exceeds Number\.MAX_SAFE_INTEGER/,
    )
    assert.equal(requests.length, 1)
  })

  it("preserves the server status and message for authorization or validation handling", async () => {
    captureResponse(403, JSON.stringify({ error: "permission denied" }))

    await assert.rejects(
      applyHistoricalPaymentAllocationsCommand(params),
      (error: unknown) => {
        assert.ok(error instanceof HttpResponseError)
        assert.equal(error.status, 403)
        assert.equal(error.message, "permission denied")
        return true
      },
    )
  })
})
