"use client"

import { useMutation } from "@tanstack/react-query"

import { apiFetch } from "../http"

export type ImportColumnMapping = {
  source_column: string
  target_field: string
  confidence: number
  transform?: string
  required?: boolean
}

export type ImportMetadataSuggestion = {
  source_column: string
  metadata_key: string
  reason: string
}

export type ImportCsvStructure = {
  column_count: number
  sample_row_count: number
  duplicate_headers: string[]
  empty_columns: string[]
  delimiter_hint: string
}

export type ImportCsvSafetyFinding = {
  location: string
  kind: string
  message: string
  severity: string
}

export type ImportCsvSafetyReport = {
  findings: ImportCsvSafetyFinding[]
  blocked_cell_count: number
  is_safe_for_ai: boolean
}

export type ImportBundleHint = {
  key: string
  line_entity: string
  line_mappings: ImportColumnMapping[]
  line_unmapped_target_fields: string[]
  suggested_parent_link_source?: string | null
}

export type ImportAnalyzeResponse = {
  target_entity: string
  mappings: ImportColumnMapping[]
  unmapped_source_columns: string[]
  unmapped_target_fields: string[]
  metadata_suggestions: ImportMetadataSuggestion[]
  structure: ImportCsvStructure
  safety: ImportCsvSafetyReport
  warnings: string[]
  bundle?: ImportBundleHint | null
}

export type ImportPreviewError = {
  row_index: number
  field: string
  message: string
  severity: string
}

export type ImportPreviewResponse = {
  target_entity: string
  rows: Array<Record<string, unknown>>
  validation_errors: ImportPreviewError[]
  safety: ImportCsvSafetyReport
  warnings: string[]
}

async function parseAiImportError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export function useAnalyzeImportMapping() {
  return useMutation({
    mutationFn: async (args: {
      targetEntity: string
      headers?: string[]
      sampleRows?: string[][]
      csvText?: string
      priorMappings?: Record<string, string>
      bundleKey?: string
    }) => {
      const r = await apiFetch("/api/ai/import/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEntity: args.targetEntity,
          ...(args.headers ? { headers: args.headers } : {}),
          ...(args.sampleRows ? { sampleRows: args.sampleRows } : {}),
          ...(args.csvText ? { csvText: args.csvText } : {}),
          ...(args.priorMappings ? { priorMappings: args.priorMappings } : {}),
          ...(args.bundleKey ? { bundleKey: args.bundleKey } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiImportError(r))
      return (await r.json()) as ImportAnalyzeResponse
    },
  })
}

export function usePreviewImportMapping() {
  return useMutation({
    mutationFn: async (args: {
      targetEntity: string
      headers: string[]
      rows: string[][]
      mapping: Record<string, string>
      maxRows?: number
    }) => {
      const r = await apiFetch("/api/ai/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEntity: args.targetEntity,
          headers: args.headers,
          rows: args.rows,
          mapping: args.mapping,
          ...(args.maxRows != null ? { maxRows: args.maxRows } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiImportError(r))
      return (await r.json()) as ImportPreviewResponse
    },
  })
}
