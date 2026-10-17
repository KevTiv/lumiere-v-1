import type { RowValueMap } from "./row-values"
import type { CompanyQueryRow } from "@lumiere/stdb/resource-reads"

/** Append-only document_template profiles; no renderer code or arbitrary styles are persisted. */
export const INVOICE_PROFILE_MODEL = "account_move"
export const INVOICE_PROFILE_REPORT_TYPE = "lumiere-invoice-profile-v1"
export const INVOICE_PROFILE_FIELDS = ["logoUrl", "accent", "email", "phone", "website", "notice", "terms", "paymentInstructions", "footer"] as const
export const INVOICE_CONTENT_FIELDS = ["notice", "terms", "paymentInstructions", "footer"] as const
export type InvoiceProfileField = typeof INVOICE_PROFILE_FIELDS[number]
export type InvoiceAccent = "teal" | "blue" | "slate" | "violet"
export type InvoiceProfileValues = Partial<Record<Exclude<InvoiceProfileField, "accent">, string>> & { accent?: InvoiceAccent | "" }
export type InvoicePersonalizationProfile = Record<Exclude<InvoiceProfileField, "accent">, string> & { accent: InvoiceAccent | "" }
export interface InvoiceContentOverrides { schemaVersion: 1; notice?: string; terms?: string; paymentInstructions?: string; footer?: string }
export interface InvoiceProfileVersionIds { organization: string | null; company: string | null }
export interface InvoiceDocumentSnapshot {
  schemaVersion: 1
  profileVersionIds: InvoiceProfileVersionIds
  seller: { name: string; address: string[]; taxId: string; registrationNumber: string; email: string; phone: string; website: string }
  profile: InvoicePersonalizationProfile
  notes: string
}
export type InvoicePersonalizationRead<T> = { status: "missing" } | { status: "valid"; value: T } | { status: "invalid"; error: string }
export interface InvoiceProfileVersion { id: string; organizationId: string; companyId: string | null; name: string; values: InvoiceProfileValues }
export interface InvoiceProfileRow {
  id: unknown; organizationId?: unknown; organization_id?: unknown; companyId?: unknown; company_id?: unknown
  name?: unknown; model?: unknown; reportType?: unknown; report_type?: unknown
  isDefault?: unknown; is_default?: unknown; isActive?: unknown; is_active?: unknown; metadata?: unknown
}
export interface InvoiceProfileSelection { organization: InvoiceProfileVersion | null; company: InvoiceProfileVersion | null }
export const INVOICE_PROFILE_LIMITS: Record<InvoiceProfileField, number> = {
  logoUrl: 1024, accent: 16, email: 254, phone: 64, website: 512,
  notice: 2000, terms: 8000, paymentInstructions: 4000, footer: 2000,
}
export const INVOICE_NOTES_LIMIT = 8000
export const INVOICE_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const INVOICE_LOGO_MAX_DIMENSION = 4096
export const INVOICE_LOGO_MAX_PIXELS = 4_000_000

const DEFAULT_PROFILE: InvoicePersonalizationProfile = { logoUrl: "", accent: "teal", email: "", phone: "", website: "", notice: "", terms: "", paymentInstructions: "", footer: "" }
const encoder = new TextEncoder()
const object = (value: unknown): value is RowValueMap => value !== null && typeof value === "object" && !Array.isArray(value)
const valid = <T>(value: T): InvoicePersonalizationRead<T> => ({ status: "valid", value })
const invalid = (error: string): { status: "invalid"; error: string } => ({ status: "invalid", error })
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function invoiceProfileId(value: unknown): string | null {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null
  if (!["string", "number", "bigint"].includes(typeof value)) return null
  const text = String(value)
  return /^[1-9]\d*$/.test(text) && BigInt(text) <= 18446744073709551615n ? text : null
}

function textError(value: unknown, field: string, limit: number, _multiline = true): string | null {
  if (typeof value !== "string") return `${field} must be plain text`
  if (encoder.encode(value).length > limit) return `${field} exceeds ${limit} UTF-8 bytes`
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) return `${field} contains an unsupported control character or invalid Unicode`
  return null
}

/** A managed blob belongs to one organization. URLs, data URLs and path traversal are never accepted. */
export function isManagedInvoiceLogoUrl(value: string, organizationId?: string | number | bigint): boolean {
  if (value === "") return true
  const match = /^\/api\/documents\/blobs\/object\/([1-9]\d*)\/([A-Za-z0-9_-]{1,32})\/([0-9A-Fa-f]{32})\?sha256=[0-9a-f]{64}$/.exec(value)
  return Boolean(match && invoiceProfileId(match[1]) && (organizationId === undefined || match[1] === String(organizationId)))
}

