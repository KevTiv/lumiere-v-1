import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { resolveUniqueRow, type CanonicalRecordRef } from "./operation-effect"

export interface ReportTemplateEditRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  orientation?: unknown
  paperFormat?: unknown
  paper_format?: unknown
  templateContent?: unknown
  template_content?: unknown
}
export interface ReportTemplateEditValues {
  orientation: string
  paperFormat?: string
  templateContent?: string
}
export interface ReportTemplateUpdateRef extends CanonicalRecordRef {
  resource: "report-templates"
  href: string
}
const optional = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export function reportTemplateEditValues(row: ReportTemplateEditRow): ReportTemplateEditValues {
  if (
    typeof row.orientation !== "string" ||
    (!("templateContent" in row) && !("template_content" in row)) ||
    (!("paperFormat" in row) && !("paper_format" in row))
  ) {
    throw new Error(
      "Template layout fields are unavailable. Refresh the authorized template data before editing.",
    )
  }
  return {
    orientation: row.orientation,
    paperFormat: optional(row.paperFormat ?? row.paper_format),
    templateContent: optional(row.templateContent ?? row.template_content),
  }
}
export function reportTemplateValuesEqual(
  left: ReportTemplateEditValues,
  right: ReportTemplateEditValues,
): boolean {
  return (
    left.orientation === right.orientation &&
    left.paperFormat === right.paperFormat &&
    left.templateContent === right.templateContent
  )
}
export function currentReportTemplate(
  rows: readonly ReportTemplateEditRow[],
  organizationId: bigint,
  companyId: bigint,
  templateId: bigint,
): ReportTemplateEditRow | null {
  const row = resolveUniqueRow(
    rows,
    (candidate) =>
      parseStrictU64(candidate.id) === templateId &&
      parseStrictU64(candidate.organizationId ?? candidate.organization_id) === organizationId,
  )
  if (!row) return null
  const scope = row.companyId ?? row.company_id
  if (scope != null && parseStrictU64(scope) !== companyId)
    throw new Error("Template is outside the current company.")
  if (!("companyId" in row) && !("company_id" in row))
    throw new Error("Template company scope is unavailable.")
  return row
}
export function resolveReportTemplateUpdate(
  rows: readonly ReportTemplateEditRow[],
  organizationId: bigint,
  companyId: bigint,
  templateId: bigint,
  desired: ReportTemplateEditValues,
): ReportTemplateUpdateRef | null {
  const row = currentReportTemplate(rows, organizationId, companyId, templateId)
  if (!row || !reportTemplateValuesEqual(reportTemplateEditValues(row), desired)) return null
  return {
    resource: "report-templates",
    id: String(templateId),
    href: `/reports?tab=report-templates&filter=id:${templateId}`,
  }
}
