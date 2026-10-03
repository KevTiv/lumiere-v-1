import assert from "node:assert/strict"
import test from "node:test"

import {
  formConfigVersion,
  resolveFormPublishEffect,
  resolveImportCommitEffect,
  sha256Hex,
} from "./form-import-effect"
import { AmbiguousOperationEffectError } from "./operation-effect"

const form = (id: bigint, org: bigint, moduleId: string, formId: string, version: number, isActive = true) => ({
  id,
  organizationId: org,
  moduleId,
  formId,
  configVersion: version,
  isActive,
})

test("first publish resolves the exact form at config_version 1", () => {
  assert.deepEqual(resolveFormPublishEffect([form(3n, 1n, "crm", "new-lead", 1)], 1n, "crm", "new-lead", null), {
    resource: "form-configs",
    id: "3",
  })
})

test("republish requires exactly the next version", () => {
  const rows = [form(3n, 1n, "crm", "new-lead", 2)]
  assert.deepEqual(resolveFormPublishEffect(rows, 1n, "crm", "new-lead", 1), { resource: "form-configs", id: "3" })
  assert.equal(resolveFormPublishEffect(rows, 1n, "crm", "new-lead", 2), null)
  assert.equal(resolveFormPublishEffect(rows, 1n, "crm", "new-lead", 0), null)
})

test("other forms, other organizations and inactive rows never prove the effect", () => {
  assert.equal(resolveFormPublishEffect([form(3n, 1n, "crm", "other", 1)], 1n, "crm", "new-lead", null), null)
  assert.equal(resolveFormPublishEffect([form(3n, 2n, "crm", "new-lead", 1)], 1n, "crm", "new-lead", null), null)
  assert.equal(resolveFormPublishEffect([form(3n, 1n, "crm", "new-lead", 1, false)], 1n, "crm", "new-lead", null), null)
})

test("accepts snake_case rows and reports the prior version", () => {
  const rows = [{ id: "3", organization_id: "1", module_id: "crm", form_id: "new-lead", config_version: 4, is_active: true }]
  assert.equal(formConfigVersion(rows, 1n, "crm", "new-lead"), 4)
  assert.equal(formConfigVersion(rows, 1n, "crm", "missing"), null)
  assert.deepEqual(resolveFormPublishEffect(rows, 1n, "crm", "new-lead", 3), { resource: "form-configs", id: "3" })
})

test("duplicate form rows are an invariant failure, not newest-wins", () => {
  const rows = [form(3n, 1n, "crm", "new-lead", 1), form(4n, 1n, "crm", "new-lead", 2)]
  assert.throws(() => resolveFormPublishEffect(rows, 1n, "crm", "new-lead", 1), AmbiguousOperationEffectError)
})

const job = (id: bigint, org: bigint, table: string, status: string, sha: string | null) => ({
  id,
  organizationId: org,
  tableName: table,
  status,
  metadata: sha === null ? null : JSON.stringify({ sha256: sha }),
})

test("sha256Hex matches the standard test vector", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
})

test("import commit resolves the exact job stamped with the file hash", () => {
  const jobs = [job(7n, 1n, "hr_payslip", "success", "aa"), job(8n, 1n, "hr_payslip", "success", "bb")]
  assert.deepEqual(resolveImportCommitEffect(jobs, 1n, "hr_payslip", "bb"), { resource: "import-jobs", id: "8" })
})

test("failed, pending, foreign-org, wrong-entity and unstamped jobs do not prove a commit", () => {
  assert.equal(resolveImportCommitEffect([job(7n, 1n, "hr_payslip", "failed", "aa")], 1n, "hr_payslip", "aa"), null)
  assert.equal(resolveImportCommitEffect([job(7n, 1n, "hr_payslip", "pending", "aa")], 1n, "hr_payslip", "aa"), null)
  assert.equal(resolveImportCommitEffect([job(7n, 2n, "hr_payslip", "success", "aa")], 1n, "hr_payslip", "aa"), null)
  assert.equal(resolveImportCommitEffect([job(7n, 1n, "hr_leave", "success", "aa")], 1n, "hr_payslip", "aa"), null)
  assert.equal(resolveImportCommitEffect([job(7n, 1n, "hr_payslip", "success", null)], 1n, "hr_payslip", "aa"), null)
})

test("two committed jobs for one hash are an invariant failure", () => {
  const jobs = [job(7n, 1n, "hr_payslip", "success", "aa"), job(8n, 1n, "hr_payslip", "partial", "aa")]
  assert.throws(() => resolveImportCommitEffect(jobs, 1n, "hr_payslip", "aa"), AmbiguousOperationEffectError)
})
