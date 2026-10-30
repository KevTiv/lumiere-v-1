import assert from "node:assert/strict"
import { test } from "node:test"
import {
  executeRecordCreation, recordCreationStorageKey, RecordCreationRejected, withRecordCreationEnvelope,
} from "./record-creation-invocation"
import type { ReceiptStorage } from "./purchasing-receipt-invocation"

const scope = { organizationId: 1n, companyId: 2n, actorHex: "a".repeat(64) }
const model = "contact" as const
const payload = '{"name":"Ada","metadata":"{\\"custom:risk\\":false,\\"custom:score\\":0}"}'

function memory(): ReceiptStorage {
  const rows = new Map<string, string>()
  return { getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value) }, removeItem: (key) => { rows.delete(key) } }
}

function receipt(operationKey: string, changes: object = {}) {
  return { id: `1:2:contact:${operationKey}`, organization_id: "1", company_id: "2", model, operation_key: operationKey,
    record_id: "9007199254740993", payload_hash: `sha256:${"b".repeat(64)}`, ...changes }
}

const request = (key: string) => JSON.stringify({ params: { name: "Ada", metadata: withRecordCreationEnvelope('{"custom:risk":false,"custom:score":0}', 2n, key) } })

test("creation envelope preserves false, zero, exact identifiers and rejects form-supplied identities", () => {
  const result = JSON.parse(withRecordCreationEnvelope('{"custom:risk":false,"custom:score":0,"custom:empty":""}', 9007199254740993n, "attempt-1"))
  assert.equal(result["custom:risk"], false)
  assert.equal(result["custom:score"], 0)
  assert.equal(result["custom:empty"], "")
  assert.equal(result.__lumiere_create_v1.company_id, "9007199254740993")
  assert.throws(() => withRecordCreationEnvelope('{"__lumiere_create_v1":{}}', 2n, "attempt-1"), /cannot be supplied/)
  assert.throws(() => withRecordCreationEnvelope("[]", 2n, "attempt-1"), /must be an object/)
  assert.throws(() => withRecordCreationEnvelope("{}", 2n, "bad'key"), /valid creation identity/)
})

test("identity and complete input are durable before POST; exact result clears only its scope", async () => {
  const storage = memory()
  const otherScope = { ...scope, companyId: 3n }
  storage.setItem(recordCreationStorageKey(otherScope, model), "other attempt")
  let writes = 0
  let saved = false
  const id = await executeRecordCreation(scope, model, payload, storage, {
    assertScope() {}, makeKey: () => "attempt-1", makeRequest: request,
    read: async (key) => saved ? [receipt(key)] : [],
    dispatch: async (body) => {
      const pending = JSON.parse(storage.getItem(recordCreationStorageKey(scope, model))!)
      assert.equal(pending.requestJson, body)
      assert.equal(pending.phase, "uncertain")
      assert.equal(pending.payloadJson, payload)
      assert.equal(pending.operationKey, "attempt-1")
      writes++; saved = true
    },
  })
  assert.equal(id, "9007199254740993")
  assert.equal(writes, 1)
  assert.equal(storage.getItem(recordCreationStorageKey(scope, model)), null)
  assert.equal(storage.getItem(recordCreationStorageKey(otherScope, model)), "other attempt")
})

test("lost response after commit recovers exact saved record without a second POST", async () => {
  const storage = memory()
  let saved = false
  let writes = 0
  const ports = { assertScope() {}, makeKey: () => "attempt-1", makeRequest: request,
    read: async (key: string) => saved ? [receipt(key)] : [],
    dispatch: async () => { writes++; saved = true; throw new Error("connection lost") } }
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, ports), /connection lost/)
  assert.equal(await executeRecordCreation(scope, model, payload, storage, ports), "9007199254740993")
  assert.equal(writes, 1)
})

test("uncertain empty read cannot replace an in-flight request with changed input", async () => {
  const storage = memory()
  let writes = 0
  const ports = { assertScope() {}, makeKey: () => "attempt-1", makeRequest: request,
    read: async () => [], dispatch: async () => { writes++; throw new Error("timeout") } }
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, ports), /timeout/)
  await assert.rejects(executeRecordCreation(scope, model, '{"name":"Different"}', storage, ports), /previous save is unresolved/)
  assert.equal(writes, 1)
})

