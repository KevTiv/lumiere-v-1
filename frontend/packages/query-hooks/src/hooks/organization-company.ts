"use client"



import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { encodeOptionalString, stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { ClearablePatch } from "@lumiere/erp-shared/accounting-create-params"
import type {
  CreateCompanyParams,
  CreateDataClassificationParams,
  CreateDataClassificationRuleParams,
  DataClassification,
  DataClassificationRule,
  UpdateCompanyAddressParams,
  UpdateCompanyBusinessParams,
  UpdateCompanyHierarchyParams,
  UpdateCompanyParams,
} from "@lumiere/stdb/types"
import type { CompanyQueryRow } from "@lumiere/stdb/resource-reads"
import { createStdbSdk } from "@lumiere/stdb/sdk"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function stdbQueryKey(resource: string, organizationId: number) {
  return ["stdb", resource, organizationId] as const
}

export function useCompanies(organizationId: number, enabled: boolean) {
  return useQuery<CompanyQueryRow[]>({
    queryKey: stdbQueryKey("companies", organizationId),
    queryFn: () => createStdbSdk(apiFetch).organization.companies.list(),
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
  acceptanceStatus: string
  effectiveFrom?: unknown
  effectiveTo?: unknown
  isActive: boolean
  metadata?: string | null
}

export type CompanyCountryPackRow = {
  id: bigint | number | string
  companyId: bigint | number | string
  packKey: string
  pinnedPackVersion: string
  enabled: boolean
  configuration?: string | null
  activatedAt?: unknown
  updatedAt?: unknown
}

type CountryPackDefinitionWireRow = {
  packKey?: unknown
  pack_key?: unknown
  countryCode?: unknown
  country_code?: unknown
  name?: unknown
  region?: unknown
  version?: unknown
  acceptanceStatus?: unknown
  acceptance_status?: unknown
  effectiveFrom?: unknown
  effective_from?: unknown
  effectiveTo?: unknown
  effective_to?: unknown
  isActive?: unknown
  is_active?: unknown
  metadata?: unknown
}

type CompanyCountryPackWireRow = {
  id?: bigint | number | string
  companyId?: bigint | number | string
  company_id?: bigint | number | string
  packKey?: unknown
  pack_key?: unknown
  pinnedPackVersion?: unknown
  pinned_pack_version?: unknown
  enabled?: unknown
  configuration?: unknown
  activatedAt?: unknown
  activated_at?: unknown
  updatedAt?: unknown
  updated_at?: unknown
}

function countryPackDefinitionFromWire(row: CountryPackDefinitionWireRow): CountryPackDefinitionRow {
  return {
    packKey: String(row.packKey ?? row.pack_key ?? ""),
    countryCode: String(row.countryCode ?? row.country_code ?? ""),
    name: String(row.name ?? ""),
    region: String(row.region ?? ""),
    version: String(row.version ?? ""),
    acceptanceStatus: String(row.acceptanceStatus ?? row.acceptance_status ?? "unknown"),
    effectiveFrom: row.effectiveFrom ?? row.effective_from,
    effectiveTo: row.effectiveTo ?? row.effective_to,
    isActive: Boolean(row.isActive ?? row.is_active),
    metadata: row.metadata == null ? null : String(row.metadata),
  }
}

function companyCountryPackFromWire(row: CompanyCountryPackWireRow): CompanyCountryPackRow {
  return {
    id: row.id ?? "",
    companyId: row.companyId ?? row.company_id ?? "",
    packKey: String(row.packKey ?? row.pack_key ?? ""),
    pinnedPackVersion: String(row.pinnedPackVersion ?? row.pinned_pack_version ?? ""),
    enabled: Boolean(row.enabled),
    configuration: row.configuration == null ? null : String(row.configuration),
    activatedAt: row.activatedAt ?? row.activated_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  }
}

export function useCountryPackCatalog(enabled = true) {
  return useQuery<CountryPackDefinitionRow[]>({
    queryKey: ["country-pack-catalog"],
    queryFn: async () => {
      const response = await apiFetch("/api/country-packs/catalog")
      if (!response.ok) throw new Error(await parseCallError(response))
      const body = (await response.json()) as { data?: CountryPackDefinitionWireRow[] }
      return (body.data ?? []).map(countryPackDefinitionFromWire)
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
      const body = (await response.json()) as { data?: CompanyCountryPackWireRow[] }
      return (body.data ?? []).map(companyCountryPackFromWire)
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
  return useQuery<DataClassification[]>({
    queryKey: stdbQueryKey("data-classifications", organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/data-classifications")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: DataClassification[] }
      return j.data ?? []
    },
    enabled: enabled && organizationId > 0,
    staleTime: 30_000,
  })
}

export function useDataClassificationRules(organizationId: number, enabled: boolean) {
  return useQuery<DataClassificationRule[]>({
    queryKey: stdbQueryKey("data-classification-rules", organizationId),
    queryFn: async () => {
      const r = await apiFetch("/api/query/data-classification-rules")
      if (!r.ok) throw new Error(await parseCallError(r))
      const j = (await r.json()) as { data?: DataClassificationRule[] }
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
    mutationFn: async (params: CreateCompanyParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_company", { params: stdbParamsToJson(params as object, "CreateCompanyParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateOrgCompanyQueries(qc, organizationId),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: ClearablePatch<UpdateCompanyParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_company", { companyId: args.companyId, params: stdbParamsToJson(args.params as object, "UpdateCompanyParams") })
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
      const { urlPath, init } = stdbBffCommandPost("set_company_country_pack", { companyId: args.companyId, params: stdbParamsToJson(
          { packKey: args.packKey, enabled: args.enabled, configuration: args.configuration },
          "SetCompanyCountryPackParams",
        ) })
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
      const { urlPath, init } = stdbBffCommandPost("set_company_vertical_pack", { companyId: args.companyId, params: stdbParamsToJson({ packKey: args.packKey, enabled: args.enabled, configuration: encodeOptionalString(args.configuration) }, "SetCompanyVerticalPackParams") })
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
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: ClearablePatch<UpdateCompanyAddressParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_company_address", { companyId: args.companyId, params: stdbParamsToJson(args.params as object, "UpdateCompanyAddressParams") })
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
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: ClearablePatch<UpdateCompanyBusinessParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_company_business", { companyId: args.companyId, params: stdbParamsToJson(args.params as object, "UpdateCompanyBusinessParams") })
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
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: ClearablePatch<UpdateCompanyHierarchyParams> }) => {
      const { urlPath, init } = stdbBffCommandPost("update_company_hierarchy", { companyId: args.companyId, params: stdbParamsToJson(args.params as object, "UpdateCompanyHierarchyParams") })
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
      const { urlPath, init } = stdbBffCommandPost("delete_company", { companyId: args.companyId })
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
    mutationFn: async (params: CreateDataClassificationParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_data_classification", { params: stdbParamsToJson(params as object, "CreateDataClassificationParams") })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}

export function useCreateDataClassificationRule(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateDataClassificationRuleParams) => {
      const { urlPath, init } = stdbBffCommandPost("create_data_classification_rule", { params: stdbParamsToJson(params as object, "CreateDataClassificationRuleParams") })
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
      const { urlPath, init } = stdbBffCommandPost("execute_retention_purge", {  })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}
