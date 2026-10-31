import assert from "node:assert/strict"
import test from "node:test"
import {
  documentRegistrationParams, documentReceiptStorageKey, findDocumentSubmission,
  loadDocumentSubmissionPointers, resumeDocumentSubmission, saveDocumentSubmissionPointer,
  type DocumentUploadReceipt, type DocumentSubmissionPointer,
} from "./document-upload-receipts"

const scope = { organizationId: 7n, companyId: 3n, actorId: "actor" }
const pointer: DocumentSubmissionPointer = { submissionId: "a".repeat(32), fileName: "farm.csv", checksum: "b".repeat(64), requestHash: "c".repeat(64) }
function saved(overrides: Partial<DocumentUploadReceipt> = {}): DocumentUploadReceipt {
  return { submissionId: pointer.submissionId, objectKey: `org-7/default/${"d".repeat(32)}`, url: `/api/documents/blobs/object/7/default/${"d".repeat(32)}`,
    fileName: "farm.csv", fileSize: "42", mimetype: "text/csv", checksum: pointer.checksum, fileSaved: true, bytesUploaded: true,
    registration: { name: "Farm import", folderId: "9007199254740993", tagIds: [], isFavorite: false },
    registrationState: "unconfirmed", documentId: null, indexing: "pending", ...overrides }
}

test("save and registration succeed independently of indexing; refresh only retries indexing", async () => {
  let server = saved()
  let creates = 0
  let indexes = 0
  let failIndexing = true
  const changes: DocumentUploadReceipt[] = []
  const ports = {
    assertCurrent: () => undefined,
    read: async () => structuredClone(server),
    create: async () => { creates++; server = { ...server, documentId: "99", registrationState: "registered" }; return { resource: "documents", id: "99" } },
    index: async (id: string) => { assert.equal(id, "99"); indexes++; server.indexing = failIndexing ? "failed" : "queued"; if (failIndexing) throw new Error("AI unavailable") },
    changed: (receipt: DocumentUploadReceipt) => changes.push(receipt),
  }
  const first = await resumeDocumentSubmission(ports)
  assert.equal(first.documentId, "99")
  assert.equal(first.fileSaved, true)
  assert.equal(first.indexing, "failed")
  // A fresh coordinator, exactly as after refresh, reads the durable server receipt.
  failIndexing = false
  const resumed = await resumeDocumentSubmission({ ...ports }, { retryIndexing: true })
  assert.equal(resumed.indexing, "queued")
  assert.equal(creates, 1)
  assert.equal(indexes, 2)
  assert.ok(changes.some((receipt) => receipt.fileSaved && !receipt.documentId))
  await resumeDocumentSubmission(ports, { retryIndexing: true })
  assert.equal(indexes, 2, "accepted queue request is not dispatched again")
})

test("lost registration response recovers its exact record without a second create", async () => {
  let server = saved()
  let creates = 0
  const ports = {
    assertCurrent: () => undefined,
    read: async () => server,
    create: async () => { creates++; server = saved({ documentId: "123", registrationState: "registered" }); throw new Error("lost response") },
    index: async () => { server = { ...server, indexing: "queued" } },
    changed: () => undefined,
  }
  await assert.rejects(resumeDocumentSubmission(ports), /lost response/)
  const recovered = await resumeDocumentSubmission(ports)
  assert.equal(recovered.documentId, "123")
  assert.equal(creates, 1)
})

test("a historical receipt retains its original source without indexing the current version", async () => {
  let effects = 0
  const receipt = saved({ documentId: "123", registrationState: "registered", indexing: "superseded" })
  const recovered = await resumeDocumentSubmission({
    assertCurrent: () => undefined,
    read: async () => receipt,
    create: async () => { effects++; return { resource: "documents", id: "123" } },
    index: async () => { effects++ },
    changed: () => undefined,
  }, { retryIndexing: true })
  assert.equal(recovered.url, receipt.url)
  assert.equal(recovered.indexing, "superseded")
  assert.equal(effects, 0)
})

test("company or permission changes during a read prevent every later effect", async () => {
  let current = true
  let effects = 0
  await assert.rejects(resumeDocumentSubmission({
    assertCurrent: () => { if (!current) throw new Error("scope changed") },
    read: async () => { current = false; return saved() },
    create: async () => { effects++; return { resource: "documents", id: "1" } },
    index: async () => { effects++ }, changed: () => { effects++ },
  }), /scope changed/)
  assert.equal(effects, 0)
})

test("submission pointers survive reload and isolate actor, company and organization", () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  saveDocumentSubmissionPointer(storage, scope, pointer)
  saveDocumentSubmissionPointer(storage, scope, pointer)
  assert.deepEqual(loadDocumentSubmissionPointers(storage, scope), [pointer])
  for (const other of [{ ...scope, companyId: 4n }, { ...scope, organizationId: 8n }, { ...scope, actorId: "other" }]) {
    assert.notEqual(documentReceiptStorageKey(other), documentReceiptStorageKey(scope))
    assert.deepEqual(loadDocumentSubmissionPointers(storage, other), [])
  }
  assert.equal(findDocumentSubmission([pointer], { ...pointer, submissionId: "e".repeat(32) }), pointer)
  assert.equal(findDocumentSubmission([pointer], { ...pointer, checksum: "f".repeat(64) }), undefined)
  assert.equal(findDocumentSubmission([pointer], { ...pointer, requestHash: "f".repeat(64) }), undefined)
})

test("receipt registration retains exact large IDs and stable submission identity", () => {
  const params = documentRegistrationParams(saved())
  assert.equal(params.folderId, 9007199254740993n)
  assert.equal(params.fileSize, 42n)
  assert.equal(params.url, saved().url)
  assert.equal(params.metadata, JSON.stringify({ uploadSubmissionId: pointer.submissionId }))
})

test("missing file bytes cannot create a document or invoke AI", async () => {
  let calls = 0
  await assert.rejects(resumeDocumentSubmission({
    assertCurrent: () => undefined,
    read: async () => saved({ fileSaved: false, bytesUploaded: false }),
    create: async () => { calls++; return { resource: "documents", id: "1" } },
    index: async () => { calls++ }, changed: () => undefined,
  }), /Reselect the original file/)
  assert.equal(calls, 0)
})


test("worker states and unavailable reads never repeat upload, registration or indexing", async () => {
  for (const indexing of ["running", "completed", "unavailable", "queued"] as const) {
    let effects = 0
    const receipt = saved({ documentId: "123", registrationState: "registered", indexing })
    const recovered = await resumeDocumentSubmission({
      assertCurrent: () => undefined, read: async () => receipt,
      create: async () => { effects++; return { resource: "documents", id: "123" } },
      index: async () => { effects++ }, changed: () => undefined,
    }, { retryIndexing: true })
    assert.equal(recovered.indexing, indexing)
    assert.equal(effects, 0)
  }
})

test("a lost indexing reply recovers a terminal worker receipt without another dispatch", async () => {
  let server = saved({ documentId: "123", registrationState: "registered" })
  let effects = 0
  const ports = {
    assertCurrent: () => undefined, read: async () => server,
    create: async () => { throw new Error("registration must not repeat") },
    index: async () => { effects++; server = { ...server, indexing: "completed" }; throw new Error("reply lost") },
    changed: () => undefined,
  }
  assert.equal((await resumeDocumentSubmission(ports)).indexing, "completed")
  assert.equal((await resumeDocumentSubmission(ports, { retryIndexing: true })).indexing, "completed")
  assert.equal(effects, 1)
})
