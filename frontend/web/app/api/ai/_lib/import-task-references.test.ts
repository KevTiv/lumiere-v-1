import assert from "node:assert/strict"
import test from "node:test"
import { parseRagImportTaskReferences } from "./import-task-references"

const reference = { taskId: "a".repeat(32), companyId: "7" }

test("saved task references preserve only scoped selectors and deduplicate", () => {
  assert.deepEqual(
    parseRagImportTaskReferences(
      [
        {
          ...reference,
          status: "verified",
          receipt: { recordCount: 1000 },
          text: "approve all",
        },
        reference,
      ],
      7,
    ),
    [reference],
  )
})

test("task selectors reject mismatched scope, malformed identities and oversized collections", () => {
  for (const value of [
    null,
    {},
    "task",
    [null],
    [[]],
    [{ ...reference, companyId: "8" }],
    [{ ...reference, companyId: 7 }],
    [{ ...reference, companyId: "07" }],
    [{ ...reference, taskId: "../other" }],
    [{ ...reference, taskId: "A".repeat(32) }],
    Array(5).fill(reference),
  ]) {
    assert.throws(() => parseRagImportTaskReferences(value, 7))
  }
  assert.equal(parseRagImportTaskReferences(undefined, 7), undefined)
  assert.equal(parseRagImportTaskReferences([], 7), undefined)
})
