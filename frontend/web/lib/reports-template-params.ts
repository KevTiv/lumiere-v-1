/**
 * Form → `CreateReportTemplateParams` for `create_report_template`.
 */

import type { CreateReportTemplateParams } from '@lumiere/stdb/generated/types'

function parseF64(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function toCreateReportTemplateParams(
  formData: Record<string, unknown>,
): CreateReportTemplateParams | null {
  const name = String(formData.name ?? '').trim()
  if (!name) return null

  return {
    name,
    model: String(formData.model ?? 'account.move'),
    reportType: String(formData.reportType ?? 'PDF'),
    orientation: String(formData.orientation ?? 'Portrait'),
    marginTop: parseF64(formData.marginTop, 10),
    marginBottom: parseF64(formData.marginBottom, 10),
    marginLeft: parseF64(formData.marginLeft, 7),
    marginRight: parseF64(formData.marginRight, 7),
    headerLine: Boolean(formData.headerLine ?? true),
    footerLine: Boolean(formData.footerLine ?? true),
    attachmentUse: Boolean(formData.attachmentUse),
    multiCompany: Boolean(formData.multiCompany),
    isActive: Boolean(formData.isActive ?? true),
    description: undefined,
    templateContent: undefined,
    paperFormat: undefined,
    printReportName: undefined,
    attachment: undefined,
    metadata: undefined,
  }
}
