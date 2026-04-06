"use client"

/**
 * Subscriptions hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Subscriptions module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiFetch, fetchQueryList, type QueryRows } from "../http"
import { withCompanyScope } from "@lumiere/erp-shared/org-scoped"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useSubscriptions(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscriptions', organizationId.toString()],
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
    queryKey: ['subscription-plans', organizationId.toString()],
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
    queryKey: ['deferred-revenue-schedules', organizationId.toString()],
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
    queryKey: ['deferred-revenue-lines', organizationId.toString()],
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
    queryKey: ['revenue-recognition-rules', organizationId.toString()],
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
      const r = await apiFetch('/api/call/create_subscription_plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', organizationId.toString()] }),
  })
}

export function useCreateSubscriptionFromSaleOrder(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_subscription_from_sale_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), withCompanyScope(params, companyId)]),
      })
      if (!r.ok) throw new Error('Failed to create subscription from sale order')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['subscription-plans', organizationId.toString()] }),
      ])
    },
  })
}

export function useCreateSubscription(organizationId: bigint, companyId?: bigint) {
  return useCreateSubscriptionFromSaleOrder(organizationId, companyId)
}

function orgStr(organizationId: bigint): string {
  return organizationId.toString()
}

function companyStr(companyId: bigint | undefined, organizationId: bigint): string {
  return (companyId ?? organizationId).toString()
}

export function useActivateSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint }>({
    mutationFn: async ({ subscriptionId }) => {
      const r = await apiFetch('/api/call/activate_subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          subscriptionId.toString(),
        ]),
      })
      if (!r.ok) throw new Error('Failed to activate subscription')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
  })
}

export function useCloseSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const r = await apiFetch('/api/call/close_subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          subscriptionId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to close subscription')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
  })
}

export function useGenerateSubscriptionInvoice(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const r = await apiFetch('/api/call/generate_subscription_invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          subscriptionId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to generate subscription invoice')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
  })
}

export function useCreateDeferredRevenueSchedule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_deferred_revenue_schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create deferred revenue schedule')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', organizationId.toString()] }),
      ])
    },
  })
}

export function useRecognizeDeferredRevenue(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { lineId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ lineId, params }) => {
      const r = await apiFetch('/api/call/recognize_deferred_revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          lineId.toString(),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to recognize deferred revenue')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', organizationId.toString()] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', organizationId.toString()] }),
      ])
    },
  })
}

export function useCreateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await apiFetch('/api/call/create_revenue_recognition_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          params,
        ]),
      })
      if (!r.ok) throw new Error('Failed to create revenue recognition rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', organizationId.toString()] }),
  })
}

export function useActivateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: bigint }>({
    mutationFn: async ({ ruleId }) => {
      const r = await apiFetch('/api/call/activate_revenue_recognition_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          ruleId.toString(),
        ]),
      })
      if (!r.ok) throw new Error('Failed to activate rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', organizationId.toString()] }),
  })
}

export function useDeactivateRevenueRecognitionRule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { ruleId: bigint }>({
    mutationFn: async ({ ruleId }) => {
      const r = await apiFetch('/api/call/deactivate_revenue_recognition_rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          ruleId.toString(),
        ]),
      })
      if (!r.ok) throw new Error('Failed to deactivate rule')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['revenue-recognition-rules', organizationId.toString()] }),
  })
}

export function useImportSubscriptionPlanCsv(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { csvData: string }>({
    mutationFn: async ({ csvData }) => {
      const r = await apiFetch('/api/call/import_subscription_plan_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          csvData,
        ]),
      })
      if (!r.ok) throw new Error('Failed to import subscription plans from CSV')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', organizationId.toString()] }),
  })
}

export function useImportSubscriptionCsv(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { csvData: string }>({
    mutationFn: async ({ csvData }) => {
      const r = await apiFetch('/api/call/import_subscription_csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          orgStr(organizationId),
          companyStr(companyId, organizationId),
          csvData,
        ]),
      })
      if (!r.ok) throw new Error('Failed to import subscriptions from CSV')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscriptions', organizationId.toString()] }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from '@lumiere/stdb/generated/types'
