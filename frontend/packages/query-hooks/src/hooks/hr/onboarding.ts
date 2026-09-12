"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"


export function useOnboardingTemplates(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-templates', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-templates', 'Failed to fetch onboarding templates'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOnboardingTemplateItems(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-template-items', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-template-items', 'Failed to fetch onboarding template items'),
    staleTime: 30_000,
    initialData,
  })
}

export function useOnboardingProgress(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/onboarding-progress', 'Failed to fetch onboarding progress'),
    staleTime: 30_000,
    initialData,
  })
}

export function useStartOffboarding(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (employeeId) => {
      const { urlPath, init } = stdbBffCommandPost("start_offboarding", { companyId: companyId ?? null, employeeId: employeeId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to start offboarding')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompleteOffboardingItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; item: string; notes?: string }>({
    mutationFn: async ({ employeeId, item, notes }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_offboarding_item", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ item, notes: notes ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to complete offboarding item')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCreateOnboardingTemplate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      name: string
      description?: string
      active?: boolean
      items: Array<{ title: string; description?: string; sequence: number; required: boolean }>
    }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_onboarding_template", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          active: params.active ?? true,
          items: params.items,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-templates', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-onboarding-template-items', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAssignOnboardingTemplate(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; templateId: number }>({
    mutationFn: async ({ employeeId, templateId }) => {
      const { urlPath, init } = stdbBffCommandPost("assign_onboarding_template", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ templateId }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompleteOnboardingItem(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { employeeId: number; templateItemId: number; notes?: string }>({
    mutationFn: async ({ employeeId, templateItemId, notes }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_onboarding_item", { companyId: companyId ?? null, employeeId: employeeId, params: stdbParamsToJson({ templateItemId, notes: notes ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
    },
  })
}

export function useMarkOnboardingDone(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (employeeId) => {
      const { urlPath, init } = stdbBffCommandPost("mark_onboarding_done", { companyId: companyId ?? null, employeeId: employeeId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-onboarding-progress', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-employees', rqBigIntKey(organizationId)] })
    },
  })
}
