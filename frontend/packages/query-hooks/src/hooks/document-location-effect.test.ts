import assert from "node:assert/strict"
import test from "node:test"
import { resolveDocumentLocationEffect } from "./document-location-effect"

test("root moves require an explicit readable null destination in the exact scope", () => {
  const action = { kind: "moveFolder", id: "3", parentId: null } as const
  const base = { id: "3", organizationId: "7", companyId: "9" }
  assert.equal(resolveDocumentLocationEffect([base], 7n, 9n, action), null)
  assert.equal(
    resolveDocumentLocationEffect([{ ...base, parentId: "5" }], 7n, 9n, action),
    null,
  )
  assert.equal(
    resolveDocumentLocationEffect(
      [{ ...base, parentId: null, companyId: "10" }],
      7n,
      9n,
      action,
    ),
    null,
  )
  assert.deepEqual(
    resolveDocumentLocationEffect(
      [{ ...base, parentId: null }],
      7n,
      9n,
      action,
    ),
    { resource: "document-folders", id: "3" },
  )
})

test("trash needs a positive authorized trash row and duplicate readback fails", () => {
  const action = { kind: "trashFolder", id: "3" } as const
  const row = { id: "3", organizationId: "7", companyId: "9" }
  assert.equal(resolveDocumentLocationEffect([], 7n, 9n, action), null)
  assert.equal(
    resolveDocumentLocationEffect(
      [{ ...row, organizationId: "8" }],
      7n,
      9n,
      action,
    ),
    null,
  )
  assert.deepEqual(resolveDocumentLocationEffect([row], 7n, 9n, action), {
    resource: "document-folders-deleted",
    id: "3",
  })
  assert.throws(() => resolveDocumentLocationEffect([row, row], 7n, 9n, action))
})

test("document moves and folder restores verify the requested destination", () => {
  const row = {
    id: "3",
    organizationId: "7",
    companyId: "9",
    folderId: "4",
    parentId: "4",
  }
  assert.equal(
    resolveDocumentLocationEffect([row], 7n, 9n, {
      kind: "moveDocument",
      id: "3",
      folderId: null,
    }),
    null,
  )
  assert.ok(
    resolveDocumentLocationEffect([row], 7n, 9n, {
      kind: "moveDocument",
      id: "3",
      folderId: "4",
    }),
  )
  assert.ok(
    resolveDocumentLocationEffect([row], 7n, 9n, {
      kind: "restoreFolder",
      id: "3",
      parentId: "4",
    }),
  )
})

test("invalid destinations cannot be recognized as an already completed root move", () => {
  const row = {
    id: "3",
    organizationId: "7",
    companyId: "9",
    parentId: null,
    folderId: null,
  }
  for (const destination of [
    "",
    "garbage",
    "-1",
    "0",
    "18446744073709551616",
  ]) {
    assert.throws(() =>
      resolveDocumentLocationEffect([row], 7n, 9n, {
        kind: "moveFolder",
        id: "3",
        parentId: destination,
      }),
    )
    assert.throws(() =>
      resolveDocumentLocationEffect([row], 7n, 9n, {
        kind: "moveDocument",
        id: "3",
        folderId: destination,
      }),
    )
  }
})

test("readback rejects missing scope and contradictory canonical aliases", () => {
  const action = { kind: "moveFolder", id: "3", parentId: null } as const
  const row = { id: "3", organizationId: "7", companyId: "9", parentId: null }
  for (const conflicting of [
    { ...row, parent_id: "5" },
    { ...row, company_id: "8" },
    { ...row, organization_id: "8" },
    { ...row, companyId: undefined },
    { ...row, parentId: undefined },
  ])
    assert.equal(
      resolveDocumentLocationEffect([conflicting], 7n, 9n, action),
      null,
    )
  assert.ok(
    resolveDocumentLocationEffect(
      [{ ...row, organization_id: 7, company_id: 9, parent_id: null }],
      7n,
      9n,
      action,
    ),
  )
})
