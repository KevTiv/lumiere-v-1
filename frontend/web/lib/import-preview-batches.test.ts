import assert from "node:assert/strict"
import test from "node:test"

import { previewAllImportRows } from "./import-preview-batches"

test("previews more than 100 rows in bounded batches and corrects row indexes", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => [`row-${index}`])
  const batchSizes: number[] = []
  const result = await previewAllImportRows(
    { targetEntity: "account_move", headers: ["name"], rows, mapping: { name: "name" } },
    async (batch) => {
      batchSizes.push(batch.rows.length)
      return {
        target_entity: batch.targetEntity,
        rows: batch.rows.map(([name]) => ({ name })),
        validation_errors:
          batch.rows.at(-1)?.[0] === "row-199"
            ? [{ row_index: 99, field: "name", message: "invalid", severity: "error" }]
            : [],
        safety: {
          findings:
            batch.rows[0]?.[0] === "row-200"
              ? [{ location: "row[2].col[0]", kind: "warning", message: "review", severity: "warning" }]
              : [],
          blocked_cell_count: 0,
          is_safe_for_ai: true,
        },
        warnings: ["review dates"],
      }
    },
  )

  assert.deepEqual(batchSizes, [100, 100, 5])
  assert.equal(result.rows.length, 205)
  assert.equal(result.validation_errors[0]?.row_index, 199)
  assert.equal(result.safety.findings[0]?.location, "row[202].col[0]")
  assert.deepEqual(result.warnings, ["review dates"])
})

test("fails closed when a batch response omits rows", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => [`row-${index}`])
  await assert.rejects(
    () =>
      previewAllImportRows(
        { targetEntity: "account_move", headers: ["name"], rows, mapping: { name: "name" } },
        async (batch) => ({
          target_entity: batch.targetEntity,
          rows: batch.rows.slice(0, 99).map(([name]) => ({ name })),
          validation_errors: [],
          safety: { findings: [], blocked_cell_count: 0, is_safe_for_ai: true },
          warnings: [],
        }),
      ),
    /Import was blocked so no unpreviewed rows are submitted/,
  )
})
