import assert from "node:assert/strict"
import test from "node:test"
import { createCsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"
import { clearImportRecovery, importRecoveryKey, readImportRecovery, retainImportRequest } from "./guided-import-recovery"
import { reviewedImportSource, type ReviewField, type ReviewRow } from "./import-review-model"

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

test("838 reviewed rows retain their complete source provenance across refresh", () => {
  const fields: ReviewField[] = ["name", "sale_price", "cost_price", "uom_id", "uom_po_id", "category_id"].map((key) => ({
    key, label: key, kind: "text", sourceValue: null, required: true,
  }))
  const items: ReviewRow[] = Array.from({ length: 838 }, (_, index) => ({
    id: String(index + 1), state: "confirmed", revision: 2,
    reason: "Confirmed product units and prices against the original paper register; reviewed figures retained for the July farm import.",
    confirmedFields: fields.map((field) => field.key), reviewedBy: scope.actor, reviewedAt: null,
    source: {
      key: String(index + 1), label: `Farm product ${index + 1}`,
      source: { file: `farm-historical-2024-07-file-${index % 15 + 1}.csv`, row: index + 2, sha256: "a".repeat(64), rowBasis: "source_line" },
      issue: "Review source units and prices.", fields, proposed: {},
    },
    values: { name: `Farm product ${index + 1}`, sale_price: "4800", cost_price: "3000", uom_id: "11", uom_po_id: "11", category_id: "21" },
  }))
  const source = reviewedImportSource({ id: "77", title: "Farm import", targetEntity: "product", sourceFile: "Farm history", items, history: [] })
  assert.ok(new TextEncoder().encode(source.csv).byteLength > 512_000, "Provenance must exercise the former recovery limit")
  const submission = createCsvImportRequest(8001n, "product", source.csv, source.fileName, { companyId: 9001, currencyId: 646 }, "c".repeat(32))
  const local = storage()
  retainImportRequest(local, scope, submission)
  assert.deepEqual(readImportRecovery(local, scope)?.request, submission)
  assert.equal(new Set(items.map((item) => item.source.source.file)).size, 15)
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
  for (const update of [{ organizationId: "8002" }, { companyId: "9002" }, { currencyId: "not-an-id" }, { requestId: "x" }, { csvData: " " }]) {
    const broken = storage()
    broken.setItem(importRecoveryKey(scope), JSON.stringify({ version: 1, scope, request: { ...request, ...update } }))
    assert.throws(() => readImportRecovery(broken, scope))
  }
  const oversized = { ...request, csvData: "x".repeat(2_000_001) }
  const bounded = storage()
  assert.throws(() => retainImportRequest(bounded, scope, oversized), /2 MB refresh-recovery limit/)
  assert.equal(readImportRecovery(bounded, scope), null)
})
