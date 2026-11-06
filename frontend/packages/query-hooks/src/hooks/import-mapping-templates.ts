"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"

export type ImportMappingTemplateRow = {
  id?: number | string
  organizationId?: number | string
  organization_id?: number | string
  tableName?: string
  table_name?: string
  name?: string
  mappingJson?: string
  mapping_json?: string
  useCount?: number
  use_count?: number
}

function templateId(row: ImportMappingTemplateRow): string {
  return String(row.id ?? "")
}

function templateTableName(row: ImportMappingTemplateRow): string {
  return String(row.tableName ?? row.table_name ?? "")
}

function templateMappingJson(row: ImportMappingTemplateRow): string {
  return String(row.mappingJson ?? row.mapping_json ?? "{}")
}

const layoutKey = "_lumiere_layout"

export function importMappingTemplateMatchesHeaders(
  row: ImportMappingTemplateRow | undefined,
  headers: readonly string[],
): boolean {
  if (!row || !headers.length || new Set(headers).size !== headers.length) return false
  try {
    const parsed = JSON.parse(templateMappingJson(row))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    const layout = parsed[layoutKey]
    if (layout && typeof layout === "object") {
      return layout.version === 1 && Array.isArray(layout.headers)
        && layout.headers.length === headers.length
        && headers.every((header, index) => header === layout.headers[index])
    }
    const mapped = Object.keys(parseImportMappingTemplateJson(row))
    return mapped.length > 0 && mapped.every(header => headers.includes(header))
  } catch {
    return false
  }
}

export function parseImportMappingTemplateJson(
  row: ImportMappingTemplateRow,
): Record<string, string> {
  try {
    const parsed = JSON.parse(templateMappingJson(row)) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function mappingJsonForTemplate(mapping: Record<string, string>, headers?: readonly string[]): string {
  const filtered = Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value.trim() && value !== "__skip__"),
  )
  if (headers?.length && !headers.includes(layoutKey)) {
    return JSON.stringify({ ...filtered, [layoutKey]: { version: 1, headers } })
  }
  return JSON.stringify(filtered)
}

export function useImportMappingTemplates(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: ["import-mapping-templates", rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        "/api/query/import-mapping-templates",
        "Failed to fetch import mapping templates",
      ),
    enabled: organizationId > 0n && enabled,
  })
}

export function templatesForEntity(
  rows: ImportMappingTemplateRow[] | undefined,
  tableName: string,
): ImportMappingTemplateRow[] {
  if (!rows?.length) return []
  const normalized = tableName.trim().toLowerCase()
  return rows.filter((row) => templateTableName(row).toLowerCase() === normalized)
}

export function useSaveImportMappingTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      templateId?: bigint | number | null
      name: string
      tableName: string
      mapping: Record<string, string>
      headers?: readonly string[]
    }) => {
      const { urlPath, init } = stdbBffCommandPost("save_import_mapping_template", {
        templateId: args.templateId != null ? BigInt(args.templateId) : null,
        params: {
          name: args.name,
          table_name: args.tableName,
          mapping_json: mappingJsonForTemplate(args.mapping, args.headers),
        },
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to save import mapping template")
      }
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ["import-mapping-templates", rqBigIntKey(organizationId)],
      }),
  })
}

export function useDeleteImportMappingTemplate(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (templateId: bigint | number) => {
      const { urlPath, init } = stdbBffCommandPost("delete_import_mapping_template", {
        templateId: BigInt(templateId),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to delete import mapping template")
      }
    },
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ["import-mapping-templates", rqBigIntKey(organizationId)],
      }),
  })
}

export function useFinalizeImportAssistantJob(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      jobId: bigint | number
      metadata: Record<string, unknown>
      templateId?: bigint | number | null
    }) => {
      const { urlPath, init } = stdbBffCommandPost("finalize_import_assistant_job", {
        jobId: BigInt(args.jobId),
        params: {
          metadata_json: JSON.stringify(args.metadata),
          template_id: args.templateId != null ? BigInt(args.templateId) : null,
        },
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? "Failed to finalize import assistant job")
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["import-jobs", rqBigIntKey(organizationId)] })
      void qc.invalidateQueries({
        queryKey: ["import-mapping-templates", rqBigIntKey(organizationId)],
      })
    },
  })
}

export { templateId, templateTableName }
