import { assertCsvSafeForAi, parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import { escapeCsvField } from "@lumiere/erp-shared/csv-import-transform"
import type { ImportAnalyzeResponse, ImportPreviewError, ImportPreviewResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"

const ROLE_FIELDS = ["is_customer", "is_vendor", "is_employee", "is_prospect", "is_partner"]
const REQUIRED = ["name", "type_", ...ROLE_FIELDS]
// Exact native contact importer columns. Parent relationships need reference review.
const COLUMNS = new Set([...REQUIRED, "company_id", "first_name", "last_name", "title", "email", "email_secondary", "phone", "mobile", "fax", "website", "street", "street2", "city", "state_code", "zip", "country_code", "tax_id", "company_registry", "industry", "employees_count", "annual_revenue", "notes", "color", "metadata", "_source_file", "_source_row", "_source_sha256", "_review_item_id", "_review_revision", "_review_reason"])

export function previewPreparedContacts(args: { csv: string; companyId: number }) {
  if (!Number.isSafeInteger(args.companyId) || args.companyId <= 0) throw new Error("Select an operating company before preparing contacts.")
  const parsed = parseCsvText(args.csv)
  if (!parsed.rows.length) throw new Error("The contact file has no data rows.")
  if (new Set(parsed.headers).size !== parsed.headers.length || parsed.headers.some(header => !COLUMNS.has(header))) throw new Error("Use unique, exact contact CSV headers. Unknown headers and parent links require source review.")
  const missing = REQUIRED.filter(header => !parsed.headers.includes(header))
  if (missing.length) throw new Error(`Required contact columns are missing: ${missing.join(", ")}`)

  // The native contact reducer otherwise falls back to the organization's default
  // company. Bind the chosen destination in the actual CSV, not only its receipt.
  const needsCompany = !parsed.headers.includes("company_id")
  const headers = needsCompany ? [...parsed.headers, "company_id"] : parsed.headers
  const rows = parsed.rows.map(row => needsCompany ? [...row, String(args.companyId)] : row)
  const safety = { findings: [] as ImportPreviewResponse["safety"]["findings"], blocked_cell_count: 0, is_safe_for_ai: true }
  for (let start = 0; start < parsed.rows.length; start += 50) {
    safety.findings.push(...assertCsvSafeForAi(parsed.headers, parsed.rows.slice(start, start + 50)).findings)
  }
  const validation_errors: ImportPreviewError[] = []
  const values = rows.map((row, row_index) => {
    const value = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
    const error = (field: string, message: string) => validation_errors.push({ row_index, field, message, severity: "error" })
    if (parsed.rows[row_index].length !== parsed.headers.length) error("row", "The number of values must equal the number of headers.")
    for (const field of REQUIRED) if (!value[field]?.trim()) error(field, "Enter an explicit value or save this row for review.")
    if (!["contact", "company"].includes(value.type_)) error("type_", "Choose contact or company explicitly.")
    for (const field of ROLE_FIELDS) if (!["true", "false"].includes(value[field])) error(field, "Use true or false explicitly. Unknown roles remain in review.")
    if (value.company_id !== String(args.companyId)) error("company_id", "Choose the selected operating company. Another company cannot be imported through this preview.")
    if (value.employees_count && (!/^\d+$/.test(value.employees_count) || Number(value.employees_count) > 2_147_483_647)) error("employees_count", "Use an explicit nonnegative whole number within the supported range, or leave it unknown.")
    if (value.annual_revenue && !/^\d{1,12}(?:\.\d{1,6})?$/.test(value.annual_revenue)) error("annual_revenue", "Use an explicit nonnegative amount, or leave it unknown.")
    if (value.metadata) {
      try {
        const metadata: unknown = JSON.parse(value.metadata)
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) error("metadata", "Use a JSON object for source metadata.")
      } catch { error("metadata", "Use a JSON object for source metadata.") }
    }
    return value
  })
  const mapping = Object.fromEntries(headers.map(header => [header, header]))
  const analysis: ImportAnalyzeResponse = { target_entity: "contact", mappings: headers.map(header => ({ source_column: header, target_field: header, confidence: 1, required: REQUIRED.includes(header) || header === "company_id" })), unmapped_source_columns: [], unmapped_target_fields: [], metadata_suggestions: [], structure: { column_count: headers.length, sample_row_count: rows.length, duplicate_headers: [], empty_columns: [], delimiter_hint: "," }, safety, warnings: [] }
  const preview: ImportPreviewResponse = { target_entity: "contact", rows: values, validation_errors, safety, warnings: [] }
  const csv = [headers, ...rows].map(row => row.map(escapeCsvField).join(",")).join("\n")
  return { csv, mapping, analysis, preview }
}
