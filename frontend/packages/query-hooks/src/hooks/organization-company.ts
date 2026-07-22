"use client"


import { organizationCompanyBffPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function stdbQueryKey(resource: string, organizationId: number) {
  return ["stdb", resource, organizationId] as const
}

export function useCompanies(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: stdbQueryKey("companies", organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/companies")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

export type CompanyVerticalPackRow = {
  id: bigint | number | string
  companyId: bigint | number | string
  packKey: string
  enabled: boolean
  configuration?: string | null
  updatedAt: unknown
}

export type CountryPackDefinitionRow = {
  packKey: string
  countryCode: string
  name: string
  region: string
  version: string
  isActive: boolean
  metadata?: string | null
}

export type CompanyCountryPackRow = {
  id: bigint | number | string
  companyId: bigint | number | string
  packKey: string
  enabled: boolean
  configuration?: string | null
  activatedAt?: unknown
  updatedAt?: unknown
}

export function useCountryPackCatalog(enabled = true) {
  return useQuery<CountryPackDefinitionRow[]>({
    queryKey: ["country-pack-catalog"],
    queryFn: async () => {
      const response = await apiFetch("/api/country-packs/catalog")
      if (!response.ok) throw new Error(await parseCallError(response))
      const body = (await response.json()) as { data?: CountryPackDefinitionRow[] }
      return body.data ?? []
    },
    enabled,
    staleTime: 300_000,
  })
}

export function useCompanyCountryPacks(companyId: bigint, enabled = true) {
  return useQuery<CompanyCountryPackRow[]>({
    queryKey: ["company-country-packs", String(companyId)],
    queryFn: async () => {
      const response = await apiFetch(`/api/country-packs/${companyId}`)
      if (!response.ok) throw new Error(await parseCallError(response))
      const body = (await response.json()) as { data?: CompanyCountryPackRow[] }
      return body.data ?? []
    },
    enabled: enabled && companyId > 0n,
    staleTime: 30_000,
  })
}

export function useCompanyVerticalPacks(companyId: bigint, enabled = true) {
  return useQuery<CompanyVerticalPackRow[]>({
    queryKey: ["company-vertical-packs", String(companyId)],
    queryFn: async () => {
      const response = await apiFetch(`/api/vertical-packs/${companyId}`)
      if (!response.ok) throw new Error(await parseCallError(response))
      const body = (await response.json()) as { data?: CompanyVerticalPackRow[] }
      return body.data ?? []
    },
    enabled: enabled && companyId > 0n,
    staleTime: 30_000,
  })
}

export function useDataClassifications(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: stdbQueryKey("data-classifications", organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/data-classifications")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

export function useDataClassificationRules(organizationId: number, enabled: boolean) {
  return useQuery({
    queryKey: stdbQueryKey("data-classification-rules", organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/data-classification-rules")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: Record<string, unknown>[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

function invalidateOrgCompanyQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  void qc.invalidateQueries({ queryKey: stdbQueryKey("companies", organizationId) })
}

function invalidatePrivacyQueries(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  void qc.invalidateQueries({ queryKey: stdbQueryKey("data-classifications", organizationId) })
  void qc.invalidateQueries({ queryKey: stdbQueryKey("data-classification-rules", organizationId) })
}

export function useCreateCompany(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = organizationCompanyBffPost("create_company", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateOrgCompanyQueries(qc, organizationId),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const { urlPath, init } = organizationCompanyBffPost("update_company", [
        args.companyId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

/** Company-scoped country/locale pack enablement. */
export function useSetCompanyCountryPack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      organizationId: number
      packKey: string
      enabled: boolean
      configuration?: string
    }) => {
      const { urlPath, init } = organizationCompanyBffPost("set_company_country_pack", [
        args.organizationId,
        args.companyId,
        stdbParamsToJson(
          { packKey: args.packKey, enabled: args.enabled, configuration: args.configuration },
          "SetCompanyCountryPackParams",
        ),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
      return args.organizationId
    },
    onSuccess: (organizationId, args) => {
      invalidateOrgCompanyQueries(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ["company-country-packs", String(args.companyId)] })
    },
  })
}

/** Company-scoped vertical-pack enablement. The server keeps immutable business history when disabled. */
export function useSetCompanyVerticalPack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; packKey: "distributor_wholesaler"; enabled: boolean; configuration?: string }) => {
      const { urlPath, init } = organizationCompanyBffPost("set_company_vertical_pack", [
        args.companyId,
        stdbParamsToJson({ packKey: args.packKey, enabled: args.enabled, configuration: args.configuration }, "SetCompanyVerticalPackParams"),
      ])
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error(await parseCallError(response))
      return args.organizationId
    },
    onSuccess: (organizationId, args) => {
      invalidateOrgCompanyQueries(qc, organizationId)
      void qc.invalidateQueries({ queryKey: ["company-vertical-packs", String(args.companyId)] })
    },
  })
}

export function useUpdateCompanyAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const { urlPath, init } = organizationCompanyBffPost("update_company_address", [
        args.companyId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

export function useUpdateCompanyBusiness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const { urlPath, init } = organizationCompanyBffPost("update_company_business", [
        args.companyId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

export function useUpdateCompanyHierarchy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const { urlPath, init } = organizationCompanyBffPost("update_company_hierarchy", [
        args.companyId,
        stdbParamsToJson(args.params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

export function useDeleteCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number }) => {
      const { urlPath, init } = organizationCompanyBffPost("delete_company", [args.companyId])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

export function useCreateDataClassification(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = organizationCompanyBffPost("create_data_classification", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}

export function useCreateDataClassificationRule(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = organizationCompanyBffPost("create_data_classification_rule", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}

export function useExecuteRetentionPurge(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { urlPath, init } = organizationCompanyBffPost("execute_retention_purge", [
        organizationId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}
