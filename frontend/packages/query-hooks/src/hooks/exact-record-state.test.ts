import assert from "node:assert/strict"
import test from "node:test"

import { enumState, resolveExactRecordState } from "./exact-record-state"

test("resolves only the exact tenant record in the requested state", () => {
  const rows = [
    { id: 7n, organizationId: 1n, status: { tag: "Waived" } },
    { id: 7n, organizationId: 2n, status: { tag: "Completed" } },
  ]
  assert.deepEqual(
    resolveExactRecordState(
      rows,
      1n,
      7n,
      "tax-deadlines",
      (row) => enumState(row.status) === "waived",
      "/accounting?tab=tax-deadlines&recordId=7",
    ),
    {
      resource: "tax-deadlines",
      id: "7",
      href: "/accounting?tab=tax-deadlines&recordId=7",
    },
  )
  assert.equal(
    resolveExactRecordState(rows, 1n, 7n, "tax-deadlines", (row) => enumState(row.status) === "completed"),
    null,
  )
})

test("duplicate exact records are an invariant failure", () => {
  assert.throws(() =>
    resolveExactRecordState(
      [
        { id: 7n, organizationId: 1n },
        { id: 7n, organizationId: 1n },
      ],
      1n,
      7n,
      "records",
      () => true,
    ),
  )
})
