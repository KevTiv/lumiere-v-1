import assert from "node:assert/strict"
import test from "node:test"

import { resolveDocumentCreateEffect, type DocumentCreateProjection } from "./document-create-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const expected = { url: "/blob/a", checksum: "ab".repeat(32), resModel: "lead", resId: 7n }
const doc = (id: bigint, over: Partial<DocumentCreateProjection> = {}): DocumentCreateProjection => ({
  id,
  organizationId: 1n,
  url: expected.url,
  checksum: expected.checksum,
  resModel: "lead",
  resId: 7n,
  ...over,
})

test("resolves the new document for the blob and record", () => {
  assert.deepEqual(resolveDocumentCreateEffect([doc(1n, { url: "/old" })], [doc(1n, { url: "/old" }), doc(2n)], 1n, expected), {
    resource: "documents",
    id: "2",
  })
})

test("accepts snake_case rows and Option-wrapped cells", () => {
  const row = { id: 3n, organization_id: 1n, url: { some: expected.url }, checksum: { some: expected.checksum.toUpperCase() }, res_model: { some: "lead" }, res_id: { some: 7n } }
  assert.equal(resolveDocumentCreateEffect([], [row], 1n, expected)?.id, "3")
})

test("ignores other organizations, records and pre-existing rows; null when unread", () => {
  assert.equal(resolveDocumentCreateEffect([doc(2n)], [doc(2n)], 1n, expected), null)
  assert.equal(resolveDocumentCreateEffect([], [doc(2n, { organizationId: 9n })], 1n, expected), null)
  assert.equal(resolveDocumentCreateEffect([], [doc(2n, { resId: 8n })], 1n, expected), null)
})

test("two new matches are ambiguous", () => {
  assert.throws(() => resolveDocumentCreateEffect([], [doc(2n), doc(3n)], 1n, expected), AmbiguousOperationEffectError)
})
