import assert from "node:assert/strict"
import test from "node:test"
import { decodeDeletedDocumentFolders } from "./deleted-document-folders"

const folder = { id: "18446744073709551615", organizationId: "7" }

test("folder trash preserves exact IDs, permitted metadata, and explicit root", () => {
  const rows = decodeDeletedDocumentFolders(
    {
      data: [
        {
          ...folder,
          companyId: 9,
          parentId: null,
          name: "Old invoices",
          writeDate: { microsSinceUnixEpoch: 0 },
          privateMetadata: "Never part of this projection",
        },
        { id: 2, organizationId: 7 },
      ],
    },
    7n,
    9n,
  )
  assert.equal(rows[0]?.id, folder.id)
  assert.equal(rows[0]?.companyId, "9")
  assert.equal(rows[0]?.parentId, null)
  assert.equal(rows[0]?.name, "Old invoices")
  assert.equal(rows[0]?.writeDate, "1970-01-01T00:00:00.000Z")
  assert.equal(rows[1]?.parentId, undefined)
  assert.equal(rows[1]?.name, undefined)
  assert.equal(Object.hasOwn(rows[0]!, "privateMetadata"), false)
})

test("folder trash fails the read on malformed or out-of-scope evidence", () => {
  for (const payload of [
    { data: null },
    { data: [null] },
    { data: [folder, folder] },
    { data: [{ ...folder, organizationId: 8 }] },
    { data: [{ ...folder, companyId: 10 }] },
    { data: [{ ...folder, id: Number.MAX_SAFE_INTEGER + 1 }] },
    { data: [{ ...folder, parentId: {} }] },
  ]) {
    assert.throws(() => decodeDeletedDocumentFolders(payload, 7n, 9n), {
      name: "QueryResponseDecodeError",
    })
  }
})
