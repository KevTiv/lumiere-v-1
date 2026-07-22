"use client"


import { orgMasterCsvImportsBffPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { useMutation } from "@tanstack/react-query"

import { responseErrorMessage as parseCallErrorOrgMaster } from "@lumiere/api-client/response-error"

/** Reducers: `(organization_id, csv_data)` — no company scope. */
export function useImportCountryCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_country_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCurrencyCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_currency_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCurrencyRateCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_currency_rate_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportCompanyCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_company_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportRoleCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_role_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
      if (!res.ok) throw new Error(await parseCallErrorOrgMaster(res))
    },
  })
}

export function useImportAiAgentCsv(organizationId: number) {
  return useMutation({
    mutationFn: async (csvData: string) => {
      const { urlPath, init } = orgMasterCsvImportsBffPost("import_ai_agent_csv", [
        organizationId,
        csvData,
      ])
      const res = await apiFetch(urlPath, init)
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