export function validateInvoiceProfileValues(value: unknown, organizationId?: string | number | bigint): InvoicePersonalizationRead<InvoiceProfileValues> {
  if (!object(value)) return invalid("Invoice profile values must be an object")
  if (Object.keys(value).some((key) => !(INVOICE_PROFILE_FIELDS as readonly string[]).includes(key))) return invalid("Invoice profile contains an unsupported field")
  const output: InvoiceProfileValues = {}
  for (const key of INVOICE_PROFILE_FIELDS) {
    if (!has(value, key)) continue
    const error = textError(value[key], key, INVOICE_PROFILE_LIMITS[key], INVOICE_CONTENT_FIELDS.includes(key as typeof INVOICE_CONTENT_FIELDS[number]))
    if (error) return invalid(error)
    const text = value[key] as string
    if (key === "accent" && !["", "teal", "blue", "slate", "violet"].includes(text)) return invalid("Invoice accent is unsupported")
    if (key === "logoUrl" && !isManagedInvoiceLogoUrl(text, organizationId)) return invalid("Invoice logo must be a managed image from this organization")
    Object.assign(output, { [key]: text })
  }
  return valid(output)
}

function metadataObject(metadata: unknown): InvoicePersonalizationRead<RowValueMap> {
  if (metadata === undefined || metadata === null) return { status: "missing" }
  let value = metadata
  if (typeof metadata === "string") {
    try { value = JSON.parse(metadata) } catch { return invalid("Invoice metadata is not valid JSON") }
  }
  return object(value) ? valid(value) : invalid("Invoice metadata must be an object")
}

function section(metadata: unknown, key: string): InvoicePersonalizationRead<RowValueMap> {
  if (key !== "invoiceProfile" && legacyInvoiceNotes(metadata) !== null) return { status: "missing" }
  const root = metadataObject(metadata)
  if (root.status !== "valid") return root
  if (!has(root.value, key)) return { status: "missing" }
  return object(root.value[key]) ? valid(root.value[key] as RowValueMap) : invalid(`${key} must be an object`)
}

export function parseInvoiceProfileMetadata(metadata: unknown, organizationId?: string | number | bigint): InvoicePersonalizationRead<InvoiceProfileValues> {
  const profile = section(metadata, "invoiceProfile")
  if (profile.status !== "valid") return profile
  if (profile.value.schemaVersion !== 1) return invalid("Invoice profile schema version is unsupported")
  if (Object.keys(profile.value).some((key) => !["schemaVersion", "values"].includes(key))) return invalid("Invoice profile contains an unsupported property")
  return validateInvoiceProfileValues(profile.value.values, organizationId)
}

export function parseInvoiceContent(metadata: unknown): InvoicePersonalizationRead<InvoiceContentOverrides> {
  const content = section(metadata, "invoiceContent")
  if (content.status !== "valid") return content
  if (content.value.schemaVersion !== 1) return invalid("Invoice content schema version is unsupported")
  if (Object.keys(content.value).some((key) => key !== "schemaVersion" && !(INVOICE_CONTENT_FIELDS as readonly string[]).includes(key))) return invalid("Invoice content contains an unsupported field")
  const output: InvoiceContentOverrides = { schemaVersion: 1 }
  for (const key of INVOICE_CONTENT_FIELDS) {
    if (!has(content.value, key)) continue
    const error = textError(content.value[key], key, INVOICE_PROFILE_LIMITS[key])
    if (error) return invalid(error)
    output[key] = content.value[key] as string
  }
  return valid(output)
}

export function parseInvoiceNotes(metadata: unknown): InvoicePersonalizationRead<string> {
  const legacy = legacyInvoiceNotes(metadata)
  if (legacy !== null) {
    const error = textError(legacy, "notes", INVOICE_NOTES_LIMIT)
    return error ? invalid(error) : valid(legacy)
  }
  const root = metadataObject(metadata)
  if (root.status !== "valid") return root
  if (!has(root.value, "notes")) return { status: "missing" }
  const error = textError(root.value.notes, "notes", INVOICE_NOTES_LIMIT)
  return error ? invalid(error) : valid(root.value.notes as string)
}

