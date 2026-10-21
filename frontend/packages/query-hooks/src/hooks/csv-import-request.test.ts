import assert from "node:assert/strict"
import { test } from "node:test"
import { createCsvImportRequest, csvImportInvalidatesQuery, csvImportRequestBody, csvImportRequestPath, fetchCsvImportReceipt, parseCsvImportReceipt } from "./csv-import-request"

const request = createCsvImportRequest(1n, "account_move", "name\nAda\n", "moves.csv", { companyId: 9007199254740993n }, "a".repeat(32))
const receipt = {
  ok: true, entity: "account_move", requestId: request.requestId, jobId: "9007199254740993",
  status: "partial", totalRows: 2, rowsImported: 1, errorRows: 1, errorsRedacted: false,
  errors: [{ id: "9007199254740994", jobId: "9007199254740993", rowNumber: 3, fieldName: null, errorMessage: "Invalid account" }],
}

test("round trips IDs above Number.MAX_SAFE_INTEGER without converting them to numbers", () => {
  assert.equal(JSON.parse(csvImportRequestBody(request)).params.companyId, "9007199254740993")
  assert.equal(parseCsvImportReceipt(receipt, request).jobId, "9007199254740993")
})
test("binds exact lookup to selected company and currency", () => {
  const product = createCsvImportRequest(1n, "product", "x", "x.csv", { companyId: 2n, currencyId: 3n }, "b".repeat(32))
  assert.equal(csvImportRequestPath(product, true), `/api/import/product/requests/${"b".repeat(32)}?companyId=2&currencyId=3`)
})
test("rejects receipts from another submission or entity", () => {
  assert.throws(() => parseCsvImportReceipt({ ...receipt, requestId: "b".repeat(32) }, request))
  assert.throws(() => parseCsvImportReceipt({ ...receipt, entity: "hr_employee" }, request))
})
test("rejects numeric job IDs even if a response would otherwise look valid", () => {
  assert.throws(() => parseCsvImportReceipt({ ...receipt, jobId: 9007199254740993 }, request))
})
test("rejects errors from a different job and invalid counts", () => {
  assert.throws(() => parseCsvImportReceipt({ ...receipt, errors: [{ ...receipt.errors[0], jobId: "2" }] }, request))
  assert.throws(() => parseCsvImportReceipt({ ...receipt, errorRows: -1 }, request))
})
test("accepts all terminal states without treating failed/rolled_back as an uncommitted submission", () => {
  for (const status of ["success", "partial", "failed", "rolled_back"]) {
    assert.equal(parseCsvImportReceipt({ ...receipt, status }, request).status, status)
  }
})
test("retains more than 500 job-scoped row errors", () => {
  const errors = Array.from({ length: 700 }, (_, i) => ({ ...receipt.errors[0], id: String(i + 1), rowNumber: i + 2 }))
  assert.equal(parseCsvImportReceipt({ ...receipt, errors, errorRows: 700 }, request).errors.length, 700)
})
test("retry after response loss sends byte-identical request with the same token", async () => {
  const bodies: string[] = []
  let calls = 0
  const fetcher = async (_path: string, init?: RequestInit) => {
    bodies.push(String(init?.body))
    if (++calls === 1) throw new Error("Response lost")
    return Response.json(receipt)
  }
  await assert.rejects(fetchCsvImportReceipt(request, fetcher), /Response lost/)
  const recovered = await fetchCsvImportReceipt(request, fetcher)
  assert.equal(recovered.requestId, request.requestId)
  assert.equal(bodies[0], bodies[1])
})
test("missing capability rejects and never calls a legacy reducer", async () => {
  let calls = 0
  await assert.rejects(fetchCsvImportReceipt(request, async () => { calls++; return new Response(null, { status: 503 }) }), /contracts must be updated/)
  assert.equal(calls, 1)
})
test("missing exact lookup remains recoverable without selecting any recent job", async () => {
  await assert.rejects(fetchCsvImportReceipt(request, async () => new Response(null, { status: 404 }), true), /not visible yet/)
})
test("invalidates only affected organization accounting keys", () => {
  assert.equal(csvImportInvalidatesQuery(["stdb", "account-moves", "1"], request), true)
  assert.equal(csvImportInvalidatesQuery(["stdb", "account-move-lines", 1], request), true)
  assert.equal(csvImportInvalidatesQuery(["stdb", "account-moves", "2"], request), false)
  assert.equal(csvImportInvalidatesQuery(["stdb", "account-taxes", "1"], request), false)
  assert.equal(csvImportInvalidatesQuery(["documents", "1"], request), false)
  assert.equal(csvImportInvalidatesQuery(["typed-stdb", "account-moves", "1", "company", "9007199254740993"], request), true)
  assert.equal(csvImportInvalidatesQuery(["typed-stdb", "account-moves", "1", "company", 2], request), false)
  assert.equal(csvImportInvalidatesQuery(["typed-stdb", "account-moves", "2"], request), false)
})
test("invalidates company reads in frozen submission context", () => {
  const scoped = { ...request, entity: "purchase_order" }
  assert.equal(csvImportInvalidatesQuery(["purchase-orders", "9007199254740993"], scoped), true)
  assert.equal(csvImportInvalidatesQuery(["purchase-orders", "1"], scoped), false)
})
test("invalid scopes fail before issuing any request", () => {
  assert.throws(() => createCsvImportRequest(1n, "hr_employee", "x", "x.csv", {}, "a".repeat(32)))
  assert.throws(() => createCsvImportRequest(1n, "product", "x", "x.csv", { currencyId: 9007199254740992 }, "a".repeat(32)))
  assert.throws(() => createCsvImportRequest(1n, "product", "x", "x.csv", { companyId: 0n }, "a".repeat(32)))
})