test("explicit retry checks first and reuses the same immutable key and bytes", async () => {
  const storage = memory()
  const sent: string[] = []
  let committed = false
  let generated = 0
  const ports = { assertScope() {}, makeKey: () => `attempt-${++generated}`, makeRequest: request,
    read: async (key: string) => committed ? [receipt(key)] : [],
    dispatch: async (body: string) => { sent.push(body); if (sent.length === 1) throw new Error("timeout"); committed = true } }
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, ports), /timeout/)
  assert.equal(await executeRecordCreation(scope, model, payload, storage, ports), "9007199254740993")
  assert.equal(generated, 1)
  assert.equal(sent.length, 2)
  assert.equal(sent[0], sent[1])
})

test("a definite rejection permits corrected input only after its authoritative recovery read", async () => {
  const storage = memory()
  let generated = 0
  let committed = false
  const events: string[] = []
  const ports = { assertScope() {}, makeKey: () => `attempt-${++generated}`, makeRequest: request,
    read: async (key: string) => { events.push(`read:${key}`); return committed ? [receipt(key)] : [] },
    dispatch: async () => { events.push("write"); if (generated === 1) throw new RecordCreationRejected("custom option invalid"); committed = true } }
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, ports), /custom option invalid/)
  assert.equal(await executeRecordCreation(scope, model, "corrected", storage, ports), "9007199254740993")
  assert.deepEqual(events, ["read:capability_probe", "write", "read:attempt-1", "write", "read:attempt-2"])
})

test("denied or unavailable capability read cannot dispatch a partial record", async () => {
  for (const reason of ["403 denied", "receipt owner unavailable"]) {
    let writes = 0
    const storage = memory()
    await assert.rejects(executeRecordCreation(scope, model, payload, storage, {
      assertScope() {}, makeKey: () => "attempt-1", makeRequest: request,
      read: async () => { throw new Error(reason) }, dispatch: async () => { writes++ },
    }), new RegExp(reason))
    assert.equal(writes, 0)
    assert.equal(storage.getItem(recordCreationStorageKey(scope, model)), null)
  }
})

test("actor/company switch during a read prevents any write", async () => {
  let current = true
  let writes = 0
  await assert.rejects(executeRecordCreation(scope, model, payload, memory(), {
    assertScope() { if (!current) throw new Error("company changed") }, makeKey: () => "attempt-1", makeRequest: request,
    read: async () => { current = false; return [] }, dispatch: async () => { writes++ },
  }), /company changed/)
  assert.equal(writes, 0)
})

test("switch after POST preserves original recovery evidence and does not return another company's result", async () => {
  const storage = memory()
  let current = true
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, {
    assertScope() { if (!current) throw new Error("actor changed") }, makeKey: () => "attempt-1", makeRequest: request,
    read: async () => [], dispatch: async () => { current = false },
  }), /actor changed/)
  assert.ok(storage.getItem(recordCreationStorageKey(scope, model)))
})

test("unavailable storage and corrupt or modified attempts fail before dispatch", async () => {
  let writes = 0
  const ports = { assertScope() {}, makeKey: () => "attempt-1", makeRequest: request, read: async () => [], dispatch: async () => { writes++ } }
  const storage = memory()
  storage.setItem(recordCreationStorageKey(scope, model), "corrupt")
  await assert.rejects(executeRecordCreation(scope, model, payload, storage, ports), /invalid/)
  const unavailable = { ...memory(), setItem() { throw new Error("quota") } }
  await assert.rejects(executeRecordCreation(scope, model, payload, unavailable, ports), /Cannot preserve/)
  assert.equal(writes, 0)
})

test("foreign, duplicate or malformed exact receipts never claim a successful save", async () => {
  for (const kind of ["foreign", "duplicate", "bad-hash"]) {
    const storage = memory()
    let saved = false
    await assert.rejects(executeRecordCreation(scope, model, payload, storage, {
      assertScope() {}, makeKey: () => "attempt-1", makeRequest: request,
      read: async (key) => {
        if (!saved) return []
        if (kind === "duplicate") return [receipt(key), receipt(key)]
        return [receipt(key, kind === "foreign" ? { company_id: "3" } : { payload_hash: "bad" })]
      }, dispatch: async () => { saved = true },
    }), kind === "duplicate" ? /Multiple saved records/ : /does not agree/)
    assert.ok(storage.getItem(recordCreationStorageKey(scope, model)))
  }
})
