"use client"

/**
 * Subscriptions hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Subscriptions module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */


import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows, rqBigIntKey } from "../http"
import { subscriptionsBffPost } from "@lumiere/stdb/commands"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CreateDeferredRevenueScheduleParams,
  CreateRevenueRecognitionRuleParams,
} from '@lumiere/stdb/types'

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSubscriptions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscriptions', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/subscriptions', 'Failed to fetch subscriptions'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionPlans(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-plans', rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList('/api/query/subscription-plans', 'Failed to fetch subscription plans'),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeferredRevenueSchedules(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['deferred-revenue-schedules', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/deferred-revenue-schedules',
        'Failed to fetch deferred revenue schedules',
      ),
    staleTime: 30_000,
    initialData,
  })
}

export function useDeferredRevenueLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['deferred-revenue-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/deferred-revenue-lines', 'Failed to fetch deferred revenue lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function useRevenueRecognitionRules(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['revenue-recognition-rules', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/revenue-recognition-rules',
        'Failed to fetch revenue recognition rules',
      ),
    staleTime: 30_000,
    initialData,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateSubscriptionPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_plan", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateSubscriptionFromSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_from_sale_order", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId)),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create subscription from sale order')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useCreateSubscription(organizationId: bigint, companyId?: bigint) {
  return useCreateSubscriptionFromSaleOrder(organizationId, companyId)
}

export function useActivateSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint }>({
    mutationFn: async ({ subscriptionId }) => {
      const { urlPath, init } = subscriptionsBffPost("activate_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to activate subscription')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
  })
}

export function useCloseSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("close_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to close subscription')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
  })
}

export function useGenerateSubscriptionInvoice(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("generate_subscription_invoice", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to generate subscription invoice')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateDeferredRevenueSchedule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateDeferredRevenueScheduleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_deferred_revenue_schedule", [
        organizationId,
        companyId ?? organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create deferred revenue schedule')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useRecognizeDeferredRevenue(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("recognize_deferred_revenue", [
        organizationId,
        companyId ?? organizationId,
        lineId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to recognize deferred revenue')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function useCreateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateRevenueRecognitionRuleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_revenue_recognition_rule", [
        organizationId,
        companyId ?? organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create revenue recognition rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useActivateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: bigint }>({
    mutationFn: async ({ ruleId }) => {
      const { urlPath, init } = subscriptionsBffPost("activate_revenue_recognition_rule", [
        organizationId,
        companyId ?? organizationId,
        ruleId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to activate rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useDeactivateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: bigint }>({
    mutationFn: async ({ ruleId }) => {
      const { urlPath, init } = subscriptionsBffPost("deactivate_revenue_recognition_rule", [
        organizationId,
        companyId ?? organizationId,
        ruleId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to deactivate rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', rqBigIntKey(organizationId)] }),
  })
}

export function useImportSubscriptionPlanCsv(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { csvData: string }>({
    mutationFn: async ({ csvData }) => {
      const { urlPath, init } = subscriptionsBffPost("import_subscription_plan_csv", [
        organizationId,
        companyId ?? organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import subscription plans from CSV')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
  })
}

export function useImportSubscriptionCsv(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { csvData: string }>({
    mutationFn: async ({ csvData }) => {
      const { urlPath, init } = subscriptionsBffPost("import_subscription_csv", [
        organizationId,
        companyId ?? organizationId,
        csvData,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to import subscriptions from CSV')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from '@lumiere/stdb/types'
