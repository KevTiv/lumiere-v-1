import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { generateQuotationDocument, isQuotationDownloadUrl, previewQuotationDocument } from "./quotations"

const input = { organizationId: 7, companyId: "2", orderId: "9007199254740993", templateId: "31" }
const revision = "a".repeat(64)
const checksum = "b".repeat(64)
const preview = { html: "<p>Customer &amp; quotation</p>", revision, templateId: input.templateId, templateName: "Quotation", orderId: input.orderId, reference: "Q-001" }
const output = { documentId: "9007199254740994", downloadUrl: `/api/documents/blobs/object/7/generated/${"c".repeat(32)}?sha256=${checksum}`, fileName: "quotation-9007199254740993-aaaaaaaaaaaa.pdf", checksum, revision }

describe("quotation document preview and immutable export", () => {
  it("keeps large record IDs exact and requests the current company and saved template", async () => {
    const controller = new AbortController()
    const result = await previewQuotationDocument(input, controller.signal, async (path, init) => {
      assert.equal(path, `/api/documents/quotations/${input.orderId}/preview`)
      assert.equal(init?.method, "POST")
      assert.deepEqual(JSON.parse(init!.body as string), { companyId: "2", templateId: "31" })
      assert.equal(init?.signal, controller.signal)
      return Response.json(preview)
    })
    assert.deepEqual(result, preview)
  })

  it("rejects malformed IDs before making any request", async () => {
    let calls = 0
    const fetcher = async () => { calls++; return Response.json(preview) }
    for (const orderId of ["0", "01", "-1", "1e3", "18446744073709551616", "../2"]) {
      await assert.rejects(() => previewQuotationDocument({ ...input, orderId }, undefined, fetcher), /no longer available/)
    }
    await assert.rejects(() => previewQuotationDocument({ ...input, organizationId: NaN }, undefined, fetcher))
    assert.equal(calls, 0)
  })

  it("rejects a preview for another record, another template or without a source revision", async () => {
    for (const changed of [{ orderId: "8" }, { templateId: "40" }, { revision: "" }, { html: null }]) {
      await assert.rejects(() => previewQuotationDocument(input, undefined, async () => Response.json({ ...preview, ...changed })), /invalid quotation preview/)
    }
  })

  it("requires the reviewed revision and sends no HTML or client-side record values when saving", async () => {
    let calls = 0
    const fetcher = async (path: string, init?: RequestInit) => {
      calls++
      assert.equal(path, `/api/documents/quotations/${input.orderId}/generate`)
      assert.deepEqual(JSON.parse(init!.body as string), { companyId: "2", templateId: "31", expectedRevision: revision })
      return Response.json(output)
    }
    await assert.rejects(() => generateQuotationDocument(input, "", fetcher), /Preview/)
    assert.equal(calls, 0)
    assert.deepEqual(await generateQuotationDocument(input, revision, fetcher), output)
    assert.equal(calls, 1)
  })

  it("surfaces a changed-source response and does not retry a generation", async () => {
    let calls = 0
    await assert.rejects(() => generateQuotationDocument(input, revision, async () => {
      calls++
      return Response.json({ error: "Quotation changed. Preview again." }, { status: 409 })
    }), /Quotation changed/)
    assert.equal(calls, 1)
  })

  it("only accepts a pinned object from this organization and the reviewed revision", async () => {
    for (const changed of [
      { downloadUrl: "https://example.com/quotation.pdf" },
      { downloadUrl: output.downloadUrl.replace("/object/7/", "/object/8/") },
      { checksum: "d".repeat(64) }, { revision: "d".repeat(64) },
      { documentId: "0" }, { fileName: "../../quotation.pdf" },
    ]) {
      await assert.rejects(() => generateQuotationDocument(input, revision, async () => Response.json({ ...output, ...changed })), /could not be confirmed/)
    }
    assert.equal(isQuotationDownloadUrl(output.downloadUrl, 7, checksum), true)
    assert.equal(isQuotationDownloadUrl(output.downloadUrl + "&redirect=https://example.com", 7, checksum), false)
  })
})
