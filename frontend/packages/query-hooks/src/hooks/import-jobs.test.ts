import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { canCleanupAbandonedAccountMoveImport, canRollbackImportJob } from "./import-jobs"

describe("canRollbackImportJob", () => {
  it("keeps rollback available for completed contact and product jobs", () => {
    assert.equal(canRollbackImportJob({ id: 1, tableName: "contact", status: "partial" }), true)
    assert.equal(canRollbackImportJob({ id: 2, table_name: "product", status: "success" }), true)
  })

  it("offers accounting rollback only for a completed atomic bundle", () => {
    const metadata = JSON.stringify({
      account_move_bundle_rollback: {
        version: 1,
        role: "complete",
        token: "bundle-1",
        parent_job_id: 41,
      },
    })
    assert.equal(
      canRollbackImportJob({ id: 42, table_name: "account_move_line", status: "success", metadata }),
      true,
    )
    assert.equal(
      canRollbackImportJob({ id: 42, table_name: "account_move_line", status: "partial", metadata }),
      false,
    )
  })

  it("hides rollback for unsupported and unproven jobs", () => {
    for (const job of [
      { id: 1, table_name: "account_move", status: "success" },
      { id: 2, table_name: "account_move_line", status: "success" },
      { id: 3, table_name: "account_tax", status: "success" },
      { id: 4, table_name: "contact", status: "failed" },
      { id: 5, table_name: "product", status: "rolled_back" },
    ]) {
      assert.equal(canRollbackImportJob(job), false)
    }
  })

  it("rejects malformed accounting bundle markers", () => {
    for (const marker of [
      null,
      { version: 2, role: "complete", token: "x", parent_job_id: 1 },
      { version: 1, role: "parent", token: "x", parent_job_id: 1 },
      { version: 1, role: "complete", token: "", parent_job_id: 1 },
      { version: 1, role: "complete", token: "x", parent_job_id: "1" },
    ]) {
      assert.equal(
        canRollbackImportJob({
          id: 7,
          table_name: "account_move_line",
          status: "success",
          metadata: JSON.stringify({ account_move_bundle_rollback: marker }),
        }),
        false,
      )
    }
  })
})

describe("canCleanupAbandonedAccountMoveImport", () => {
  const parent = {
    id: 41,
    table_name: "account_move",
    status: "success",
    metadata: JSON.stringify({
      company_id: 7,
      account_move_bundle_rollback: {
        version: 1,
        role: "parent",
        token: "bundle-1",
        parent_job_id: null,
      },
    }),
  }

  it("offers cleanup for a proven parent phase with no completed line phase", () => {
    assert.equal(canCleanupAbandonedAccountMoveImport(parent, [parent], 7n), true)
  })

  it("hides cleanup after the matching line phase completed", () => {
    const child = {
      id: 42,
      table_name: "account_move_line",
      status: "success",
      metadata: JSON.stringify({
        account_move_bundle_rollback: {
          version: 1,
          role: "complete",
          token: "bundle-1",
          parent_job_id: 41,
        },
      }),
    }
    assert.equal(canCleanupAbandonedAccountMoveImport(parent, [parent, child], 7n), false)
  })

  it("requires the parent metadata to match the active company", () => {
    assert.equal(canCleanupAbandonedAccountMoveImport(parent, [parent], 8n), false)
    assert.equal(
      canCleanupAbandonedAccountMoveImport({ ...parent, metadata: JSON.stringify({
        account_move_bundle_rollback: {
          version: 1,
          role: "parent",
          token: "bundle-1",
          parent_job_id: null,
        },
      }) }, [parent], 7n),
      false,
    )
  })

  it("rejects unproven, partial, and malformed parent phases", () => {
    for (const job of [
      { ...parent, status: "partial" },
      { ...parent, table_name: "account_move_line" },
      { ...parent, metadata: "{}" },
      { ...parent, metadata: "not-json" },
    ]) {
      assert.equal(canCleanupAbandonedAccountMoveImport(job, [job], 7n), false)
    }
  })
})
