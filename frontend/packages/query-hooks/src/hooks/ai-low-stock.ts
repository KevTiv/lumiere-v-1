"use client"

import { useMutation } from "@tanstack/react-query"

import type {
  LowStockInput,
  LowStockScanResult,
} from "@lumiere/erp-shared/ai-low-stock-schemas"

import { apiFetch } from "../http"

export type { LowStockInput, LowStockScanResult }

import { responseErrorMessage as parseAiError } from "@lumiere/api-client/response-error"

export function useAiLowStockScan() {
  return useMutation({
    mutationFn: async (input: LowStockInput & { companyId: number }) => {
      const r = await apiFetch("/api/ai/inventory/low-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as LowStockScanResult
    },
  })
}
