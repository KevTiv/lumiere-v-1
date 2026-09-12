"use client"

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../../http"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"


export function usePerformanceCycles(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-cycles', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-cycles', 'Failed to fetch performance cycles'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePerformanceGoals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-goals', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-goals', 'Failed to fetch performance goals'),
    staleTime: 30_000,
    initialData,
  })
}

export function usePerformanceReviews(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/performance-reviews', 'Failed to fetch performance reviews'),
    staleTime: 30_000,
    initialData,
  })
}

export function useCreatePerformanceCycle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      name: string
      description?: string
      startDate: Date
      endDate: Date
      state?: string
      active?: boolean
    }
  >({
    mutationFn: async (params) => {
      const { urlPath, init } = stdbBffCommandPost("create_performance_cycle", { companyId: companyId ?? null, params: stdbParamsToJson({
          name: params.name,
          description: params.description ?? null,
          startDate: stbTimestampFromDate(params.startDate),
          endDate: stbTimestampFromDate(params.endDate),
          state: params.state ?? "draft",
          active: params.active ?? true,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-cycles', rqBigIntKey(organizationId)] })
    },
  })
}

export function useAddPerformanceGoal(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    {
      cycleId: number
      employeeId: number
      title: string
      description?: string
      targetValue?: number
      weight?: number
      state?: string
      reviewerEmployeeId?: number
    }
  >({
    mutationFn: async ({ cycleId, ...params }) => {
      const { urlPath, init } = stdbBffCommandPost("add_performance_goal", { companyId: companyId ?? null, cycleId: cycleId, params: stdbParamsToJson({
          employeeId: params.employeeId,
          title: params.title,
          description: params.description ?? null,
          targetValue: params.targetValue ?? null,
          weight: params.weight ?? 1,
          state: params.state ?? "draft",
          reviewerEmployeeId: params.reviewerEmployeeId ?? null,
        }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-goals', rqBigIntKey(organizationId)] })
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}

export function useSubmitPerformanceReview(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reviewId: number; selfRating: number; summary?: string }
  >({
    mutationFn: async ({ reviewId, selfRating, summary }) => {
      const { urlPath, init } = stdbBffCommandPost("submit_performance_review", { companyId: companyId ?? null, reviewId: reviewId, params: stdbParamsToJson({ selfRating, summary: summary ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}

export function useCompletePerformanceReview(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { reviewId: number; managerRating: number; summary?: string }
  >({
    mutationFn: async ({ reviewId, managerRating, summary }) => {
      const { urlPath, init } = stdbBffCommandPost("complete_performance_review", { companyId: companyId ?? null, reviewId: reviewId, params: stdbParamsToJson({ managerRating, summary: summary ?? null }) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-performance-reviews', rqBigIntKey(organizationId)] })
    },
  })
}
