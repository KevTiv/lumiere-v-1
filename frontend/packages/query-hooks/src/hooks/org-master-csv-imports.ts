"use client"


import { stringifyReducerCallBody } from "@lumiere/api-client"
import { apiFetch } from "../http"
import { useMutation } from "@tanstack/react-query"

async function parseCallErrorOrgMaster(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: string }
  return j.error ?? res.statusText ?? "Request failed"
}

/** Reducers: `(organization_id, csv_data)` — no company scope. */
export function useImportCountryCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_country_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCurrencyCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_currency_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCurrencyRateCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_currency_rate_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCompanyCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_company_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportRoleCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_role_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportAiAgentCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const res = await apiFetch("/api/call/import_ai_agent_csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyReducerCallBody([organizationId, csvData]),
      })
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useOrgMasterCsvImportMutations(organizationId: number) {
  return {
    importCountry: useImportCountryCsv(organizationId),
    importCurrency: useImportCurrencyCsv(organizationId),
    importCurrencyRate: useImportCurrencyRateCsv(organizationId),
    importCompany: useImportCompanyCsv(organizationId),
    importRole: useImportRoleCsv(organizationId),
    importAiAgent: useImportAiAgentCsv(organizationId),
  }
}

export type OrgMasterCsvImportMutations = ReturnType<typeof useOrgMasterCsvImportMutations>
