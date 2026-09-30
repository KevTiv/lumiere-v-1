import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import { resolveArchivedFinancialReportEffect } from "./reports"

const row = {
  id: "41",
  organizationId: "7",
  companyId: "8",
  state: { tag: "Archived" },
}

describe("resolveArchivedFinancialReportEffect", () => {
  it("returns the same scoped report only in Archived state", () => {
    assert.deepEqual(
      resolveArchivedFinancialReportEffect([row], 7n, 8n, 41n),
      { resource: "financial-reports", id: "41" },
    )
    assert.deepEqual(
      resolveArchivedFinancialReportEffect(
        [{ ...row, organizationId: undefined, organization_id: 7n, companyId: undefined, company_id: 8n, state: { archived: [] } }],
        7n,
        8n,
        41n,
      ),
      { resource: "financial-reports", id: "41" },
    )
  })

  it("fails closed for identity, scope, or state mismatch", () => {
    assert.equal(
      resolveArchivedFinancialReportEffect([row], 7n, 8n, 42n),
      null,
    )
    assert.equal(
      resolveArchivedFinancialReportEffect([{ ...row, organizationId: "9" }], 7n, 8n, 41n),
      null,
    )
    assert.equal(
      resolveArchivedFinancialReportEffect([{ ...row, companyId: "9" }], 7n, 8n, 41n),
      null,
    )
    assert.equal(
      resolveArchivedFinancialReportEffect([{ ...row, state: { tag: "Exported" } }], 7n, 8n, 41n),
      null,
    )
  })

  it("rejects duplicate exact report identities", () => {
    assert.throws(
      () => resolveArchivedFinancialReportEffect([row, { ...row }], 7n, 8n, 41n),
      AmbiguousOperationEffectError,
    )
  })
})
