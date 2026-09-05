"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"


export function useBenefitPlans(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-benefit-plans', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/benefit-plans', 'Failed to fetch benefit plans'),
    staleTime: 30_000,
    initialData,
  })
}

export function useBenefitEnrollments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/benefit-enrollments', 'Failed to fetch benefit enrollments'),
    staleTime: 30_000,
    initialData,
  })
}

export function useCreateBenefitPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { name: string; description?: string; planType: string; active?: boolean }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_benefit_plan", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          planType: params.planType,
          active: params.active ?? true,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-plans', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAssignBenefitEnrollment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { planId: number; employeeId: number; effectiveFrom?: Date }
  >({
    mutationFn: async ({ planId, employeeId, effectiveFrom }) => {
      const { urlPath, init } = stdbBffCommandPost("assign_benefit_enrollment", { companyId: companyId ?? null, params: stdbParamsToJson({
          planId,
          employeeId,
          effectiveFrom: stbTimestampFromDate(effectiveFrom ?? new Date()),
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)] })
    },
  })
}

export function useUnenrollBenefitEnrollment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (enrollmentId) => {
      const { urlPath, init } = stdbBffCommandPost("unenroll_benefit_enrollment", { companyId: companyId ?? null, enrollmentId: enrollmentId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-benefit-enrollments', rqBigIntKey(organizationId)] })
    },
  })
}
