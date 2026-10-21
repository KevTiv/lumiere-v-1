import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveBillDocumentAttempt, uploadBillSourceDocument, type BillDocumentAttempt, type BillDocumentScope } from "./bill-document-upload"
import { billDocumentAttemptKey, readBillDocumentAttempt, subscribeBillDocumentAttempt, writeBillDocumentAttempt } from "./bill-document-attempts"

const scope: BillDocumentScope = { organizationId: 1n, companyId: 2n, billId: 3n, actorId: "aa".repeat(32), partnerId: 4n }
const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" })
const uploaded = { url: "/api/documents/blobs/object/1/eu/0123456789abcdef0123456789abcdef", objectKey: "org-1/eu/0123456789abcdef0123456789abcdef", fileSize: BigInt(file.size), checksum: "ab".repeat(32), mimetype: "application/pdf", fileName: "receipt.pdf" }
const document = { id: "7", organizationId: 1n, companyId: 2n, resModel: "account_move", resId: 3n, url: uploaded.url, checksum: uploaded.checksum, fileName: uploaded.fileName, fileSize: uploaded.fileSize, mimetype: uploaded.mimetype, ownerId: { __identity__: `0x${scope.actorId}` }, metadata: JSON.stringify({ source: "accounting_bill_intake", object_key: uploaded.objectKey, uploaded_by: scope.actorId }) }

describe("managed bill document attachment", () => {
  it("uploads local bytes, pins the exact bill and managed blob, and confirms canonical attachment", async () => {
    const attempts: BillDocumentAttempt[] = []
    let created: Record<string, unknown> | undefined
    await uploadBillSourceDocument({ file, scope, isCurrent: () => true, upload: async (args) => { assert.equal(args.companyId, 2n); assert.equal(args.file, file); return uploaded }, create: async (params) => { created = params as unknown as Record<string, unknown>; return { resource: "documents", id: "7" } }, readDocuments: async () => [document], onAttempt: (attempt) => attempts.push(attempt) })
    assert.equal(created?.resModel, "account_move")
    assert.equal(created?.resId, 3n)
    assert.equal(created?.url, uploaded.url)
    assert.equal(attempts.at(-1)?.phase, "attached")
    assert.equal(attempts.at(-1)?.documentId, "7")
  })

  it("stops before create if company/actor/permissions change during upload", async () => {
    let current = true; let created = false
    const attempts: BillDocumentAttempt[] = []
    await assert.rejects(uploadBillSourceDocument({ file, scope, isCurrent: () => current, upload: async () => { current = false; return uploaded }, create: async () => { created = true; return { resource: "documents", id: "7" } }, readDocuments: async () => [document], onAttempt: (attempt) => attempts.push(attempt) }), /scope or document permissions changed/)
    assert.equal(created, false)
    assert.equal(attempts.at(-1)?.phase, "error")
  })

  it("retains an unknown link result without accepting an older same-content blob", async () => {
    const attempts: BillDocumentAttempt[] = []
    await assert.rejects(uploadBillSourceDocument({ file, scope, isCurrent: () => true, upload: async () => uploaded, create: async () => { throw new Error("Response lost") }, readDocuments: async () => [document], onAttempt: (attempt) => attempts.push(attempt) }), /Response lost/)
    assert.equal(attempts.at(-1)?.phase, "unknown")
    assert.equal(resolveBillDocumentAttempt([{ ...document, url: "/api/documents/blobs/object/1/eu/ffffffffffffffffffffffffffffffff" }], scope, uploaded), null)
    assert.equal(resolveBillDocumentAttempt([document], scope, uploaded), "7")
    assert.equal(resolveBillDocumentAttempt([{ ...document, ownerId: "bb".repeat(32) }], scope, uploaded), null)
    assert.equal(resolveBillDocumentAttempt([document], scope, uploaded, "8"), null)
  })

  it("keeps the returned document ID when its final readback fails", async () => {
    const attempts: BillDocumentAttempt[] = []
    await assert.rejects(uploadBillSourceDocument({ file, scope, isCurrent: () => true, upload: async () => uploaded, create: async () => ({ resource: "documents", id: "7" }), readDocuments: async () => { throw new Error("Read denied") }, onAttempt: (attempt) => attempts.push(attempt) }), /Read denied/)
    assert.equal(attempts.at(-1)?.phase, "unknown")
    assert.equal(attempts.at(-1)?.documentId, "7")
  })

  it("rejects unsafe company conversion, foreign URLs and unsupported local file types before linking", async () => {
    let created = false; let uploads = 0
    const dependencies = { file, scope, isCurrent: () => true, upload: async () => { uploads++; return { ...uploaded, url: "https://foreign.test/receipt" } }, create: async () => { created = true; return { resource: "documents", id: "7" } }, readDocuments: async () => [document], onAttempt: () => {} }
    await assert.rejects(uploadBillSourceDocument({ ...dependencies, scope: { ...scope, companyId: 9007199254740993n } }), /represented safely/)
    assert.equal(uploads, 0)
    await assert.rejects(uploadBillSourceDocument(dependencies), /managed upload/)
    await assert.rejects(uploadBillSourceDocument({ ...dependencies, file: new File(["x"], "receipt.html", { type: "text/html" }) }), /Choose a non-empty PDF/)
    assert.equal(created, false)
  })

  it("accepts the managed API's canonicalized non-ASCII filename", async () => {
    const original = new File(["receipt"], "facturé(1).pdf", { type: "application/pdf" })
    const canonical = { ...uploaded, fileName: "factur__1_.pdf" }
    await uploadBillSourceDocument({ file: original, scope, isCurrent: () => true, upload: async () => canonical, create: async () => ({ resource: "documents", id: "7" }), readDocuments: async () => [{ ...document, fileName: canonical.fileName }], onAttempt: () => {} })
  })

  it("notifies a reopened subscriber when its original in-flight attempt finishes, isolating actors", () => {
    const key = billDocumentAttemptKey(scope, scope.actorId!)
    let notifications = 0
    const unsubscribeOriginal = subscribeBillDocumentAttempt(key, () => notifications++)
    writeBillDocumentAttempt(key, { phase: "pending", uploaded })
    unsubscribeOriginal()
    const unsubscribeReopened = subscribeBillDocumentAttempt(key, () => notifications++)
    writeBillDocumentAttempt(key, { phase: "attached", uploaded, documentId: "7" })
    assert.equal(notifications, 2)
    assert.equal(readBillDocumentAttempt(key)?.phase, "attached")
    assert.equal(readBillDocumentAttempt(billDocumentAttemptKey(scope, "another-actor")), undefined)
    unsubscribeReopened()
  })
})
