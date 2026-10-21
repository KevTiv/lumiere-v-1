import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { checkInvoiceProfileSubmission, fetchInvoiceProfileRows, saveInvoiceProfileVersion, type InvoiceProfileSubmission } from "./invoice-personalization"
import { documentTemplateCreateRequest } from "./templates"

const input = { organizationId: 1, companyId: "2", expectedVersionId: null, values: { terms: "Payment in 30 days" } }
const data = (rows: unknown[]) => Response.json({ data: rows })
const row = (submission: InvoiceProfileSubmission, id = "10") => ({ id, organizationId: "1", companyId: submission.companyId, name: submission.name, model: "account_move", reportType: "lumiere-invoice-profile-v1", isDefault: true, isActive: true, metadata: JSON.stringify({ invoiceProfile: { schemaVersion: 1, values: submission.values } }) })

describe("invoice profile persistence/readback", () => {
  it("preserves the legacy template serializer and null organization scope through the canonical builder", () => {
    const request = documentTemplateCreateRequest({ name: "Ordinary template", model: "sale_order", reportType: "pdf", bodyHtml: "<p>Existing template</p>", isDefault: false, isActive: true })
    const body = JSON.parse(request.init.body as string)
    assert.equal(body.companyId, null)
    assert.equal(body.params.report_type, "pdf")
    assert.deepEqual(body.params.metadata, { none: [] })
    assert.equal(body.params.body_html, "<p>Existing template</p>")
  })
  it("sends an explicitly scoped append and only confirms exact canonical readback", async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const submission = { ...input, name: "Invoice profile test" }
    const fetcher = async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return init ? Response.json({ ok: true }) : data(calls.length === 1 ? [] : [row(submission)])
    }
    const result = await saveInvoiceProfileVersion(input, fetcher, () => submission.name)
    assert.equal(result.status, "saved")
    if (result.status === "saved") assert.equal(result.version.id, "10")
    assert.equal(calls.length, 3)
    const body = JSON.parse(calls[1]!.init!.body as string)
    assert.equal(body.companyId, "2")
    assert.equal(body.params.report_type, "lumiere-invoice-profile-v1")
    assert.equal(body.params.body_html, "<p>Invoice personalization profile</p>")
    assert.equal(body.params.is_default, true)
    assert.equal(body.params.is_active, true)
    assert.deepEqual(body.params.header_html, { none: [] })
    assert.deepEqual(body.params.footer_html, { none: [] })
    assert.deepEqual(body.params.variable_bindings_json, { none: [] })
    assert.deepEqual(body.params.metadata, { some: JSON.stringify({ invoiceProfile: { schemaVersion: 1, values: input.values } }) })
    for (const camelKey of ["reportType", "bodyHtml", "isDefault", "isActive", "headerHtml", "footerHtml", "variableBindingsJson"]) assert.equal(camelKey in body.params, false)
  })
  it("uses explicit null scope to publish an organization default", async () => {
    const submission = { ...input, companyId: null, name: "Organization version" }
    let posted: Record<string, unknown> | undefined
    let reads = 0
    const result = await saveInvoiceProfileVersion(submission, async (_path, init) => {
      if (init) { posted = JSON.parse(init.body as string); return Response.json({ ok: true }) }
      return data(++reads === 1 ? [] : [row(submission)])
    }, () => submission.name)
    assert.equal(result.status, "saved")
    assert.equal(posted?.companyId, null)
  })
  it("does not dispatch if the current version changed or the read failed", async () => {
    let posts = 0
    const existing = { ...input, name: "Concurrent profile" }
    await assert.rejects(() => saveInvoiceProfileVersion(input, async (_path, init) => { if (init) posts++; return data([row(existing)]) }), /changed while you were editing/)
    await assert.rejects(() => saveInvoiceProfileVersion(input, async (_path, init) => { if (init) posts++; return new Response("", { status: 403 }) }), /403/)
    assert.equal(posts, 0)
  })
  it("does not claim saved when accepted dispatch has no matching readback", async () => {
    const result = await saveInvoiceProfileVersion(input, async (_path, init) => init ? Response.json({ ok: true }) : data([]), () => "Missing canonical")
    assert.equal(result.status, "unconfirmed")
  })
  it("rechecks active scope after async preflight and never dispatches a stale publication", async () => {
    let posts = 0
    await assert.rejects(() => saveInvoiceProfileVersion(input, async (_path, init) => { if (init) posts++; return data([]) }, undefined, () => false), /No profile version was sent/)
    assert.equal(posts, 0)
  })
  it("retains the exact uncertain submission and reconciles it without another dispatch", async () => {
    let posts = 0
    const result = await saveInvoiceProfileVersion(input, async (_path, init) => {
      if (init) { posts++; throw new Error("Response lost") }
      return data([])
    }, () => "Uncertain version")
    assert.equal(result.status, "unconfirmed")
    const confirmed = await checkInvoiceProfileSubmission(result.submission, async (_path, init) => {
      if (init) posts++
      return data([row(result.submission)])
    })
    assert.equal(confirmed.status, "saved")
    assert.equal(confirmed.submission, result.submission)
    assert.equal(posts, 1)
  })
  it("distinguishes exact persistence from a later concurrent profile becoming current", async () => {
    const submission = { ...input, name: "Saved version" }
    const result = await checkInvoiceProfileSubmission(submission, async () => data([row(submission, "10"), row({ ...submission, name: "Newer concurrent", values: { terms: "Concurrent" } }, "11")]))
    assert.equal(result.status, "saved")
    if (result.status === "saved") assert.equal(result.isCurrent, false)
  })
  it("fails closed on malformed source rows and invalid field values", async () => {
    await assert.rejects(() => fetchInvoiceProfileRows(async () => Response.json({ unexpected: [] })), /malformed/)
    let calls = 0
    await assert.rejects(() => saveInvoiceProfileVersion({ ...input, values: { terms: "x".repeat(8001) } }, async () => { calls++; return data([]) }), /8000/)
    assert.equal(calls, 0)
  })
})
