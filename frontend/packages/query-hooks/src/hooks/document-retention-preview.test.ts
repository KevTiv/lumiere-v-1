import assert from "node:assert/strict"
import { test } from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { assertRetentionPreviewUnchanged, decodeRetentionPreview, readRetentionPreview } from "./document-retention-preview"

function envelope() {
  return { data: { organizationId: "7", scope: "organization", delaySeconds: 1, evaluatedAtMicros: "100", cutoffMicros: "1000100",
    fingerprint: "a".repeat(64), documents: [{ id: "9007199254740993", name: "Saved file", companyId: "12", purgeAfterMicros: "100" }],
    unreviewableCount: 0, heldCount: 1, complete: true, canProceed: true } }
}

test("retention preview preserves exact identities and proves the requested organization/delay", () => {
  const result = decodeRetentionPreview(envelope(), 7n, 1)
  assert.equal(result.documents[0].id, "9007199254740993")
  assert.equal(result.heldCount, 1)
  assert.throws(() => decodeRetentionPreview(envelope(), 8n, 1))
  assert.throws(() => decodeRetentionPreview(envelope(), 7n, 0))
})

test("hidden rows block execution and inconsistent or incomplete previews reject", () => {
  const hidden = envelope(); hidden.data.unreviewableCount = 1; hidden.data.canProceed = false
  const preview = decodeRetentionPreview(hidden, 7n, 1)
  assert.equal(preview.canProceed, false)
  assert.throws(() => assertRetentionPreviewUnchanged(preview, preview))
  hidden.data.canProceed = true
  assert.throws(() => decodeRetentionPreview(hidden, 7n, 1))
  const incomplete = envelope(); incomplete.data.complete = false
  assert.throws(() => decodeRetentionPreview(incomplete, 7n, 1))
  const malformed = envelope(); malformed.data.documents[0].purgeAfterMicros = "not-time"
  assert.throws(() => decodeRetentionPreview(malformed, 7n, 1))
  const duplicate = envelope(); duplicate.data.documents.push(duplicate.data.documents[0])
  assert.throws(() => decodeRetentionPreview(duplicate, 7n, 1))
})

test("changed or newly hidden scope requires fresh review before dispatch", () => {
  const reviewed = decodeRetentionPreview(envelope(), 7n, 1)
  assert.doesNotThrow(() => assertRetentionPreviewUnchanged(reviewed, reviewed))
  assert.throws(() => assertRetentionPreviewUnchanged(reviewed, { ...reviewed, fingerprint: "b".repeat(64) }))
  assert.throws(() => assertRetentionPreviewUnchanged(reviewed, { ...reviewed, canProceed: false, unreviewableCount: 1 }))
  assert.throws(() => assertRetentionPreviewUnchanged(reviewed, { ...reviewed, organizationId: "8" }))
})

test("the actual preview reader performs one uncached read and never dispatches a purge after denied or failed reads", async () => {
  const original = globalThis.fetch
  const requests: { method: string; cache?: RequestCache }[] = []
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }))
  try {
    for (const status of [403, 503]) {
      globalThis.fetch = async (_input, init) => { requests.push({ method: init?.method ?? "GET", cache: init?.cache }); return new Response("unavailable", { status }) }
      await assert.rejects(readRetentionPreview(7n, 1), /No purge was requested/)
    }
    globalThis.fetch = async (_input, init) => { requests.push({ method: init?.method ?? "GET", cache: init?.cache }); throw new Error("disconnected") }
    await assert.rejects(readRetentionPreview(7n, 1))
    assert.equal(requests.length, 3)
    assert.equal(requests.every((request) => request.method === "GET" && request.cache === "no-store"), true)
  } finally { globalThis.fetch = original; registerLumiereApiClient(null) }
})
