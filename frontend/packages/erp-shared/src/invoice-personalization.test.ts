import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decodeCompaniesQueryResponse } from "@lumiere/stdb/resource-reads"
import {
  INVOICE_PROFILE_REPORT_TYPE, INVOICE_LOGO_MAX_BYTES, inspectInvoiceLogo, isManagedInvoiceLogoUrl, invoiceSellerFromCompany, invoiceSellerCompanyFromQueryRow, isInvoiceSellerIdentityReady,
  parseInvoiceContent, parseInvoiceDocumentSnapshot, parseInvoiceNotes, parseInvoiceProfileMetadata,
  resolveInvoiceContent, resolveInvoiceProfile, selectInvoiceProfileVersions, validateInvoiceProfileValues,
  invoiceBuyerFromContact, invoiceBuyerSnapshot,
  type InvoiceDocumentSnapshot, type InvoiceProfileRow,
} from "./invoice-personalization"

const metadata = (values: unknown) => JSON.stringify({ invoiceProfile: { schemaVersion: 1, values } })
const row = (id: string, companyId: string | null, values: unknown = {}): InvoiceProfileRow => ({
  id, organizationId: "1", companyId, name: `Version ${id}`, model: "account_move", reportType: INVOICE_PROFILE_REPORT_TYPE, isActive: true, isDefault: true, metadata: metadata(values),
})
const snapshot = (): InvoiceDocumentSnapshot => ({
  schemaVersion: 1, profileVersionIds: { organization: "1", company: "9" },
  seller: { name: "Alpha Ltd", address: ["Main Street", "1000 Kigali", "RW"], taxId: "TIN-1", registrationNumber: "REG-1", email: "", phone: "", website: "www.example.com" },
  profile: resolveInvoiceProfile({ terms: "Organization terms" }, { accent: "", footer: "Company footer" }), notes: "Top-level notes",
})

