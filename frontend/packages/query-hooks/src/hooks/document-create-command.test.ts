import assert from "node:assert/strict"
import test from "node:test"
import { documentCreateCommand, documentFolderCreateCommand } from "./document-create-command"

test("source folders encode company scope and every optional struct field", () => {
  const command = documentFolderCreateCommand({ companyId: 4097n, name: "Source archive", description: "Historic CSVs", parentId: undefined, storageId: undefined, residencyRegion: undefined, metadata: undefined, sequence: 10, isHidden: false, isReadonly: false, isFavorite: false, isAccessRestricted: false })
  const body = JSON.parse(String(command.init.body))
  assert.equal(command.urlPath, "/api/operations/erp.create_document_folder")
  assert.deepEqual(body.companyId, { some: 4097 })
  assert.deepEqual(body.params.description, { some: "Historic CSVs" })
  for (const key of ["parent_id", "storage_id", "residency_region", "metadata"]) assert.deepEqual(body.params[key], { none: [] })
  assert.ok(!("company_id" in body.params))
  assert.ok(!("organizationId" in body))
})

test("an organization folder keeps an explicit absent company scope", () => {
  const body = JSON.parse(String(documentFolderCreateCommand({ name: "Source archive", description: undefined, parentId: undefined, storageId: undefined, residencyRegion: undefined, metadata: undefined, sequence: 10, isHidden: false, isReadonly: false, isFavorite: false, isAccessRestricted: false }).init.body))
  assert.deepEqual(body.companyId, { none: [] })
})

test("document registration sends an optional company and retains the blob checksum", () => {
  const body = JSON.parse(String(documentCreateCommand(4097n, { name: "Historic source", checksum: "a".repeat(64), folderId: 18n }).init.body))
  assert.deepEqual(body.companyId, { some: 4097 })
  assert.deepEqual(body.params.folder_id, { some: 18 })
  assert.equal(body.params.checksum, "a".repeat(64))
  assert.deepEqual(body.params.metadata, { none: [] })
})
