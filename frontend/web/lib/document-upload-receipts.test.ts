import assert from "node:assert/strict"
import test from "node:test"
import {
  documentRegistrationParams, documentReceiptStorageKey, documentUploadReceiptSchema, findDocumentSubmission,
  loadDocumentSubmissionPointers, resumeDocumentSubmission, saveDocumentSubmissionPointer,
  readDocumentUploadReceipt,
  type DocumentUploadReceipt, type DocumentSubmissionPointer,
} from "./document-upload-receipts"
import { releaseSavedVersionLock } from "./document-version-check-in"

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
  assert.equal((await resumeDocumentSubmission(ports)).documentId, "123")
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

test("a version save and lost reply recover the exact revision without creating another document or version", async () => {
  let server = saved({ registration: { name: "farm.csv", versionDocumentId: "123", changesDescription: "Corrected counts", tagIds: [], isFavorite: false } })
  let versions = 0
  let indexing = 0
  const ports = {
    assertCurrent: () => undefined, read: async () => structuredClone(server),
    create: async () => { throw new Error("version recovery must never create a document") },
    addVersion: async (documentId: string, params: { changesDescription?: string }) => {
      assert.equal(documentId, "123")
      assert.equal(params.changesDescription, "Corrected counts")
      versions++
      server = { ...server, documentId: "123", versionId: "456", registrationState: "registered" }
      throw new Error("version reply lost")
    },
    index: async (_documentId: string, receipt: DocumentUploadReceipt) => {
      assert.equal(receipt.versionId, "456")
      assert.equal(receipt.objectKey, server.objectKey)
      indexing++
      server = { ...server, indexing: "failed" }
      throw new Error("index unavailable")
    },
    changed: () => undefined,
  }
  const first = await resumeDocumentSubmission(ports)
  assert.equal(first.versionId, "456")
  assert.equal(first.indexing, "failed")
  await resumeDocumentSubmission(ports, { retryIndexing: true })
  assert.equal(versions, 1)
  assert.equal(indexing, 2)
  server = { ...server, indexing: "superseded" }
  await resumeDocumentSubmission(ports, { retryIndexing: true })
  assert.equal(versions, 1)
  assert.equal(indexing, 2)
  assert.throws(() => documentRegistrationParams(server), /cannot create a new document/)
})

test("receipt parsing accepts the server inspection envelope and binds it to the same source", async () => {
  const originalFetch = globalThis.fetch
  const receipt = saved({ inspection: {
    schemaVersion: 1, policyVersion: "document-admission-v2", organizationId: 7, companyId: 3,
    objectKey: saved().objectKey, sourceSha256: saved().checksum, sourceSize: 42,
    contentType: "text/csv", fileName: "farm.csv", profile: "csv", sourceTrust: "untrusted",
    processingAllowed: true, aiAllowed: false, datasetSha256: saved().checksum,
  } })
  assert.equal(documentUploadReceiptSchema.parse(receipt).inspection?.aiAllowed, false)
  try {
    globalThis.fetch = async () => Response.json(receipt)
    assert.equal((await readDocumentUploadReceipt(scope, pointer))?.checksum, saved().checksum)
    for (const changes of [{ organizationId: 8 }, { companyId: 4 }, { sourceSha256: "e".repeat(64) }, { processingAllowed: false }]) {
      globalThis.fetch = async () => Response.json({ ...receipt, inspection: { ...receipt.inspection, ...changes } })
      await assert.rejects(readDocumentUploadReceipt(scope, pointer), /inspection does not match/)
    }
  } finally { globalThis.fetch = originalFetch }
})

test("a structurally admitted file remains saved when its inspection disallows AI", async () => {
  const receipt = saved({ documentId: "123", registrationState: "registered", inspection: {
    schemaVersion: 1, policyVersion: "document-admission-v2", organizationId: 7, companyId: 3,
    objectKey: saved().objectKey, sourceSha256: saved().checksum, sourceSize: 42,
    contentType: "text/csv", fileName: "farm.csv", profile: "csv", sourceTrust: "untrusted",
    processingAllowed: true, aiAllowed: false,
  } })
  let indexed = 0
  const result = await resumeDocumentSubmission({
    assertCurrent: () => undefined, read: async () => receipt,
    create: async () => { throw new Error("already saved") },
    index: async () => { indexed++ }, changed: () => undefined,
  }, { retryIndexing: true })
  assert.equal(result.fileSaved, true)
  assert.equal(result.documentId, "123")
  assert.equal(indexed, 0)
})

test("server-owned bill provenance survives receipt registration and recovery", () => {
  const metadata = { source: "accounting_bill_intake", uploaded_by: "actor", object_key: saved().objectKey }
  const params = documentRegistrationParams(saved({ registration: { ...saved().registration, metadata: JSON.stringify(metadata) } }))
  assert.deepEqual(JSON.parse(params.metadata!), { ...metadata, uploadSubmissionId: pointer.submissionId })
})

test("version retry unlocks only its current, actor-owned lock and checks fresh scope", async () => {
  const receipt = saved({ documentId: "123", versionId: "456", registrationState: "registered", registration: { ...saved().registration, versionDocumentId: "123" } })
  const actorScope = { ...scope, actorId: "aa".repeat(32) }
  const row = { id: "123", organizationId: "7", companyId: "3", currentVersionId: "456", isLocked: true, lockedBy: `0x${actorScope.actorId}` }
  let unlocked = 0
  const ports = { receipt, scope: actorScope, assertCurrent: () => undefined, read: async () => [row], unlock: async () => { unlocked++ } }
  await releaseSavedVersionLock(ports)
  assert.equal(unlocked, 1)
  for (const change of [{ isLocked: false }, { currentVersionId: "457" }, { lockedBy: "bb".repeat(32) }]) {
    await releaseSavedVersionLock({ ...ports, read: async () => [{ ...row, ...change }] })
  }
  assert.equal(unlocked, 1)
  let allowed = true
  await assert.rejects(releaseSavedVersionLock({ ...ports, assertCurrent: () => { if (!allowed) throw new Error("scope changed") }, read: async () => { allowed = false; return [row] } }), /scope changed/)
  assert.equal(unlocked, 1)
})
