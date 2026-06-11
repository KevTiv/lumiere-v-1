"use client"

import { useMutation } from "@tanstack/react-query"

import { apiFetch } from "../http"

async function parseAiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export type AiFormFieldSchema = {
  name: string
  label?: string
  type: string
  required: boolean
  options?: Array<{ value: string; label: string; disabled?: boolean }>
  validation?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
  }
}

export type AiFormSuggestionSource = {
  type: string
  label?: string
  value?: string
  field?: string
}

export type AiFormSuggestion = {
  value: unknown
  confidence: number
  note?: string
  sources?: AiFormSuggestionSource[]
}

export type AiFormSuggestResponse = {
  suggestions: Record<string, AiFormSuggestion>
  validation_notes: Array<{ field?: string; message: string; severity?: "info" | "warning" | "error" }>
  sources: AiFormSuggestionSource[]
}

export type AiFormValidateResponse = {
  field_errors: Record<string, string>
  validation_notes: Array<{ field?: string; message: string; severity?: "info" | "warning" | "error" }>
}

export function useAiFormSuggest() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      formId: string
      entityType: string
      fields: AiFormFieldSchema[]
      rawText?: string
      documentJobId?: number | string
    }) => {
      const r = await apiFetch("/api/ai/forms/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          form_id: args.formId,
          entity_type: args.entityType,
          fields: args.fields,
          raw_text: args.rawText,
          document_job_id: args.documentJobId,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiFormSuggestResponse
    },
  })
}

export function useAiFormValidate() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      formId: string
      entityType: string
      fields: AiFormFieldSchema[]
      values: Record<string, unknown>
    }) => {
      const r = await apiFetch("/api/ai/forms/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          form_id: args.formId,
          entity_type: args.entityType,
          fields: args.fields,
          values: args.values,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiFormValidateResponse
    },
  })
}
