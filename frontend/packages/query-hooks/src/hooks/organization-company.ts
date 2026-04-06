"use client"

import { apiFetch } from "../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"

async function parseCallError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  return j.error ?? `Request failed (${r.status})`
}

function stdbQueryKey(resource: string, organizationId: number) {
  return ["stdb", resource, String(organizationId)] as const
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
      const r = await apiFetch("/api/call/create_company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateOrgCompanyQueries(qc, organizationId),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.companyId), stdbParamsToJson(args.params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
      return args.organizationId
    },
    onSuccess: (orgId) => {
      if (orgId != null) invalidateOrgCompanyQueries(qc, orgId)
    },
  })
}

export function useUpdateCompanyAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; organizationId: number; params: Record<string, unknown> }) => {
      const r = await apiFetch("/api/call/update_company_address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.companyId), stdbParamsToJson(args.params as object)]),
      })
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
      const r = await apiFetch("/api/call/update_company_business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.companyId), stdbParamsToJson(args.params as object)]),
      })
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
      const r = await apiFetch("/api/call/update_company_hierarchy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.companyId), stdbParamsToJson(args.params as object)]),
      })
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
      const r = await apiFetch("/api/call/delete_company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(args.companyId)]),
      })
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
      const r = await apiFetch("/api/call/create_data_classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}

export function useCreateDataClassificationRule(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const r = await apiFetch("/api/call/create_data_classification_rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([String(organizationId), stdbParamsToJson(params as object)]),
      })
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidatePrivacyQueries(qc, organizationId),
  })
}
