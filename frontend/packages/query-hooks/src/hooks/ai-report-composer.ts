"use client"

import { useMutation } from "@tanstack/react-query"

import type {
  ReportComposerInput,
  ReportComposerResult,
} from "@lumiere/erp-shared/ai-report-composer-schemas"

import { apiFetch } from "../http"

export type { ReportComposerInput, ReportComposerResult }

import { responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

export function useAiReportComposer() {
  return useMutation({
    mutationFn: async (input: ReportComposerInput) => {
      const r = await apiFetch("/api/ai/report/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as ReportComposerResult
    },
  })
}
