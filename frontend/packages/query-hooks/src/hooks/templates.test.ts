import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  documentTemplateCreateRequest,
  documentTemplateMatchesScope,
  documentTemplatesQueryKey,
  type DocumentTemplateRow,
} from "./templates"

describe("document template scope", () => {
  it("keeps the legacy invalidation prefix and separates identity and company caches", () => {
    assert.deepEqual(documentTemplatesQueryKey(7), ["document-templates", "7"])
    assert.deepEqual(documentTemplatesQueryKey(7, { identity: "alice", companyId: 2n }), ["document-templates", "7", { identity: "alice", companyId: "2" }])
    assert.notDeepEqual(documentTemplatesQueryKey(7, { identity: "alice", companyId: 2 }), documentTemplatesQueryKey(7, { identity: "bob", companyId: 2 }))
    assert.notDeepEqual(documentTemplatesQueryKey(7, { identity: "alice", companyId: 2 }), documentTemplatesQueryKey(7, { identity: "alice", companyId: 3 }))
    assert.notDeepEqual(documentTemplatesQueryKey(7, { identity: "alice" }), documentTemplatesQueryKey(7, { identity: "alice", companyId: null }))
  })

  it("includes explicit organization defaults and the active company, with camel and snake wire names", () => {
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: "7", companyId: null }, 7, 2n), true)
    assert.equal(documentTemplateMatchesScope({ id: "1", organization_id: "7", company_id: "2" }, 7, 2), true)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 7, companyId: 3 }, 7, 2), false)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 8, companyId: 2 }, 7, 2), false)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 7, companyId: 2 }, 7, null), false)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 7, companyId: null }, 7, null), true)
  })

  it("fails closed on missing, malformed, rounded, or out-of-range scope identifiers", () => {
    const global: DocumentTemplateRow = { id: "1", organizationId: 7, companyId: null }
    for (const companyId of [undefined, 0, -1, 1.5, "", "02", "2oops", "18446744073709551616"]) {
      assert.equal(documentTemplateMatchesScope(global, 7, companyId), false)
    }
    assert.equal(documentTemplateMatchesScope({ id: "1", companyId: null }, 7, 2), false)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 7 }, 7, 2), false)
    assert.equal(documentTemplateMatchesScope({ id: "1", organizationId: 7, companyId: "nope" }, 7, 2), false)
    assert.equal(documentTemplateMatchesScope(global, Number.MAX_SAFE_INTEGER + 1, 2), false)
    assert.equal(documentTemplateMatchesScope(global, "07", 2), false)
  })
})

describe("document template commands", () => {
  it("preserves the existing organization-global create default and supports explicit company creation", () => {
    const params = { name: "Proposal", model: "document", reportType: "lumiere-document-layout-v1", bodyHtml: "<p>Proposal</p>", isDefault: false, isActive: true, metadata: '{"documentDesigner":{"schemaVersion":1}}' }
    const legacy = JSON.parse(documentTemplateCreateRequest(params).init.body as string)
    const scoped = JSON.parse(documentTemplateCreateRequest(params, 12n).init.body as string)
    assert.equal(legacy.companyId, null)
    assert.equal(scoped.companyId, 12)
    assert.equal(scoped.params.body_html, params.bodyHtml)
    assert.deepEqual(scoped.params.metadata, { some: params.metadata })
  })

})
