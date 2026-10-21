export const REPORT_EXPORT_PROVENANCE_SCHEMA = "lumiere.report-export-provenance/v1" as const

export interface ReportExportSourceProvenance {
  schema: typeof REPORT_EXPORT_PROVENANCE_SCHEMA
  organizationId: string
  companyId: string
  dashboardId: string
  widgetId?: string
  model: string
  domain: string | null
  groupBy: string | null
  startMs?: number
  endMs?: number
}

export interface ReportExportArtifactProvenance extends ReportExportSourceProvenance {
  exportedAt: string
  artifact: { filename: string; mimeType: string; sha256: string }
}

export function reportExportSourceProvenance(input: {
  organizationId: string | number | bigint
  companyId: string | number | bigint
  dashboardId: string | number | bigint
  widgetId?: string | number | bigint
  model: unknown
  domain?: unknown
  groupBy?: unknown
  startMs?: number
  endMs?: number
}): ReportExportSourceProvenance {
  return {
    schema: REPORT_EXPORT_PROVENANCE_SCHEMA,
    organizationId: String(input.organizationId),
    companyId: String(input.companyId),
    dashboardId: String(input.dashboardId),
    ...(input.widgetId == null ? {} : { widgetId: String(input.widgetId) }),
    model: String(input.model ?? ""),
    domain: input.domain == null || String(input.domain).trim() === "" ? null : String(input.domain),
    groupBy: input.groupBy == null || String(input.groupBy).trim() === "" ? null : String(input.groupBy),
    ...(input.startMs == null ? {} : { startMs: input.startMs }),
    ...(input.endMs == null ? {} : { endMs: input.endMs }),
  }
}

export function reportExportProvenanceJson(
  provenance: ReportExportSourceProvenance | ReportExportArtifactProvenance,
): string {
  return JSON.stringify(provenance)
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}
