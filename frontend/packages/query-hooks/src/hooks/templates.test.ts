import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  documentTemplateCreateRequest,
  documentTemplateMatchesScope,
  documentTemplateUpdateRequest,
  documentTemplatesQueryKey,
  documentTemplatesQueryPath,
  type DocumentTemplateRow,
} from "./templates"

describe("document template scope", () => {
  it("sends active company scope to the server while preserving legacy and global query paths", () => {
    assert.equal(documentTemplatesQueryPath(), "/api/query/document-templates")
    assert.equal(documentTemplatesQueryPath({ identity: "alice", companyId: null }), "/api/query/document-templates")
    assert.equal(documentTemplatesQueryPath({ identity: "alice", companyId: 12n }), "/api/query/document-templates?companyId=12")
    assert.throws(() => documentTemplatesQueryPath({ identity: "alice" }), /no longer available/)
    assert.throws(() => documentTemplatesQueryPath({ identity: "unknown", companyId: 12 }), /no longer available/)
    assert.throws(() => documentTemplatesQueryPath({ identity: "unknown", companyId: null }), /no longer available/)
    assert.throws(() => documentTemplatesQueryPath({ identity: "alice", companyId: "12&organizationId=8" }), /no longer available/)
  })

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

  it("saves designer HTML and metadata together through the exposed typed update operation", () => {
    const params = { name: "Updated proposal", bodyHtml: "<h2>Proposal</h2><p>Updated</p>", metadata: '{"documentDesigner":{"schemaVersion":1},"retained":"yes"}', isActive: true }
    const request = documentTemplateUpdateRequest(7, { identity: "alice", companyId: 12n }, { templateId: "18", companyId: "12", params })
    assert.equal(request.urlPath, "/api/operations/erp.update_document_template")
    assert.equal(request.init.method, "POST")
    const command = JSON.parse(request.init.body as string)
    assert.equal(command.templateId, 18)
    assert.equal(command.companyId, 12)
    assert.equal("organizationId" in command, false)
    assert.equal("organization_id" in command, false)
    assert.deepEqual(command.params.name, { some: params.name })
    assert.deepEqual(command.params.body_html, { some: params.bodyHtml })
    assert.deepEqual(command.params.metadata, { some: params.metadata })
    assert.deepEqual(command.params.is_active, { some: true })
  })

  it("preserves explicit global scope and uses partial activation commands without replacing content", () => {
    for (const isActive of [false, true]) {
      const request = documentTemplateUpdateRequest(7, { identity: "alice", companyId: 12 }, { templateId: 18n, companyId: null, params: { isActive } })
      const command = JSON.parse(request.init.body as string)
      assert.equal(command.companyId, null)
      assert.deepEqual(command.params.is_active, { some: isActive })
      for (const key of ["name", "report_type", "body_html", "metadata", "header_html", "footer_html", "variable_bindings_json", "is_default"]) {
        assert.deepEqual(command.params[key], { none: [] }, `activation must preserve ${key}`)
      }
    }
    const global = documentTemplateUpdateRequest(7, { identity: "alice", companyId: null }, { templateId: 18, companyId: null, params: { isActive: false } })
    assert.equal(JSON.parse(global.init.body as string).companyId, null)
  })

  it("rejects missing or stale scopes before producing an update request", () => {
    const input = { templateId: 18, companyId: 12, params: { isActive: false } }
    for (const identity of [undefined, null, "", " ", "unknown", " unknown", "alice "]) {
      assert.throws(() => documentTemplateUpdateRequest(7, { identity, companyId: 12 }, input), /no longer available/)
    }
    for (const companyId of [undefined, 0, -1, "", "012", "12oops", "18446744073709551616"]) {
      assert.throws(() => documentTemplateUpdateRequest(7, { identity: "alice", companyId }, { ...input, companyId: null }), /no longer available/)
    }
    for (const organizationId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => documentTemplateUpdateRequest(organizationId, { identity: "alice", companyId: 12 }, input), /no longer available/)
    }
    assert.throws(() => documentTemplateUpdateRequest(7, { identity: "alice", companyId: 13 }, input), /no longer available/)
    assert.throws(() => documentTemplateUpdateRequest(7, { identity: "alice", companyId: null }, input), /no longer available/)
    assert.throws(() => {
      // @ts-expect-error A missing row company must not be treated as an organization default.
      documentTemplateUpdateRequest(7, { identity: "alice", companyId: 12 }, { templateId: 18, params: {} })
    }, /no longer available/)
  })

  it("rejects invalid identifiers and never rounds large template or company IDs", () => {
    const scope = { identity: "alice", companyId: 12 }
    for (const templateId of [0, -1, 1.5, "", "018", "18oops", "18446744073709551616", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => documentTemplateUpdateRequest(7, scope, { templateId, companyId: 12, params: {} }), /no longer available/)
    }
    for (const companyId of [0, -1, 1.5, "", "012", "12oops", "18446744073709551616", Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => documentTemplateUpdateRequest(7, scope, { templateId: 18, companyId, params: {} }), /no longer available/)
    }
    assert.throws(() => documentTemplateUpdateRequest(7, scope, { templateId: "9007199254740992", companyId: 12, params: {} }), /MAX_SAFE_INTEGER/)
    assert.throws(() => documentTemplateUpdateRequest(7, { identity: "alice", companyId: "9007199254740992" }, { templateId: 18, companyId: "9007199254740992", params: {} }), /MAX_SAFE_INTEGER/)
  })
})
