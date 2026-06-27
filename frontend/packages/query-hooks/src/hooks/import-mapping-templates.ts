"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { stdbBffPost } from "@lumiere/stdb/commands"

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

export function mappingJsonForTemplate(mapping: Record<string, string>): string {
  const filtered = Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value.trim() && value !== "__skip__"),
  )
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
    }) => {
      const { urlPath, init } = stdbBffPost("save_import_mapping_template", [
        organizationId,
        args.templateId != null ? BigInt(args.templateId) : null,
        {
          name: args.name,
          table_name: args.tableName,
          mapping_json: mappingJsonForTemplate(args.mapping),
        },
      ])
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
      const { urlPath, init } = stdbBffPost("delete_import_mapping_template", [
        organizationId,
        BigInt(templateId),
      ])
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
      const { urlPath, init } = stdbBffPost("finalize_import_assistant_job", [
        organizationId,
        BigInt(args.jobId),
        {
          metadata_json: JSON.stringify(args.metadata),
          template_id: args.templateId != null ? BigInt(args.templateId) : null,
        },
      ])
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
