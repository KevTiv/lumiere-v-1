
import { i18n } from "@lumiere/i18n"
/** Local layout markup only. Dynamic data binding remains the report renderer's responsibility. */
export const REPORT_COLUMNS = [
  { key: "number", get label() { return i18n.t("reports.templateLayout.documentNumber") }, labelKey: "reports.templateLayout.documentNumber", example: "INV-EXAMPLE" },
  { key: "date", get label() { return i18n.t("reports.ownerReports.dateLabel") }, labelKey: "reports.ownerReports.dateLabel", example: "2026-10-20" },
  { key: "partner", get label() { return i18n.t("accounting.glDrilldown.columns.partner") }, labelKey: "accounting.glDrilldown.columns.partner", get example() { return i18n.t("reports.templateLayout.exampleCustomer") } },
  { key: "total", get label() { return i18n.t("common.entityView.pivotTotal") }, labelKey: "common.entityView.pivotTotal", example: "125.00" },
] as const
export type ReportColumnKey = (typeof REPORT_COLUMNS)[number]["key"]
export type TemplateBlock =
  | { id: string; kind: "heading" | "paragraph"; text: string }
  | { id: string; kind: "table"; columns: ReportColumnKey[] }
const prefix = "<!--lumiere-layout-v1:"
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  )

export function parseTemplateBlocks(content: string): TemplateBlock[] | null {
  if (!content.trim()) return []
  if (!content.startsWith(prefix)) return null
  const end = content.indexOf("-->", prefix.length)
  if (end < 0) return null
  try {
    const value: unknown = JSON.parse(content.slice(prefix.length, end))
    if (!Array.isArray(value) || value.length > 100) return null
    const ids = new Set<string>()
    for (const block of value) {
      if (!block || typeof block !== "object" || typeof block.id !== "string" || ids.has(block.id))
        return null
      ids.add(block.id)
      if (block.kind === "table") {
        if (
          !Array.isArray(block.columns) ||
          block.columns.some(
            (key: unknown) => !REPORT_COLUMNS.some((column) => column.key === key),
          ) ||
          new Set(block.columns).size !== block.columns.length
        )
          return null
      } else if (!["heading", "paragraph"].includes(block.kind) || typeof block.text !== "string")
        return null
    }
    return serializeTemplateBlocks(value as TemplateBlock[]) === content
      ? (value as TemplateBlock[])
      : null
  } catch {
    return null
  }
}

function blockMarkup(block: TemplateBlock, examples: boolean): string {
  if (block.kind === "table") {
    const columns = block.columns.map((key) => REPORT_COLUMNS.find((column) => column.key === key)!)
    return `<table><thead><tr>${columns.map((column) => `<th>${escape(examples ? column.label : i18n.t(column.labelKey, { lng: "en" }))}</th>`).join("")}</tr></thead><tbody>${examples ? `<tr>${columns.map((column) => `<td>${escape(column.example)}</td>`).join("")}</tr>` : ""}</tbody></table>`
  }
  return block.kind === "heading"
    ? `<h2>${escape(block.text)}</h2>`
    : `<p>${escape(block.text).replace(/\n/g, "<br>")}</p>`
}

export function serializeTemplateBlocks(blocks: readonly TemplateBlock[]): string {
  const metadata = JSON.stringify(blocks)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
  return `${prefix}${metadata}-->\n${blocks.map((block) => blockMarkup(block, false)).join("\n")}`
}

export function templatePreviewDocument(content: string, orientation: string): string {
  const blocks = parseTemplateBlocks(content)
  const markup = blocks ? blocks.map((block) => blockMarkup(block, true)).join("\n") : content
  const policy =
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{font:14px system-ui;margin:24px;color:#161616;background:white;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left}h2{margin:16px 0}p{line-height:1.5}body{max-width:${orientation === "Landscape" ? "1000" : "700"}px}</style></head><body>${markup}</body></html>`
}
