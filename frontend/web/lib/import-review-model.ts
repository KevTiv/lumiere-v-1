import { escapeCsvField } from "@lumiere/erp-shared/csv-import-transform"

export type ReviewField = { key: string; label: string; kind: "text" | "decimal" | "date" | "choice"; sourceValue: string | null; required: boolean; options?: string[]; export?: boolean }
export type ReviewSource = { key: string; label: string; source: { file: string; row: number; sha256: string; rowBasis?: "source_line" | "import_row" }; issue: string; fields: ReviewField[]; proposed: Record<string, string | null> }
export type ReviewDataset = { format: "lumiere-import-review/v1"; title: string; targetEntity: string; sourceFile: string; items: ReviewSource[] }
export type ReviewRow = { id: string; source: ReviewSource; values: Record<string, string | null>; state: "needs_review" | "confirmed" | "excluded"; revision: number; reason: string | null; reviewedBy: string | null; reviewedAt: string | null }
export type ReviewBatch = { id: string; title: string; targetEntity: string; sourceFile: string; total: number; pending: number; confirmed: number; excluded: number }
export type ReviewDetail = { id: string; title: string; targetEntity: string; sourceFile: string; items: ReviewRow[]; history: { itemId: string; revision: number; values: Record<string, string | null>; state: string; reason: string; actor: string; createdAt: string }[] }
export type ReviewedImportSource = { targetEntity: string; fileName: string; csv: string }

export const REVIEW_TARGETS = new Set(["product", "account_move", "stock_location", "contact", "source_observation"])

/** Capture the import copy exactly. Original cells never become confirmed facts. */
export async function reviewDatasetFromCsv(args: { title: string; targetEntity: string; fileName: string; csv: string; headers: string[]; rows: string[][]; mapping: Record<string, string>; requiredFields: string[]; issues: { row_index: number; field: string; message: string }[] }): Promise<ReviewDataset> {
  if (!REVIEW_TARGETS.has(args.targetEntity) || !args.rows.length || args.rows.length > 1000) throw new Error("Source review supports 1 to 1,000 rows for this target.")
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(args.csv))), b => b.toString(16).padStart(2, "0")).join("")
  const mapped = args.headers.flatMap((header, index) => {
    const target = args.mapping[header]
    return target && target !== "__skip__" ? [{ header, index, target }] : []
  })
  if (!mapped.length || new Set(mapped.map(column => column.target)).size !== mapped.length) throw new Error("Map each target field once before saving a review.")
  if (mapped.some(column => !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(column.target) || ["constructor", "prototype"].includes(column.target))) throw new Error("Use simple target column names before saving a source review.")
  const decimalFields = new Set(["sale_price", "cost_price", "quantity", "unit_price", "price_unit", "debit", "credit", "amount", "amount_total", "amount_untaxed", "amount_tax"])
  const dateFields = new Set(["date", "invoice_date", "invoice_date_due"])
  return {
    format: "lumiere-import-review/v1", title: args.title, targetEntity: args.targetEntity, sourceFile: args.fileName,
    items: args.rows.map((row, index) => {
      const issues = args.issues.filter(issue => issue.row_index === index)
      const productPrice = (key: string) => args.targetEntity === "product" && ["sale_price", "cost_price"].includes(key)
      const fields: ReviewField[] = mapped.map(column => ({ key: column.target, label: column.target.replaceAll("_", " "), kind: decimalFields.has(column.target) ? "decimal" : dateFields.has(column.target) ? "date" : "text", sourceValue: row[column.index] ?? "", required: args.requiredFields.includes(column.target) || productPrice(column.target), export: true }))
      const proposed = Object.fromEntries(mapped.map((column, fieldIndex) => {
        const value = row[column.index] ?? ""
        const kind = fields[fieldIndex].kind
        const invalid = kind === "decimal" && value !== "" && !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)
        const invalidDate = kind === "date" && value !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) !== value)
        return [column.target, invalid || invalidDate || issues.some(issue => issue.field === column.target) ? null : value]
      }))
      const name = mapped.find(column => ["name", "ref_", "internal_reference"].includes(column.target))
      if (args.targetEntity === "product") {
        for (const key of ["sale_price", "cost_price"]) if (!fields.some(field => field.key === key)) {
          fields.push({ key, label: key.replaceAll("_", " "), kind: "decimal", sourceValue: null, required: true, export: true })
          proposed[key] = null
        }
      }
      return { key: `row-${index + 2}`, label: (name ? row[name.index] : null) || `Row ${index + 2}`, source: { file: args.fileName, row: index + 2, sha256, rowBasis: "import_row" }, issue: issues.map(issue => issue.message).join("; ") || "Review units, dates and prices before import.", fields, proposed }
    }),
  }
}

/** Export only explicit confirmed values. Missing values never fall back to source cells. */
export function reviewedImportSource(detail: ReviewDetail): ReviewedImportSource {
  const confirmed = detail.items.filter(item => item.state === "confirmed")
  if (!confirmed.length) throw new Error("Confirm at least one row before continuing the import.")
  const headers = [...new Set(confirmed.flatMap(item => item.source.fields.filter(field => field.export !== false).map(field => field.key)))]
  if (detail.targetEntity === "product" && !headers.includes("metadata")) headers.push("metadata")
  const provenance = ["_source_file", "_source_row", "_source_sha256", "_review_item_id", "_review_revision", "_review_reason"]
  const csvRows = confirmed.map(item => {
    const values = { ...item.values }
    if (detail.targetEntity === "product") {
      if (["sale_price", "cost_price"].some(key => !/^\d{1,12}(?:\.\d{1,6})?$/.test(values[key] ?? ""))) throw new Error("Enter an explicit sale price and cost price before continuing a product import. Unknown prices remain in review.")
      let metadata: unknown = {}
      if (values.metadata) { try { metadata = JSON.parse(values.metadata) } catch { throw new Error("Product metadata must be a JSON object before continuing the import.") } }
      if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Product metadata must be a JSON object before continuing the import.")
      values.metadata = JSON.stringify({ ...metadata, source_review: { version: 1, batch_id: detail.id, item_id: item.id, revision: item.revision } })
    }
    return [...headers.map(key => values[key] ?? ""), item.source.source.file, String(item.source.source.row), item.source.source.sha256, item.id, String(item.revision), item.reason ?? ""]
  })
  return { targetEntity: detail.targetEntity, fileName: `reviewed-${detail.id}.csv`, csv: [[...headers, ...provenance], ...csvRows].map(row => row.map(escapeCsvField).join(",")).join("\n") }
}

export function reviewArithmetic(values: { quantity?: unknown; unit_price?: unknown }): string | null {
  const parse = (value: unknown): bigint | null => {
    if (typeof value !== "string" || !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) return null
    const negative = value.startsWith("-")
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
    const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))
    return negative ? -result : result
  }
  const quantity = parse(values.quantity), price = parse(values.unit_price)
  if (quantity == null || price == null) return null
  const product = quantity * price
  const negative = product < 0n
  const absolute = negative ? -product : product
  const whole = absolute / 1_000_000_000_000n
  const fraction = (absolute % 1_000_000_000_000n).toString().padStart(12, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}