/** Historical sale-order invoices stored bounded plain notes directly as metadata. */
function legacyInvoiceNotes(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null
  const text = metadata.trim()
  if (/^[{[\"]/.test(text) || /invoice(?:Document|Content|Profile)/.test(text)) return null
  try { JSON.parse(metadata); return null } catch { return metadata }
}

export function resolveInvoiceProfile(organization: InvoiceProfileValues = {}, company: InvoiceProfileValues = {}): InvoicePersonalizationProfile {
  return { ...DEFAULT_PROFILE, ...organization, ...company }
}

export function resolveInvoiceContent(profile: InvoicePersonalizationProfile, content?: InvoiceContentOverrides): InvoicePersonalizationProfile {
  const resolved = { ...profile }
  for (const key of INVOICE_CONTENT_FIELDS) if (content && has(content, key)) resolved[key] = content[key]!
  return resolved
}

export interface InvoiceSellerCompany {
  id?: unknown; organizationId?: unknown; organization_id?: unknown; name?: unknown
  addressStreet?: unknown; address_street?: unknown; addressCity?: unknown; address_city?: unknown
  addressZip?: unknown; address_zip?: unknown; addressCountryCode?: unknown; address_country_code?: unknown
  taxId?: unknown; tax_id?: unknown; companyRegistry?: unknown; company_registry?: unknown
}
const sellerIdentityFields = [
  ["addressStreet", "address_street"], ["addressCity", "address_city"],
  ["addressZip", "address_zip"], ["addressCountryCode", "address_country_code"],
  ["taxId", "tax_id"], ["companyRegistry", "company_registry"],
] as const

/** Generated query codecs keep present Option::None fields as own undefined
 * properties; permission-redacted columns are omitted entirely. Preserve that
 * distinction at the typed boundary before reviewing seller identity. */
export function invoiceSellerCompanyFromQueryRow(company: CompanyQueryRow | undefined): InvoiceSellerCompany | undefined {
  if (!company) return undefined
  const seller: InvoiceSellerCompany = { ...company }
  for (const [key] of sellerIdentityFields) {
    if (Object.prototype.hasOwnProperty.call(company, key) && company[key] === undefined) {
      seller[key] = null
    }
  }
  return seller
}

function sellerIdentityField(company: InvoiceSellerCompany, keys: typeof sellerIdentityFields[number]): unknown {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(company, candidate))
  return key === undefined ? undefined : company[key]
}

/** Redacted/missing legal fields are not known-empty values and cannot be reviewed as blanks. */
export function isInvoiceSellerIdentityReady(company: InvoiceSellerCompany | null | undefined, companyId: string | number | bigint, organizationId: string | number | bigint): company is InvoiceSellerCompany {
  if (!company || !invoiceProfileId(companyId) || !invoiceProfileId(organizationId) || invoiceProfileId(company.id) !== invoiceProfileId(companyId) || invoiceProfileId(company.organizationId ?? company.organization_id) !== invoiceProfileId(organizationId)) return false
  if (typeof company.name !== "string" || company.name.trim() === "") return false
  return sellerIdentityFields.every((keys) => {
    const value = sellerIdentityField(company, keys)
    return value === null || typeof value === "string"
  })
}

/** Seller identity is canonical company data; contact/branding authority is the published profile. */
export function invoiceSellerFromCompany(company: InvoiceSellerCompany, profile: InvoicePersonalizationProfile): InvoiceDocumentSnapshot["seller"] {
  const text = (value: unknown) => typeof value === "string" ? value : ""
  return {
    name: text(company.name),
    address: sellerIdentityFields.slice(0, 4).map((keys) => sellerIdentityField(company, keys)).filter((value): value is string => typeof value === "string" && value.trim() !== ""),
    taxId: text(sellerIdentityField(company, sellerIdentityFields[4])), registrationNumber: text(sellerIdentityField(company, sellerIdentityFields[5])),
    email: profile.email, phone: profile.phone, website: profile.website,
  }
}

/** Only selected versions are parsed. A malformed latest version must not fall back to an older row. */
export function selectInvoiceProfileVersions(rows: readonly InvoiceProfileRow[], organizationId: string | number | bigint, companyId: string | number | bigint | null): InvoicePersonalizationRead<InvoiceProfileSelection> {
  const organization = invoiceProfileId(organizationId)
  const company = companyId === null ? null : invoiceProfileId(companyId)
  if (!organization || (companyId !== null && !company)) return invalid("Invoice profile scope is invalid")
  const selected: Record<"organization" | "company", InvoiceProfileRow | null> = { organization: null, company: null }
  for (const row of rows) {
    // Missing scope/classification can be field redaction, never organization inheritance.
    if (typeof row.model !== "string" || typeof (row.reportType ?? row.report_type) !== "string" || !invoiceProfileId(row.organizationId ?? row.organization_id) ||
      (!Object.prototype.hasOwnProperty.call(row, "companyId") && !Object.prototype.hasOwnProperty.call(row, "company_id"))) return invalid("Invoice profile scope or classification fields are unavailable")
    const rawCompany = Object.prototype.hasOwnProperty.call(row, "companyId") ? row.companyId : row.company_id
    if (rawCompany !== null && !invoiceProfileId(rawCompany)) return invalid("Invoice profile company scope is unavailable")
    if (row.model !== INVOICE_PROFILE_MODEL || (row.reportType ?? row.report_type) !== INVOICE_PROFILE_REPORT_TYPE) continue
    if (invoiceProfileId(row.organizationId ?? row.organization_id) !== organization) continue
    const scope = rawCompany === null ? "organization" : invoiceProfileId(rawCompany) === company && company !== null ? "company" : null
    if (!scope) continue
    const active = row.isActive ?? row.is_active
    const isDefault = row.isDefault ?? row.is_default
    if (active === false || isDefault === false) continue
    if (active !== true || isDefault !== true || !invoiceProfileId(row.id) || typeof row.name !== "string") return invalid("Invoice profile version is incomplete")
    if (!selected[scope] || BigInt(String(row.id)) > BigInt(String(selected[scope]!.id))) selected[scope] = row
  }
  const output: InvoiceProfileSelection = { organization: null, company: null }
  for (const scope of ["organization", "company"] as const) {
    const row = selected[scope]
    if (!row) continue
    const parsed = parseInvoiceProfileMetadata(row.metadata, organization)
    if (parsed.status !== "valid") return invalid(parsed.status === "invalid" ? parsed.error : "Invoice profile metadata is missing")
    output[scope] = { id: String(row.id), organizationId: organization, companyId: scope === "company" ? company : null, name: row.name as string, values: parsed.value }
  }
  return valid(output)
}

export function parseInvoiceDocumentSnapshot(metadata: unknown, organizationId?: string | number | bigint): InvoicePersonalizationRead<InvoiceDocumentSnapshot> {
  const parsed = section(metadata, "invoiceDocument")
  if (parsed.status !== "valid") return parsed
  const snapshot = parsed.value
  if (snapshot.schemaVersion !== 1) return invalid("Invoice document schema version is unsupported")
  if (Object.keys(snapshot).some((key) => !["schemaVersion", "profileVersionIds", "seller", "profile", "notes"].includes(key))) return invalid("Invoice document contains an unsupported field")
  if (!object(snapshot.profileVersionIds) || Object.keys(snapshot.profileVersionIds).length !== 2 || !has(snapshot.profileVersionIds, "organization") || !has(snapshot.profileVersionIds, "company")) return invalid("Invoice profile version references are malformed")
  for (const id of Object.values(snapshot.profileVersionIds)) if (id !== null && (typeof id !== "string" || !invoiceProfileId(id))) return invalid("Invoice profile version reference is invalid")
  const profile = validateInvoiceProfileValues(snapshot.profile, organizationId)
  if (profile.status !== "valid") return profile
  if (Object.keys(profile.value).length !== INVOICE_PROFILE_FIELDS.length) return invalid("Invoice document profile is incomplete")
  if (!object(snapshot.seller) || Object.keys(snapshot.seller).some((key) => !["name", "address", "taxId", "registrationNumber", "email", "phone", "website"].includes(key))) return invalid("Invoice seller is malformed")
  for (const key of ["name", "taxId", "registrationNumber", "email", "phone", "website"] as const) {
    const error = textError(snapshot.seller[key], `seller.${key}`, key === "name" ? 1024 : key === "taxId" || key === "registrationNumber" ? 256 : INVOICE_PROFILE_LIMITS[key], false)
    if (error) return invalid(error)
  }
  if (!Array.isArray(snapshot.seller.address) || snapshot.seller.address.length > 12 || snapshot.seller.address.some((line) => textError(line, "seller.address", 2048, false))) return invalid("Invoice seller address is malformed")
  const notesError = textError(snapshot.notes, "notes", INVOICE_NOTES_LIMIT)
  if (notesError) return invalid(notesError)
  return valid(snapshot as unknown as InvoiceDocumentSnapshot)
}

export const readInvoiceDocumentSnapshot = parseInvoiceDocumentSnapshot

/** Header inspection is followed by browser decoding before any upload. SVG is never supported. */
export function inspectInvoiceLogo(bytes: Uint8Array, mimeType: string): { width: number; height: number; mimeType: "image/png" | "image/jpeg" } {
  if (bytes.length === 0 || bytes.length > INVOICE_LOGO_MAX_BYTES) throw new Error("Logo must be a non-empty PNG or JPEG no larger than 2 MiB")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0; let height = 0
  if (mimeType === "image/png" && bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20)
  } else if (mimeType === "image/jpeg" && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]!
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break
      }
      offset += length
    }
  } else throw new Error("Logo bytes must match PNG or JPEG content")
  if (width <= 0 || height <= 0 || width > INVOICE_LOGO_MAX_DIMENSION || height > INVOICE_LOGO_MAX_DIMENSION || width * height > INVOICE_LOGO_MAX_PIXELS) throw new Error("Logo dimensions must be between 1 and 4096 pixels and at most 4 million pixels")
  return { width, height, mimeType: mimeType as "image/png" | "image/jpeg" }
}
