import assert from "node:assert/strict"
import test from "node:test"

import { toAddDocumentVersionParams } from "./documents-create-params"

const uploaded = {
  fileName: "v2.pdf",
  fileSize: 256,
  mimetype: "application/pdf",
  url: "/api/documents/blobs/object/1/default/v2",
  checksum: "a".repeat(64),
}

test("maps a completed blob upload to add_document_version params", () => {
  assert.deepEqual(toAddDocumentVersionParams({ ...uploaded, changesDescription: " fixed typo " }), {
    fileName: "v2.pdf",
    fileSize: 256n,
    mimetype: "application/pdf",
    url: uploaded.url,
    checksum: uploaded.checksum,
    changesDescription: "fixed typo",
  })
})

test("accepts string and bigint sizes and falls back to octet-stream", () => {
  const { mimetype: _mimetype, ...rest } = uploaded
  assert.equal(toAddDocumentVersionParams({ ...rest, fileSize: "256" })?.fileSize, 256n)
  assert.equal(toAddDocumentVersionParams({ ...rest, fileSize: 256n })?.mimetype, "application/octet-stream")
})

test("returns null when the upload result is incomplete or empty", () => {
  for (const missing of ["fileName", "url", "checksum"] as const) {
    assert.equal(toAddDocumentVersionParams({ ...uploaded, [missing]: "  " }), null, missing)
  }
  assert.equal(toAddDocumentVersionParams({ ...uploaded, fileSize: 0 }), null)
  assert.equal(toAddDocumentVersionParams({ ...uploaded, fileSize: undefined }), null)
})
