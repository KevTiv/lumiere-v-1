import { assertCsvSafeForAi, parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import type { ImportAnalyzeResponse, ImportPreviewError, ImportPreviewResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"

// Bounded reference import. Parent links require the normal reference review.
const REQUIRED = ["name", "usage", "active", "is_scrap"]
const COLUMNS = new Set([...REQUIRED, "complete_name", "barcode", "metadata", "_source_file", "_source_row", "_source_sha256", "_review_item_id", "_review_revision", "_review_reason"])

export function previewPreparedLocations(csv: string) {
  const { headers, rows } = parseCsvText(csv)
  if (!rows.length) throw new Error("The location file has no data rows.")
  if (new Set(headers).size !== headers.length || headers.some(header => !COLUMNS.has(header))) throw new Error("Use unique, exact location CSV headers. Unknown or duplicate headers cannot be imported.")
  const missing = REQUIRED.filter(header => !headers.includes(header))
  if (missing.length) throw new Error(`Required location columns are missing: ${missing.join(", ")}`)
  const safety = { findings: [] as ImportPreviewResponse["safety"]["findings"], blocked_cell_count: 0, is_safe_for_ai: true }
  for (let start = 0; start < rows.length; start += 50) {
    safety.findings.push(...assertCsvSafeForAi(headers, rows.slice(start, start + 50)).findings)
  }
  const validation_errors: ImportPreviewError[] = []
  const values = rows.map((row, row_index) => {
    const value = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
    const error = (field: string, message: string) => validation_errors.push({ row_index, field, message, severity: "error" })
    if (row.length !== headers.length) error("row", "The number of values must equal the number of headers.")
    for (const field of REQUIRED) if (!value[field]?.trim()) error(field, "Enter an explicit value or save this row for review.")
    if (!["internal", "customer", "supplier", "transit"].includes(value.usage)) error("usage", "Choose internal, customer, supplier or transit.")
    for (const field of ["active", "is_scrap"]) if (!["true", "false"].includes(value[field])) error(field, "Use true or false explicitly.")
    if (value.metadata) {
      try {
        const metadata: unknown = JSON.parse(value.metadata)
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) error("metadata", "Use a JSON object for source metadata.")
      } catch { error("metadata", "Use a JSON object for source metadata.") }
    }
    return value
  })
  const mapping = Object.fromEntries(headers.map(header => [header, header]))
  const analysis: ImportAnalyzeResponse = { target_entity: "stock_location", mappings: headers.map(header => ({ source_column: header, target_field: header, confidence: 1, required: REQUIRED.includes(header) })), unmapped_source_columns: [], unmapped_target_fields: [], metadata_suggestions: [], structure: { column_count: headers.length, sample_row_count: rows.length, duplicate_headers: [], empty_columns: [], delimiter_hint: "," }, safety, warnings: [] }
  const preview: ImportPreviewResponse = { target_entity: "stock_location", rows: values, validation_errors, safety, warnings: [] }
  return { mapping, analysis, preview }
}
