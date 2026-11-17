import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  canCleanupAbandonedAccountMoveImport,
  canRollbackImportJob,
  fetchExactImportJob,
  fetchExactImportJobErrorPage,
  importJobReadPath,
} from "./import-jobs"

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

describe("exact import job reads", () => {
  const jobId = "9007199254740993"

  it("includes the operating company and exact decimal job in the query path", () => {
    assert.equal(
      importJobReadPath("import-jobs", 17, jobId),
      `/api/query/import-jobs?companyId=17&jobId=${jobId}`,
    )
    assert.throws(() => importJobReadPath("import-jobs", 17, "../jobs"), /Invalid import job/)
    assert.throws(() => importJobReadPath("import-jobs", 0, jobId), /Invalid import job/)
  })

  it("accepts an exact job or an empty authorized result while rejecting another job", async () => {
    const row = { id: jobId, status: "partial" }
    assert.deepEqual(await fetchExactImportJob(17, jobId, async () => Response.json({ data: [row] })), [row])
    assert.deepEqual(await fetchExactImportJob(17, jobId, async () => Response.json({ data: [] })), [])
    for (const data of [null, [null], [{ ...row, id: "42" }], [row, row]]) {
      await assert.rejects(
        fetchExactImportJob(17, jobId, async () => Response.json({ data })),
        /could not be verified/,
      )
    }
  })

  it("loads diagnostics page by page without substituting results from another job", async () => {
    const first = { data: [{ id: "255", jobId, rowNumber: 701 }], nextCursor: "255" }
    const second = { data: [{ id: "254", job_id: jobId, row_number: 700 }], nextCursor: null }
    const paths: string[] = []
    const fetcher = async (input: string | URL | Request) => {
      paths.push(String(input))
      return Response.json(paths.length === 1 ? first : second)
    }
    assert.deepEqual(await fetchExactImportJobErrorPage(17, jobId, undefined, fetcher), first)
    assert.deepEqual(await fetchExactImportJobErrorPage(17, jobId, first.nextCursor, fetcher), second)
    assert.deepEqual(paths, [
      `/api/query/import-job-errors?companyId=17&jobId=${jobId}`,
      `/api/query/import-job-errors?companyId=17&jobId=${jobId}&cursor=255`,
    ])
    await assert.rejects(
      fetchExactImportJobErrorPage(17, jobId, "255", async () => Response.json(first)),
      /could not be verified/,
    )
    await assert.rejects(
      fetchExactImportJobErrorPage(17, jobId, undefined, async () =>
        Response.json({ data: [{ jobId: "42" }], nextCursor: null })),
      /could not be verified/,
    )
  })

  it("preserves denied diagnostics as a query error", async () => {
    await assert.rejects(
      fetchExactImportJobErrorPage(17, jobId, undefined, async () =>
        new Response(null, { status: 403 })),
      { status: 403 },
    )
  })
})
