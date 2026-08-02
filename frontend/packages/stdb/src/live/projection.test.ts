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
      { organizationId: 10, companyIds: [3] },
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.name, "A")
  })

  it("filters company-owned CRM rows and retains explicit organization-shared contacts", () => {
    const rows = filterRowsForResource(
      "contacts",
      [
        { id: 1, organizationId: 10, companyId: 3, name: "A" },
        { id: 2, organizationId: 10, companyId: 4, name: "B" },
        { id: 3, organizationId: 10, companyId: null, name: "Shared" },
      ],
      { organizationId: 10, companyIds: [3] },
    )
    assert.deepEqual(rows.map((row) => row.name), ["A", "Shared"])
  })

  it("fails closed for ambiguous company scope and parent-owned child rows", () => {
    assert.deepEqual(
      filterRowsForResource(
        "contacts",
        [{ id: 1, organizationId: 10, companyId: 3 }],
        { organizationId: 10, companyIds: [3, 4] },
      ),
      [],
    )
    assert.deepEqual(
      filterRowsForResource(
        "opportunity-lines",
        [{ id: 1, organizationId: 10, opportunityId: 99 }],
        { organizationId: 10, companyIds: [3] },
      ),
      [],
    )
  })

  it("sortRowsForResource orders opportunity stages by sequence", () => {
    const rows = sortRowsForResource("opportunity-stages", [
      { id: 2, sequence: 20 },
      { id: 1, sequence: 5 },
    ])
    assert.deepEqual(rows.map((r) => r.id), [1, 2])
  })
})
