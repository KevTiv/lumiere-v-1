import { assertCsvSafeForAi, parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import type { ImportAnalyzeResponse, ImportPreviewError, ImportPreviewResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"
import { isExplicitProductPrice } from "./guided-import-request"

// Exact headers read by import_product_csv. Do not infer names, units or prices.
const REQUIRED = ["name", "category_id", "uom_id", "uom_po_id", "sale_price", "cost_price", "active"]
const COLUMNS = new Set([...REQUIRED, "internal_reference", "barcode", "type_field", "description", "volume", "weight", "can_be_sold", "can_be_purchased", "metadata", "_source_file", "_source_row", "_source_sha256", "_review_item_id", "_review_revision", "_review_reason"])
export type ProductImportReference = { id: unknown; organizationId?: unknown }

export function previewPreparedProducts(args: { csv: string; organizationId: number; categories: readonly ProductImportReference[]; uoms: readonly ProductImportReference[] }) {
  const { headers, rows } = parseCsvText(args.csv)
  if (!rows.length) throw new Error("The product file has no data rows.")
  if (new Set(headers).size !== headers.length || headers.some(header => !COLUMNS.has(header))) throw new Error("Use unique, exact product CSV headers. Unknown or duplicate headers cannot be imported.")
  const missing = REQUIRED.filter(header => !headers.includes(header))
  if (missing.length) throw new Error(`Required product columns are missing: ${missing.join(", ")}`)
  const safety = { findings: [] as ImportPreviewResponse["safety"]["findings"], blocked_cell_count: 0, is_safe_for_ai: true }
  for (let start = 0; start < rows.length; start += 50) {
    const report = assertCsvSafeForAi(headers, rows.slice(start, start + 50))
    safety.findings.push(...report.findings)
  }
  const categoryIds = new Set(args.categories.filter(row => String(row.organizationId) === String(args.organizationId)).map(row => String(row.id)))
  const uomIds = new Set(args.uoms.filter(row => String(row.organizationId) === String(args.organizationId)).map(row => String(row.id)))
  const validation_errors: ImportPreviewError[] = []
  const values = rows.map((row, row_index) => {
    const value = Object.fromEntries(headers.map((header, index) => [header, (row[index] ?? "").trim()]))
    const error = (field: string, message: string) => validation_errors.push({ row_index, field, message, severity: "error" })
    if (row.length !== headers.length) error("row", "The number of values must equal the number of headers.")
    for (const field of REQUIRED) if (!value[field]) error(field, "Enter an explicit value or save this row for review.")
    for (const field of ["sale_price", "cost_price"]) if (!isExplicitProductPrice(value[field])) error(field, "Enter a nonnegative price in the company currency per stored unit. Unknown is not zero.")
    if (!categoryIds.has(value.category_id)) error("category_id", "Choose a loaded category from this organization.")
    for (const field of ["uom_id", "uom_po_id"]) if (!uomIds.has(value[field])) error(field, "Choose a loaded unit from this organization.")
    for (const field of ["active", "can_be_sold", "can_be_purchased"]) if (field in value && !["true", "false"].includes(value[field])) error(field, "Use true or false explicitly.")
    for (const field of ["weight", "volume"]) if (field in value && !isExplicitProductPrice(value[field])) error(field, "Use an explicit nonnegative number.")
    if (value.type_field && !["product", "service", "consumable"].includes(value.type_field)) error("type_field", "Use product, service or consumable.")
    return value
  })
  const mapping = Object.fromEntries(headers.map(header => [header, header]))
  const analysis: ImportAnalyzeResponse = { target_entity: "product", mappings: headers.map(header => ({ source_column: header, target_field: header, confidence: 1, required: REQUIRED.includes(header) })), unmapped_source_columns: [], unmapped_target_fields: [], metadata_suggestions: [], structure: { column_count: headers.length, sample_row_count: rows.length, duplicate_headers: [], empty_columns: [], delimiter_hint: "," }, safety, warnings: [] }
  const preview: ImportPreviewResponse = { target_entity: "product", rows: values, validation_errors, safety, warnings: [] }
  return { mapping, analysis, preview }
}
