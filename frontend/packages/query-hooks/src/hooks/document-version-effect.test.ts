import assert from "node:assert/strict"
import test from "node:test"

import { resolveDocumentVersionEffect, type DocumentVersionProjection } from "./document-version-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const blob = { url: "/blob/v2", checksum: "ab".repeat(32) }
const v = (
  id: bigint,
  documentId: bigint,
  over: Partial<DocumentVersionProjection> = {},
): DocumentVersionProjection => ({
  id,
  organizationId: 1n,
  documentId,
  url: blob.url,
  checksum: blob.checksum,
  isCurrent: true,
  ...over,
})
const old = v(1n, 5n, { url: "/blob/v1", checksum: "cd".repeat(32) })

test("resolves the new current version for the exact document and blob", () => {
  assert.deepEqual(
    resolveDocumentVersionEffect([old], [{ ...old, isCurrent: false }, v(2n, 5n)], 1n, 5n, blob),
    { resource: "document-versions", id: "2" },
  )
})

test("accepts snake_case rows and uppercase checksums", () => {
  const row = { id: "2", organization_id: "1", document_id: "5", url: blob.url, checksum: blob.checksum.toUpperCase(), is_current: true }
  assert.deepEqual(resolveDocumentVersionEffect([old], [old, row], 1n, 5n, blob), {
    resource: "document-versions",
    id: "2",
  })
})

test("returns null when no new matching version exists", () => {
  assert.equal(resolveDocumentVersionEffect([old], [old], 1n, 5n, blob), null)
  assert.equal(resolveDocumentVersionEffect([old], [old, v(2n, 6n)], 1n, 5n, blob), null)
  assert.equal(resolveDocumentVersionEffect([old], [old, v(2n, 5n, { organizationId: 2n })], 1n, 5n, blob), null)
  assert.equal(resolveDocumentVersionEffect([old], [old, v(2n, 5n, { checksum: "ff".repeat(32) })], 1n, 5n, blob), null)
  assert.equal(resolveDocumentVersionEffect([old], [old, v(2n, 5n, { isCurrent: false })], 1n, 5n, blob), null)
})

test("a version that already existed before dispatch is not the effect", () => {
  assert.equal(resolveDocumentVersionEffect([v(2n, 5n)], [v(2n, 5n)], 1n, 5n, blob), null)
})

test("throws when more than one new version matches", () => {
  assert.throws(
    () => resolveDocumentVersionEffect([old], [old, v(2n, 5n), v(3n, 5n)], 1n, 5n, blob),
    AmbiguousOperationEffectError,
  )
})
