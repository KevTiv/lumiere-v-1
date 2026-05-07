"use client"

import { useMutation } from "@tanstack/react-query"

import { apiFetch } from "../http"

async function parseAiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export type AiMemoryContextHit = {
  score: number
  entity_type: string
  entity_id: string
  text: string
  timestamp: number
  source: string
}

export type AiRagSource = {
  content_type: string
  content_id: number
  score: number
  text_snippet: string
}

export function useAiMemorySearch() {
  return useMutation({
    mutationFn: async (args: { query: string; top_k?: number }) => {
      const r = await apiFetch("/api/ai/context/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          top_k: args.top_k,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { hits: AiMemoryContextHit[] }
    },
  })
}

export function useAiMemoryIngest() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/context/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { ingested: number }
    },
  })
}

export function useAiMemoryDocumentIngest() {
  return useMutation({
    mutationFn: async (args: {
      doc_id: string
      content: string
      doc_type?: string
      filename?: string
      mime_type?: string
    }) => {
      const r = await apiFetch("/api/ai/context/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as {
        ok: boolean
        doc_id: string
        chunks_embedded: number
        extracted_text: string
        structured_fields: unknown
        stdb_job_id: number
      }
    },
  })
}

/** RAG over company-scoped embedding collection (validated server-side). */
export function useAiMemoryRag() {
  return useMutation({
    mutationFn: async (args: {
      query: string
      companyId: number
      include_types?: string[]
      limit?: number
    }) => {
      const r = await apiFetch("/api/ai/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: args.query,
          companyId: args.companyId,
          include_types: args.include_types,
          limit: args.limit,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { answer: string; sources: AiRagSource[] }
    },
  })
}

export function useAiGatewayHealth() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiFetch("/api/ai/health", {
        method: "GET",
        cache: "no-store",
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as {
        configured: boolean
        upstreamStatus?: number
        upstreamOk?: boolean
        gateway?: unknown
        message?: string
        detail?: string
        reachable?: boolean
      }
    },
  })
}
