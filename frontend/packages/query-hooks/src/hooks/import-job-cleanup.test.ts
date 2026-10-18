import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"

import {
  createLumiereApiClient,
  OperationRequestError,
  registerLumiereApiClient,
} from "@lumiere/api-client"

import { cleanupAbandonedAccountMoveImportCommand } from "./import-jobs"

const realFetch = globalThis.fetch

function captureResponse(status: number, body = "") {
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

describe("abandoned account move import cleanup command", () => {
  it("sends the generated company and parent-job input", async () => {
    const requests = captureResponse(200, JSON.stringify({ ok: true }))

    await cleanupAbandonedAccountMoveImportCommand(7n, 41n)

    assert.equal(requests.length, 1)
    assert.equal(
      requests[0]?.url,
      "http://api.test/api/operations/erp.cleanup_abandoned_account_move_import",
    )
    assert.equal(requests[0]?.init?.method, "POST")
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      companyId: 7,
      parentJobId: 41,
    })
  })

  it("preserves reducer refusal status and detail", async () => {
    captureResponse(409, JSON.stringify({
      detail: "Journal entry 99 is no longer an unchanged empty draft",
    }))

    await assert.rejects(
      cleanupAbandonedAccountMoveImportCommand(7n, 41n),
      (error: unknown) => {
        assert.ok(error instanceof OperationRequestError)
        assert.equal(error.status, 409)
        assert.equal(error.message, "Journal entry 99 is no longer an unchanged empty draft")
        return true
      },
    )
  })
})
