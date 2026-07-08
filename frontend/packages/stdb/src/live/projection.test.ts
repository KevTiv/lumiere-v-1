import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  filterRowsForResource,
  rowNotSoftDeleted,
  sortRowsForResource,
} from "./projection.ts"

describe("live/projection", () => {
  it("rowNotSoftDeleted treats missing deletedAt as live", () => {
    assert.equal(rowNotSoftDeleted({ id: 1 }), true)
    assert.equal(rowNotSoftDeleted({ id: 1, deletedAt: null }), true)
  })

  it("filterRowsForResource scopes contacts by organization", () => {
    const rows = filterRowsForResource(
      "contacts",
      [
        { id: 1, organizationId: 10, name: "A" },
        { id: 2, organizationId: 11, name: "B" },
      ],
      { organizationId: 10 },
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.name, "A")
  })

  it("sortRowsForResource orders opportunity stages by sequence", () => {
    const rows = sortRowsForResource("opportunity-stages", [
      { id: 2, sequence: 20 },
      { id: 1, sequence: 5 },
    ])
    assert.deepEqual(rows.map((r) => r.id), [1, 2])
  })
})
