"use client"

import { useMutation } from "@tanstack/react-query"

import type { AiUiContext } from "../ai-ui-context"
import { apiFetch } from "../http"

export type { AiUiContext } from "../ai-ui-context"

export type AiGatewayJson = Record<string, unknown>

async function parseAiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

async function postAiBff(path: string, body: Record<string, unknown>): Promise<AiGatewayJson> {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await parseAiError(r))
  return (await r.json()) as AiGatewayJson
}

export type AiSearchHit = {
  score: number
  content_type: string
  content_id: number
  stdb_embedding_id?: number
  text_snippet: string
}

export function useAiSearch() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      query: string
      contentType?: string
      limit?: number
      scoreThreshold?: number
    }) =>
      postAiBff("/api/ai/search", {
        companyId: args.companyId,
        query: args.query,
        ...(args.contentType ? { content_type: args.contentType } : {}),
        ...(args.limit != null ? { limit: args.limit } : {}),
        ...(args.scoreThreshold != null ? { score_threshold: args.scoreThreshold } : {}),
      }) as Promise<{ query: string; company_id: number; results: AiSearchHit[] }>,
  })
}

export function useAiActionDraft() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      query: string
      ui_context?: AiUiContext
      allowed_reducers?: string[]
    }) =>
      postAiBff("/api/ai/actions/draft", {
        companyId: args.companyId,
        query: args.query,
        ...(args.ui_context ? { ui_context: args.ui_context } : {}),
        ...(args.allowed_reducers?.length ? { allowed_reducers: args.allowed_reducers } : {}),
      }),
  })
}

export function useAiBriefing() {
  return useMutation({
    mutationFn: async (args: {
      companyId?: number
      since_micros?: number
      window?: string
      resources?: string[]
      resource_filters?: Record<string, unknown>
    }) =>
      postAiBff("/api/ai/briefing", {
        ...(args.companyId != null ? { companyId: args.companyId } : {}),
        ...(args.since_micros != null ? { since_micros: args.since_micros } : {}),
        ...(args.window ? { window: args.window } : {}),
        ...(args.resources?.length ? { resources: args.resources } : {}),
        ...(args.resource_filters ? { resource_filters: args.resource_filters } : {}),
      }),
  })
}

export function useAiImportAnalyze() {
  return useMutation({
    mutationFn: async (args: {
      companyId?: number
      target_entity: string
      header: string[]
      sample_rows?: unknown[]
      prior_mappings?: Record<string, unknown>
      instructions?: string
    }) =>
      postAiBff("/api/ai/import/analyze", {
        ...(args.companyId != null ? { companyId: args.companyId } : {}),
        target_entity: args.target_entity,
        header: args.header,
        ...(args.sample_rows ? { sample_rows: args.sample_rows } : {}),
        ...(args.prior_mappings ? { prior_mappings: args.prior_mappings } : {}),
        ...(args.instructions ? { instructions: args.instructions } : {}),
      }),
  })
}

export function useAiImportPreview() {
  return useMutation({
    mutationFn: async (args: {
      companyId?: number
      target_entity: string
      header: string[]
      sample_rows: unknown[]
      mapping: Record<string, unknown>
      transforms?: Record<string, unknown>
    }) =>
      postAiBff("/api/ai/import/preview", {
        ...(args.companyId != null ? { companyId: args.companyId } : {}),
        target_entity: args.target_entity,
        header: args.header,
        sample_rows: args.sample_rows,
        mapping: args.mapping,
        ...(args.transforms ? { transforms: args.transforms } : {}),
      }),
  })
}

export function useAiReportExplain() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      report_type: string
      report_id?: number
      comparison_report_id?: number
      report_payload?: Record<string, unknown>
      report_lines?: unknown[]
      question?: string
    }) =>
      postAiBff("/api/ai/reports/explain", {
        companyId: args.companyId,
        report_type: args.report_type,
        ...(args.report_id != null ? { report_id: args.report_id } : {}),
        ...(args.comparison_report_id != null
          ? { comparison_report_id: args.comparison_report_id }
          : {}),
        ...(args.report_payload ? { report_payload: args.report_payload } : {}),
        ...(args.report_lines?.length ? { report_lines: args.report_lines } : {}),
        ...(args.question ? { question: args.question } : {}),
      }),
  })
}

export function useAiInsightsGenerate() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      resource?: string
      scope?: Record<string, unknown>
      force?: boolean
    }) =>
      postAiBff("/api/ai/insights/generate", {
        companyId: args.companyId,
        ...(args.resource ? { resource: args.resource } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.force === true ? { force: true } : {}),
      }),
  })
}
