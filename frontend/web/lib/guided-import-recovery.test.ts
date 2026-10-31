import assert from "node:assert/strict"
import test from "node:test"
import { createCsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"
import { clearImportRecovery, importRecoveryKey, readImportRecovery, retainImportRequest } from "./guided-import-recovery"

const scope = { actor: "ab".repeat(32), organizationId: 8001, companyId: 9001 }
const request = createCsvImportRequest(8001n, "product", "name,sale_price,cost_price\nSausage,4800,3000", "farm.csv", { companyId: 9001, currencyId: 646 }, "a".repeat(32))
function storage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
}

test("refresh restores the exact submission, bytes, scope and request ID", () => {
  const local = storage()
  retainImportRequest(local, scope, request)
  assert.deepEqual(readImportRecovery(local, scope)?.request, request)
  retainImportRequest(local, scope, request)
  assert.deepEqual(readImportRecovery(local, scope)?.request, request)
})

test("actor and company switches cannot read another retained submission", () => {
  const local = storage()
  retainImportRequest(local, scope, request)
  assert.equal(readImportRecovery(local, { ...scope, actor: "cd".repeat(32) }), null)
  assert.equal(readImportRecovery(local, { ...scope, companyId: 9002 }), null)
  assert.throws(() => retainImportRequest(local, { ...scope, companyId: 9002 }, request), /does not match/)
})

test("another request cannot replace an unresolved save, even for the same source", () => {
  const local = storage()
  retainImportRequest(local, scope, request)
  assert.throws(() => retainImportRequest(local, scope, { ...request, requestId: "b".repeat(32) }), /retained import result/)
  assert.throws(() => retainImportRequest(local, scope, { ...request, csvData: "changed" }), /retained import result/)
  assert.throws(() => clearImportRecovery(local, scope, "b".repeat(32)), /Another import/)
  assert.deepEqual(readImportRecovery(local, scope)?.request, request)
  clearImportRecovery(local, scope, request.requestId)
  assert.equal(readImportRecovery(local, scope), null)
})

test("corruption, quota failure and mismatched scope fail before dispatch", () => {
  const local = storage()
  local.setItem(importRecoveryKey(scope), "{invalid")
  assert.throws(() => readImportRecovery(local, scope))
  assert.throws(() => retainImportRequest(local, scope, request))
  const unavailable = { ...storage(), setItem: () => { throw new Error("Quota exceeded") } }
  assert.throws(() => retainImportRequest(unavailable, scope, request), /Quota exceeded/)
  for (const update of [{ organizationId: "8002" }, { companyId: "9002" }, { currencyId: "not-an-id" }, { requestId: "x" }, { csvData: " " }, { csvData: "x".repeat(512_001) }]) {
    const broken = storage()
    broken.setItem(importRecoveryKey(scope), JSON.stringify({ version: 1, scope, request: { ...request, ...update } }))
    assert.throws(() => readImportRecovery(broken, scope))
  }
})
