import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { importContentSha256, resolveCommittedImportJob, type ImportJobProjection } from "./import-job-effect"

const SHA = "a".repeat(64)

const job = (extra: Partial<ImportJobProjection> = {}): ImportJobProjection => ({
  id: 9n,
  organizationId: 1n,
  tableName: "hr_payslip",
  status: "success",
  importedRows: 3n,
  errorRows: 0n,
  metadata: JSON.stringify({ content_sha256: SHA }),
  ...extra,
})

test("matches the server's shared content-identity test vector", async () => {
  // Same vector as `test_payslip_csv_import_is_idempotent_by_content` (hr wave A).
  const expected = "8c47e084bb26445ec05f1b7fc32f63590ac6c43a920e07e8965e9f4315a3a2c3"
  assert.equal(await importContentSha256("hr_payslip", "﻿  a,b\r\n1,2\r\n\n"), expected)
  assert.equal(await importContentSha256("hr_payslip", "a,b\n1,2"), expected)
})

test("content identity is scoped by table and sensitive to content", async () => {
  const base = await importContentSha256("hr_payslip", "a,b\n1,2")
  assert.notEqual(await importContentSha256("hr_leave", "a,b\n1,2"), base)
  assert.notEqual(await importContentSha256("hr_payslip", "a,b\n1,3"), base)
  assert.notEqual(await importContentSha256("hr_payslip", "a,b\n1,2\n3,4"), base)
})

test("resolves the committed job for the content", () => {
  const effect = resolveCommittedImportJob([job({ id: 8n, metadata: JSON.stringify({ content_sha256: "b".repeat(64) }) }), job()], 1n, "hr_payslip", SHA)
  assert.deepEqual(effect, {
    ref: { resource: "import-jobs", id: "9" },
    importedRows: 3,
    errorRows: 0,
    status: "success",
  })
})

test("accepts snake_case rows, Option metadata and partial jobs", () => {
  const rows = [{
    id: "9",
    organization_id: "1",
    table_name: "hr_payslip",
    status: "partial",
    imported_rows: "2",
    error_rows: "1",
    metadata: { some: JSON.stringify({ content_sha256: SHA }) },
  }]
  assert.equal(resolveCommittedImportJob(rows, 1n, "hr_payslip", SHA)?.status, "partial")
  assert.equal(resolveCommittedImportJob(rows, 1n, "hr_payslip", SHA)?.errorRows, 1)
})

test("a job that imported nothing, was rolled back or is elsewhere is no effect", () => {
  for (const other of [
    job({ importedRows: 0n, status: "failed" }),
    job({ status: "rolled_back" }),
    job({ organizationId: 2n }),
    job({ tableName: "hr_leave" }),
    job({ metadata: null }),
    job({ metadata: "not json" }),
  ]) {
    assert.equal(resolveCommittedImportJob([other], 1n, "hr_payslip", SHA), null)
  }
})

test("a failed retry does not hide the committed job", () => {
  const failed = job({ id: 10n, importedRows: 0n, status: "failed" })
  assert.equal(resolveCommittedImportJob([failed, job()], 1n, "hr_payslip", SHA)?.ref.id, "9")
})

test("throws when one content committed twice", () => {
  assert.throws(() => resolveCommittedImportJob([job(), job({ id: 10n })], 1n, "hr_payslip", SHA), AmbiguousOperationEffectError)
})
