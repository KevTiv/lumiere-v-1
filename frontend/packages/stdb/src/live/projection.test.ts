import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  filterRowsForResource,
  rowNotSoftDeleted,
  sortRowsForResource,
} from "./projection.ts"
import { RESOURCE_REGISTRY } from "../generated/query-registry.ts"
import { PURCHASING_WORKSPACE_RESOURCE_KEYS } from "../subscriptions/purchasing-workspace.ts"
import { directRowCacheEnabled } from "./direct-subscription-mode.ts"

describe("direct subscription cache boundary", () => {
  it("remains disabled unless legacy full-row caching is explicitly requested", () => {
    assert.equal(directRowCacheEnabled({ token: "token", organizationId: 42 }), false)
    assert.equal(
      directRowCacheEnabled({
        mode: "legacy-row-cache",
        token: "token",
        organizationId: 42,
      }),
      true,
    )
    assert.equal(
      directRowCacheEnabled({ mode: "legacy-row-cache", organizationId: 42 }),
      false,
    )
  })
})

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

  it("fails closed for company-owned advanced purchasing resources", () => {
    for (const resource of [
      "commodity-price-indexes",
      "consignment-agreements",
      "purchase-approval-delegates",
      "purchase-blanket-order-lines",
      "purchase-blanket-orders",
      "purchase-blanket-releases",
      "purchase-contracts",
      "purchasing-integration-intents",
      "vendor-risk-flags",
      "vendor-scorecards",
    ] as const) {
      assert.deepEqual(
        filterRowsForResource(resource, [{ id: 1, organizationId: 10, companyId: 3 }], {
          organizationId: 10,
          companyIds: [],
        }),
        [],
        `${resource} requires an authorized company`,
      )
      assert.equal(
        filterRowsForResource(resource, [{ id: 1, organizationId: 10, companyId: 3 }], {
          organizationId: 10,
          companyIds: [3],
        }).length,
        1,
        `${resource} retains rows from an authorized company`,
      )
      assert.deepEqual(
        filterRowsForResource(resource, [{ id: 1, organizationId: 10, companyId: 4 }], {
          organizationId: 10,
          companyIds: [3],
        }),
        [],
        `${resource} excludes rows from another company`,
      )
    }
  })

  it("projects purchasing selector fields and workspace master data", () => {
    assert.ok(RESOURCE_REGISTRY.contacts.defaultRestricted.includes("is_vendor"))
    assert.ok(RESOURCE_REGISTRY.contacts.defaultRestricted.includes("supplier_rank"))
    assert.ok(RESOURCE_REGISTRY.products.defaultRestricted.includes("purchase_ok"))
    assert.ok(RESOURCE_REGISTRY.uoms.defaultRestricted.includes("is_active"))
    assert.ok(PURCHASING_WORKSPACE_RESOURCE_KEYS.includes("products"))
    assert.ok(PURCHASING_WORKSPACE_RESOURCE_KEYS.includes("uoms"))
    assert.ok(!PURCHASING_WORKSPACE_RESOURCE_KEYS.includes("contacts"))
  })

  it("sortRowsForResource orders opportunity stages by sequence", () => {
    const rows = sortRowsForResource("opportunity-stages", [
      { id: 2, sequence: 20 },
      { id: 1, sequence: 5 },
    ])
    assert.deepEqual(rows.map((r) => r.id), [1, 2])
  })
})