describe("invoice personalization contracts", () => {
  const buyerContact = () => ({ id: "4", organizationId: "1", companyId: "2", name: "Buyer Legal Ltd", street: "Billing street", street2: null, city: "Kigali", stateCode: null, zip: "1000", countryCode: "RW", taxId: "BUYER-TIN", companyRegistry: "BUYER-REG", email: "billing@example.test", phone: null, deletedAt: null, mergeTargetId: null })
  it("captures exact scoped draft buyer legal fields while preserving V1 unavailability", () => {
    const read = invoiceBuyerFromContact(buyerContact(), 1, 2, 4)
    assert.equal(read.status, "valid")
    if (read.status !== "valid") return
    assert.deepEqual(read.value, { partnerId: "4", name: "Buyer Legal Ltd", address: ["Billing street", "Kigali", "1000", "RW"], taxId: "BUYER-TIN", registrationNumber: "BUYER-REG", email: "billing@example.test", phone: "" })
    const issued: InvoiceDocumentSnapshot = { ...snapshot(), schemaVersion: 2, buyer: read.value }
    assert.deepEqual(parseInvoiceDocumentSnapshot({ invoiceDocument: issued }), { status: "valid", value: issued })
    assert.deepEqual(invoiceBuyerSnapshot(snapshot()), { status: "missing" })
    assert.deepEqual(invoiceBuyerSnapshot(issued), read)
    const changed = { ...buyerContact(), name: "New buyer name", taxId: "New tax" }
    assert.equal(invoiceBuyerFromContact(changed, 1, 2, 4).status, "valid")
    assert.equal(issued.buyer.name, "Buyer Legal Ltd")
    assert.equal(issued.buyer.taxId, "BUYER-TIN")
    assert.equal(invoiceBuyerFromContact({ ...buyerContact(), companyId: null }, 1, 2, 4).status, "valid")
  })
  it("rejects foreign, inactive, redacted and malformed buyer identity without partial fallback", () => {
    for (const change of [{ organizationId: "9" }, { companyId: "3" }, { id: "5" }, { deletedAt: "now" }, { mergeTargetId: "9" }, { companyId: undefined }, { name: " " }, { taxId: undefined }, { deletedAt: undefined }, { street: 42 }]) assert.equal(invoiceBuyerFromContact({ ...buyerContact(), ...change }, 1, 2, 4).status, "invalid")
    const read = invoiceBuyerFromContact(buyerContact(), 1, 2, 4)
    if (read.status !== "valid") throw Error("fixture")
    const v2 = { ...snapshot(), schemaVersion: 2, buyer: read.value }
    for (const changed of [{ ...v2, buyer: undefined }, { ...v2, buyer: null }, { ...v2, schemaVersion: 3 }, { ...v2, schemaVersion: 1 }, { ...v2, buyer: { ...read.value, partnerId: "0" } }, { ...v2, buyer: { ...read.value, taxId: "x".repeat(257) } }, { ...v2, buyer: { ...read.value, address: Array(13).fill("line") } }, { ...v2, buyer: { ...read.value, extra: true } }]) assert.equal(parseInvoiceDocumentSnapshot({ invoiceDocument: changed }).status, "invalid")
  })
  it("selects numeric latest versions only in the exact organization/company scope", () => {
    const read = selectInvoiceProfileVersions([
      row("9", null, { terms: "Old" }), row("10", null, { terms: "Latest" }), row("12", "2", { footer: "Company 2" }),
      row("100", "3", { footer: "Other company" }), { ...row("101", null), organizationId: "4" },
      { ...row("102", null), isActive: false }, { ...row("103", null), reportType: "invoice" },
    ], 1, 2)
    assert.equal(read.status, "valid")
    if (read.status !== "valid") return
    assert.equal(read.value.organization?.id, "10")
    assert.equal(read.value.company?.id, "12")
  })
  it("treats omitted values as inherited and empty strings as explicit clears", () => {
    const profile = resolveInvoiceProfile({ notice: "Org notice", terms: "Org terms", accent: "violet" }, { notice: "", footer: "Footer" })
    assert.equal(profile.notice, "")
    assert.equal(profile.terms, "Org terms")
    assert.equal(profile.accent, "violet")
    assert.equal(resolveInvoiceProfile({ accent: "violet" }, {}).accent, "violet")
    assert.equal(resolveInvoiceProfile({}, {}).accent, "teal")
    assert.equal(resolveInvoiceProfile({ accent: "violet" }, { accent: "" }).accent, "")
    assert.equal(resolveInvoiceContent(profile, { schemaVersion: 1, footer: "" }).footer, "")
    assert.equal(resolveInvoiceContent(profile, { schemaVersion: 1 }).terms, "Org terms")
  })
  it("fails closed for a malformed latest version rather than falling back", () => {
    assert.equal(selectInvoiceProfileVersions([row("1", null, { terms: "Valid old" }), row("2", null, { rawHtml: "ignored?" })], 1, 2).status, "invalid")
    assert.equal(selectInvoiceProfileVersions([row("2", "3", { rawHtml: "Other company" }), row("1", null)], 1, 2).status, "valid")
    assert.equal(selectInvoiceProfileVersions([{ ...row("2", null), isDefault: undefined }], 1, 2).status, "invalid")
    const redacted = row("3", "9", { terms: "Foreign company must never become organization defaults" })
    delete redacted.companyId
    assert.equal(selectInvoiceProfileVersions([redacted], 1, 2).status, "invalid")
    for (const field of ["model", "reportType", "organizationId"] as const) {
      const incomplete = row("3", null)
      delete incomplete[field]
      assert.equal(selectInvoiceProfileVersions([incomplete], 1, 2).status, "invalid")
    }
  })
  it("distinguishes missing, malformed and unsupported metadata", () => {
    assert.deepEqual(parseInvoiceProfileMetadata(undefined), { status: "missing" })
    assert.deepEqual(parseInvoiceProfileMetadata('{"custom:value":"retained"}'), { status: "missing" })
    for (const value of ["{", "[]", '{"invoiceProfile":null}', '{"invoiceProfile":{"schemaVersion":2,"values":{}}}', '{"invoiceProfile":{"schemaVersion":1,"values":{},"css":"red"}}']) assert.equal(parseInvoiceProfileMetadata(value).status, "invalid")
    assert.equal(parseInvoiceProfileMetadata(metadata({ accent: "custom" })).status, "invalid")
    assert.equal(parseInvoiceProfileMetadata(metadata({ terms: null })).status, "invalid")
  })
  it("enforces UTF-8 bounds without mistaking escaped plain text for executable HTML", () => {
    assert.equal(validateInvoiceProfileValues({ notice: "é".repeat(1000) }).status, "valid")
    assert.equal(validateInvoiceProfileValues({ notice: "é".repeat(1001) }).status, "invalid")
    assert.equal(validateInvoiceProfileValues({ notice: "Literal <text> & lines\nremain plain text", website: "www.example.com" }).status, "valid")
    assert.equal(validateInvoiceProfileValues({ terms: "Bad\u0000text" }).status, "invalid")
    assert.equal(validateInvoiceProfileValues({ terms: "Bad\u0085text" }).status, "invalid")
    assert.equal(validateInvoiceProfileValues({ terms: "Bad\uD800text" }).status, "invalid")
    assert.equal(validateInvoiceProfileValues({ terms: "Unicode emoji 😀" }).status, "valid")
  })
  it("accepts only same-organization managed logo object paths", () => {
    const path = `/api/documents/blobs/object/1/eu/0123456789abcdef0123456789abcdef?sha256=${"a".repeat(64)}`
    assert.equal(isManagedInvoiceLogoUrl(path, 1), true)
    assert.equal(isManagedInvoiceLogoUrl(path, 2), false)
    for (const value of ["https://example.com/logo.png", "data:image/png;base64,xx", `${path}?x=1`, `${path}/extra`, "/api/documents/blobs/object/1/eu/..", "/api/documents/blobs/object/01/eu/0123456789abcdef0123456789abcdef"]) assert.equal(isManagedInvoiceLogoUrl(value, 1), false)
    assert.equal(validateInvoiceProfileValues({ logoUrl: path }, 2).status, "invalid")
    assert.equal(isManagedInvoiceLogoUrl(path.split("?")[0]!, 1), false)
  })
  it("reads a frozen complete snapshot, rejecting unsupported or incomplete snapshots", () => {
    const document = snapshot()
    assert.deepEqual(parseInvoiceDocumentSnapshot({ invoiceDocument: document }, 1), { status: "valid", value: document })
    for (const partial of [{ ...document, schemaVersion: 2 }, { ...document, profile: { terms: "Partial" } }, { ...document, profileVersionIds: { company: "9" } }, { ...document, notes: null }, { ...document, seller: { ...document.seller, address: Array(13).fill("line") } }]) assert.equal(parseInvoiceDocumentSnapshot({ invoiceDocument: partial }).status, "invalid")
    assert.equal(parseInvoiceDocumentSnapshot({ unrelated: true }).status, "missing")
  })
  it("takes seller legal identity only from the company and contact content only from published profiles", () => {
    const seller = invoiceSellerFromCompany({ name: "Alpha <Ltd>", addressStreet: " Main street ", addressCity: "Kigali", addressZip: "1000", addressCountryCode: "RW", taxId: "TIN-1", companyRegistry: "REG-1" }, resolveInvoiceProfile({ email: "billing@example.com", website: "www.example.com" }, { email: "" }))
    assert.deepEqual(seller, { name: "Alpha <Ltd>", address: [" Main street ", "Kigali", "1000", "RW"], taxId: "TIN-1", registrationNumber: "REG-1", email: "", phone: "", website: "www.example.com" })
    assert.deepEqual(invoiceSellerFromCompany({ name: "Minimal", addressStreet: "  " }, resolveInvoiceProfile()).address, [])
  })

  it("requires exact scoped seller identity and distinguishes known-empty fields from redaction", () => {
    const company = { id: 2n, organizationId: 1n, name: "Alpha Ltd", addressStreet: null, addressCity: "", addressZip: null, addressCountryCode: "FR", taxId: null, companyRegistry: null }
    assert.equal(isInvoiceSellerIdentityReady(company, 2n, 1), true)
    assert.equal(isInvoiceSellerIdentityReady(undefined, 2n, 1), false)
    assert.equal(isInvoiceSellerIdentityReady(company, 3n, 1), false)
    assert.equal(isInvoiceSellerIdentityReady(company, 2n, 3), false)
    assert.equal(isInvoiceSellerIdentityReady({ ...company, organizationId: undefined }, 2n, 1), false)
    assert.equal(isInvoiceSellerIdentityReady({ ...company, name: "  " }, 2n, 1), false)
    for (const key of ["addressStreet", "addressCity", "addressZip", "addressCountryCode", "taxId", "companyRegistry"] as const) {
      const missing: Partial<typeof company> = { ...company }
      delete missing[key]
      assert.equal(isInvoiceSellerIdentityReady(missing, 2n, 1), false, `missing ${key}`)
      assert.equal(isInvoiceSellerIdentityReady({ ...company, [key]: undefined }, 2n, 1), false, `redacted ${key}`)
      assert.equal(isInvoiceSellerIdentityReady({ ...company, [key]: 42 }, 2n, 1), false, `invalid ${key}`)
    }
    const wireCompany = { id: "2", organization_id: "1", name: "Alpha Ltd", address_street: "Street", address_city: "City", address_zip: null, address_country_code: "FR", tax_id: null, company_registry: "REG" }
    assert.equal(isInvoiceSellerIdentityReady(wireCompany, 2n, 1), true)
    assert.deepEqual(invoiceSellerFromCompany(wireCompany, resolveInvoiceProfile()).address, ["Street", "City", "FR"])
    assert.equal(invoiceSellerFromCompany(wireCompany, resolveInvoiceProfile()).registrationNumber, "REG")
  })

  it("preserves known-empty legal identity through the real typed company decoder", () => {
    const wire = { id: "2", organizationId: "1", name: "Alpha Ltd", addressStreet: "Street", addressCity: null, addressZip: null, addressCountryCode: "FR", taxId: null, companyRegistry: null }
    const decoded = decodeCompaniesQueryResponse({ data: [wire] })[0]!
    assert.equal(Object.hasOwn(decoded, "taxId"), true)
    assert.equal(decoded.taxId, undefined)
    const seller = invoiceSellerCompanyFromQueryRow(decoded)
    assert.equal(isInvoiceSellerIdentityReady(seller, 2n, 1), true)
    assert.equal(seller?.taxId, null)
    assert.equal(invoiceSellerCompanyFromQueryRow(undefined), undefined)
    for (const key of ["addressStreet", "addressCity", "addressZip", "addressCountryCode", "taxId", "companyRegistry"] as const) {
      const redacted: Partial<typeof wire> = { ...wire }
      delete redacted[key]
      const projected = decodeCompaniesQueryResponse({ data: [redacted] })[0]!
      assert.equal(isInvoiceSellerIdentityReady(invoiceSellerCompanyFromQueryRow(projected), 2n, 1), false, key)
    }
  })
  it("keeps invoice content and notes distinct with inheritance-aware overrides", () => {
    assert.deepEqual(parseInvoiceContent({ invoiceContent: { schemaVersion: 1, notice: "", terms: "Payment in 30 days" }, notes: "Internal narrative", "custom:field": "retained" }), { status: "valid", value: { schemaVersion: 1, notice: "", terms: "Payment in 30 days" } })
    assert.deepEqual(parseInvoiceNotes({ notes: "Internal narrative" }), { status: "valid", value: "Internal narrative" })
    assert.equal(parseInvoiceContent({ invoiceContent: { schemaVersion: 1, logoUrl: "" } }).status, "invalid")
    assert.equal(parseInvoiceNotes({ notes: "x".repeat(8001) }).status, "invalid")
    assert.deepEqual(parseInvoiceNotes("Historical <plain> invoice note"), { status: "valid", value: "Historical <plain> invoice note" })
    assert.equal(parseInvoiceDocumentSnapshot("Historical invoice note").status, "missing")
    assert.equal(parseInvoiceContent("Historical invoice note").status, "missing")
    assert.equal(parseInvoiceNotes('{"invoiceContent":').status, "invalid")
    assert.equal(parseInvoiceNotes('invoiceDocument: malformed').status, "invalid")
  })
  it("checks raster MIME signatures, bytes and dimensions before browser decoding/upload", () => {
    const png = new Uint8Array(33)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer)
    view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 100); view.setUint32(20, 100)
    assert.deepEqual(inspectInvoiceLogo(png, "image/png"), { width: 100, height: 100, mimeType: "image/png" })
    assert.throws(() => inspectInvoiceLogo(png, "image/jpeg"))
    assert.throws(() => inspectInvoiceLogo(new TextEncoder().encode("<svg />"), "image/svg+xml"))
    assert.throws(() => inspectInvoiceLogo(new Uint8Array(INVOICE_LOGO_MAX_BYTES + 1), "image/png"))
    view.setUint32(16, 3000); view.setUint32(20, 3000)
    assert.throws(() => inspectInvoiceLogo(png, "image/png"), /4 million/)
    view.setUint32(16, 4097); view.setUint32(20, 1)
    assert.throws(() => inspectInvoiceLogo(png, "image/png"), /4096/)
  })
})
