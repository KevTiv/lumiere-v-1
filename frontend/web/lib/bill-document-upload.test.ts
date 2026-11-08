import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveBillDocumentAttempt, uploadBillSourceDocument, type BillDocumentAttempt, type BillDocumentScope } from "./bill-document-upload"
import { billDocumentAttemptKey, readBillDocumentAttempt, subscribeBillDocumentAttempt, writeBillDocumentAttempt } from "./bill-document-attempts"
import type { DocumentRegistration, DocumentUploadReceipt } from "./document-upload-receipts"

const scope: BillDocumentScope = { organizationId: 1n, companyId: 2n, billId: 3n, actorId: "aa".repeat(32), partnerId: 4n }
const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" })
const uploaded = { url: "/api/documents/blobs/object/1/eu/0123456789abcdef0123456789abcdef", objectKey: "org-1/eu/0123456789abcdef0123456789abcdef", fileSize: BigInt(file.size), checksum: "ab".repeat(32), mimetype: "application/pdf", fileName: "receipt.pdf" }
const document = { id: "7", organizationId: 1n, companyId: 2n, resModel: "account_move", resId: 3n, url: uploaded.url, checksum: uploaded.checksum, fileName: uploaded.fileName, fileSize: uploaded.fileSize, mimetype: uploaded.mimetype, ownerId: { __identity__: `0x${scope.actorId}` }, metadata: JSON.stringify({ source: "accounting_bill_intake", object_key: uploaded.objectKey, uploaded_by: scope.actorId }) }
const saved: DocumentUploadReceipt = {
  ...uploaded, fileSize: String(uploaded.fileSize), submissionId: "a".repeat(32), fileSaved: true, bytesUploaded: true,
  registration: { name: file.name, resModel: "account_move", resId: "3", tagIds: [], isFavorite: false },
  registrationState: "registered", documentId: "7", versionId: "8", indexing: "failed",
}

describe("managed bill document attachment", () => {
  it("uses the shared submission and confirms the exact bill link even when indexing failed", async () => {
    const attempts: BillDocumentAttempt[] = []
    let registration: DocumentRegistration | undefined
    await uploadBillSourceDocument({ file, scope, isCurrent: () => true, submit: async (supplied, details) => { assert.equal(supplied, file); registration = details; return saved }, readDocuments: async () => [document], onAttempt: (attempt) => attempts.push(attempt) })
    assert.equal(registration?.resModel, "account_move")
    assert.equal(registration?.resId, "3")
    assert.equal(registration?.partnerId, "4")
    assert.deepEqual(JSON.parse(registration?.metadata ?? ""), { source: "accounting_bill_intake" }, "the server supplies actor and object provenance")
    assert.equal(attempts.at(-1)?.phase, "attached")
    assert.equal(attempts.at(-1)?.documentId, "7")
  })

  it("does not claim attachment success after company/actor/permissions change", async () => {
    let current = true
    let read = false
    const attempts: BillDocumentAttempt[] = []
    await assert.rejects(uploadBillSourceDocument({ file, scope, isCurrent: () => current, submit: async () => { current = false; return saved }, readDocuments: async () => { read = true; return [document] }, onAttempt: (attempt) => attempts.push(attempt) }), /scope or document permissions changed/)
    assert.equal(read, false)
    assert.equal(attempts.at(-1)?.phase, "unknown")
    assert.equal(attempts.at(-1)?.documentId, "7")
  })

  it("never resolves an older same-content blob, another owner, or another document", () => {
    assert.equal(resolveBillDocumentAttempt([{ ...document, url: "/api/documents/blobs/object/1/eu/ffffffffffffffffffffffffffffffff" }], scope, uploaded), null)
    assert.equal(resolveBillDocumentAttempt([document], scope, uploaded), "7")
    assert.equal(resolveBillDocumentAttempt([{ ...document, ownerId: "bb".repeat(32) }], scope, uploaded), null)
    assert.equal(resolveBillDocumentAttempt([document], scope, uploaded, "8"), null)
  })

  it("keeps the saved document ID when final bill readback fails", async () => {
    const attempts: BillDocumentAttempt[] = []
    await assert.rejects(uploadBillSourceDocument({ file, scope, isCurrent: () => true, submit: async () => saved, readDocuments: async () => { throw new Error("Read denied") }, onAttempt: (attempt) => attempts.push(attempt) }), /Read denied/)
    assert.equal(attempts.at(-1)?.phase, "unknown")
    assert.equal(attempts.at(-1)?.documentId, "7")
  })

  it("rejects a receipt for another bill, foreign URLs, unsupported types and unsafe company IDs", async () => {
    let submissions = 0
    const dependencies = { file, scope, isCurrent: () => true, submit: async () => { submissions++; return { ...saved, url: "https://foreign.test/receipt" } }, readDocuments: async () => [document], onAttempt: () => {} }
    await assert.rejects(uploadBillSourceDocument({ ...dependencies, scope: { ...scope, companyId: 9007199254740993n } }), /represented safely/)
    assert.equal(submissions, 0)
    await assert.rejects(uploadBillSourceDocument(dependencies), /managed upload/)
    await assert.rejects(uploadBillSourceDocument({ ...dependencies, file: new File(["x"], "receipt.html", { type: "text/html" }) }), /Choose a non-empty PDF/)
    await assert.rejects(uploadBillSourceDocument({ ...dependencies, submit: async () => ({ ...saved, registration: { ...saved.registration, resId: "999" } }) }), /does not confirm this bill/)
  })

  it("accepts the managed API's canonicalized non-ASCII filename", async () => {
    const original = new File(["receipt"], "facturé(1).pdf", { type: "application/pdf" })
    await uploadBillSourceDocument({ file: original, scope, isCurrent: () => true, submit: async () => ({ ...saved, fileName: "factur__1_.pdf" }), readDocuments: async () => [{ ...document, fileName: "factur__1_.pdf" }], onAttempt: () => {} })
  })

  it("notifies reopened subscribers without exposing another actor's pending attempt", () => {
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
