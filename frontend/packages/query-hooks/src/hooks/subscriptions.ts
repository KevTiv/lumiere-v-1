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
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
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

export function useSubscriptionLines(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-lines', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-lines', 'Failed to fetch subscription lines'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionAmendments(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-amendments', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/subscription-amendments',
        'Failed to fetch subscription amendments',
      ),
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
  return useMutation<void, Error, CreateSubscriptionPlanParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_plan", [
        organizationId,
        stdbParamsToJson(withCompanyScope(params, companyId), "CreateSubscriptionPlanParams"),
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
  return useMutation<void, Error, CreateSubscriptionFromSaleOrderParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_from_sale_order", [
        organizationId,
        stdbParamsToJson(
          withCompanyScope(params, companyId),
          "CreateSubscriptionFromSaleOrderParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create subscription from sale order')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['subscription-lines', rqBigIntKey(organizationId)] }),
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
        stdbParamsToJson(params as object, "CloseSubscriptionParams"),
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
        stdbParamsToJson(params as object, "GenerateSubscriptionInvoiceParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to generate subscription invoice')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['subscription-billing-runs', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-moves', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-move-lines', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

export function usePaySubscriptionInvoice(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("pay_subscription_invoice", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "ApplySubscriptionInvoicePaymentParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to apply subscription invoice payment')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-moves', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-move-lines', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-payments', rqBigIntKey(organizationId)] }),
      ])
    },
  })
}

function invalidateSubscriptionLifecycle(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-lines', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-amendments', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['stdb', 'account-moves', rqBigIntKey(organizationId)] }),
  ])
}

export function useAmendSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("amend_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "AmendSubscriptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to amend subscription')
    },
    onSuccess: async () => {
      await invalidateSubscriptionLifecycle(qc, organizationId)
    },
  })
}

export function usePauseSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params?: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params = {} }) => {
      const { urlPath, init } = subscriptionsBffPost("pause_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "PauseSubscriptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to pause subscription')
    },
    onSuccess: async () => {
      await invalidateSubscriptionLifecycle(qc, organizationId)
    },
  })
}

export function useResumeSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params?: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params = {} }) => {
      const { urlPath, init } = subscriptionsBffPost("resume_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "ResumeSubscriptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to resume subscription')
    },
    onSuccess: async () => {
      await invalidateSubscriptionLifecycle(qc, organizationId)
    },
  })
}

export function useRenewSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("renew_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "RenewSubscriptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to renew subscription')
    },
    onSuccess: async () => {
      await invalidateSubscriptionLifecycle(qc, organizationId)
    },
  })
}

export function useCancelSubscription(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("cancel_subscription", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "CancelSubscriptionParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to cancel subscription')
    },
    onSuccess: async () => {
      await invalidateSubscriptionLifecycle(qc, organizationId)
    },
  })
}

export function useUpdateSubscriptionPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { planId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ planId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("update_subscription_plan", [
        organizationId,
        companyId ?? organizationId,
        planId,
        stdbParamsToJson(params as object, "UpdateSubscriptionPlanParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to update subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
  })
}

export function useDeactivateSubscriptionPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { planId: bigint }>({
    mutationFn: async ({ planId }) => {
      const { urlPath, init } = subscriptionsBffPost("deactivate_subscription_plan", [
        organizationId,
        companyId ?? organizationId,
        planId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to deactivate subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
  })
}

export function useActivateSubscriptionPlan(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { planId: bigint }>({
    mutationFn: async ({ planId }) => {
      const { urlPath, init } = subscriptionsBffPost("activate_subscription_plan", [
        organizationId,
        companyId ?? organizationId,
        planId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to activate subscription plan')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-plans', rqBigIntKey(organizationId)] }),
  })
}

function invalidateUsageQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['subscription-usage-events', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-usage-charges', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-rating-backlog', rqBigIntKey(organizationId)] }),
  ])
}

export function useSubscriptionUsageEvents(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-usage-events', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-usage-events', 'Failed to fetch usage events'),
    staleTime: 15_000,
    initialData,
  })
}

export function useSubscriptionUsageCharges(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-usage-charges', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-usage-charges', 'Failed to fetch usage charges'),
    staleTime: 15_000,
    initialData,
  })
}

export function useSubscriptionRatingBacklog(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-rating-backlog', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-rating-backlog', 'Failed to fetch rating backlog'),
    staleTime: 10_000,
    initialData,
  })
}

export function useSubscriptionPriceTiers(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-price-tiers', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-price-tiers', 'Failed to fetch price tiers'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionCommitments(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-commitments', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-commitments', 'Failed to fetch commitments'),
    staleTime: 30_000,
    initialData,
  })
}

export function useSubscriptionBundles(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-bundles', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-bundles', 'Failed to fetch bundles'),
    staleTime: 30_000,
    initialData,
  })
}

export function useIngestSubscriptionUsageEvent(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("ingest_subscription_usage_event", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "IngestSubscriptionUsageEventParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to ingest usage event')
    },
    onSuccess: async () => {
      await invalidateUsageQueries(qc, organizationId)
    },
  })
}

export function useRateSubscriptionUsageEvents(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params?: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params = {} }) => {
      const { urlPath, init } = subscriptionsBffPost("rate_subscription_usage_events", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(
          {
            limit: Number(params.limit ?? 100),
            fallbackUnitPrice:
              params.fallbackUnitPrice != null && String(params.fallbackUnitPrice) !== ''
                ? Number(params.fallbackUnitPrice)
                : undefined,
          },
          "RateSubscriptionUsageEventsParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to rate usage events')
    },
    onSuccess: async () => {
      await invalidateUsageQueries(qc, organizationId)
    },
  })
}

export function useCreateSubscriptionPriceTier(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_price_tier", [
        organizationId,
        companyId ?? organizationId,
        stdbParamsToJson(params as object, "CreateSubscriptionPriceTierParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create price tier')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-price-tiers', rqBigIntKey(organizationId)] }),
  })
}

export function useSetSubscriptionCommitment(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("set_subscription_commitment", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "SetSubscriptionCommitmentParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to set commitment')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-commitments', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateSubscriptionBundle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_bundle", [
        organizationId,
        companyId ?? organizationId,
        stdbParamsToJson(params as object, "CreateSubscriptionBundleParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create bundle')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['subscription-bundles', rqBigIntKey(organizationId)] }),
  })
}

export function useCreateDeferredRevenueSchedule(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateDeferredRevenueScheduleParams>({
    mutationFn: async (params) => {
      const { urlPath, init } = subscriptionsBffPost("create_deferred_revenue_schedule", [
        organizationId,
        companyId ?? organizationId,
        stdbParamsToJson(params as object, "CreateDeferredRevenueScheduleParams"),
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
        stdbParamsToJson(params as object, "RecognizeDeferredRevenueParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to recognize deferred revenue')
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deferred-revenue-lines', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['deferred-revenue-schedules', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-moves', rqBigIntKey(organizationId)] }),
        qc.invalidateQueries({ queryKey: ['stdb', 'account-move-lines', rqBigIntKey(organizationId)] }),
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
        stdbParamsToJson(params as object, "CreateRevenueRecognitionRuleParams"),
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

export function useSubscriptionCollections(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-collections', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-collections', 'Failed to fetch collections'),
    staleTime: 15_000,
    initialData,
  })
}

export function useSubscriptionEntitlements(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-entitlements', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-entitlements', 'Failed to fetch entitlements'),
    staleTime: 15_000,
    initialData,
  })
}

export function useSubscriptionPastDue(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-past-due', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-past-due', 'Failed to fetch past-due queue'),
    staleTime: 10_000,
    initialData,
  })
}

export function useSubscriptionDueToBill(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-due-to-bill', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList('/api/query/subscription-due-to-bill', 'Failed to fetch due-to-bill queue'),
    staleTime: 10_000,
    initialData,
  })
}

export function useSubscriptionPaymentIntents(organizationId: bigint, initialData?: QueryRows) {
  return useQuery<QueryRows>({
    queryKey: ['subscription-payment-intents', rqBigIntKey(organizationId)],
    queryFn: () =>
      fetchQueryList(
        '/api/query/subscription-payment-intents',
        'Failed to fetch payment intents',
      ),
    staleTime: 15_000,
    initialData,
  })
}

function invalidateCollections(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['subscription-collections', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-past-due', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-due-to-bill', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscription-entitlements', rqBigIntKey(organizationId)] }),
    qc.invalidateQueries({ queryKey: ['subscriptions', rqBigIntKey(organizationId)] }),
  ])
}

export function useAdvanceSubscriptionDunning(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params?: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params = {} }) => {
      const { urlPath, init } = subscriptionsBffPost("advance_subscription_dunning", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(
          {
            pastDueDays:
              params.pastDueDays != null ? Number(params.pastDueDays) : undefined,
            suspendAfterDays:
              params.suspendAfterDays != null ? Number(params.suspendAfterDays) : undefined,
          },
          "AdvanceSubscriptionDunningParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to advance dunning')
    },
    onSuccess: async () => {
      await invalidateCollections(qc, organizationId)
    },
  })
}

export function useRecordSubscriptionPaymentFailure(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params?: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params = {} }) => {
      const { urlPath, init } = subscriptionsBffPost("record_subscription_payment_failure", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(
          {
            invoiceMoveId:
              params.invoiceMoveId != null && String(params.invoiceMoveId) !== ''
                ? BigInt(String(params.invoiceMoveId))
                : undefined,
            reason:
              params.reason != null && String(params.reason).trim() !== ''
                ? String(params.reason)
                : undefined,
            pastDueDays:
              params.pastDueDays != null ? Number(params.pastDueDays) : undefined,
          },
          "RecordSubscriptionPaymentFailureParams",
        ),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to record payment failure')
    },
    onSuccess: async () => {
      await invalidateCollections(qc, organizationId)
    },
  })
}

export function useRefreshSubscriptionExceptionFlags(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint }>({
    mutationFn: async ({ subscriptionId }) => {
      const { urlPath, init } = subscriptionsBffPost("refresh_subscription_exception_flags", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to refresh exception flags')
    },
    onSuccess: async () => {
      await invalidateCollections(qc, organizationId)
    },
  })
}

export function useCreateSubscriptionPaymentIntent(
  organizationId: bigint,
  companyId?: bigint,
) {
  const qc = useQueryClient()
  return useMutation<void, Error, { subscriptionId: bigint; params: Record<string, unknown> }>({
    mutationFn: async ({ subscriptionId, params }) => {
      const { urlPath, init } = subscriptionsBffPost("create_subscription_payment_intent", [
        organizationId,
        companyId ?? organizationId,
        subscriptionId,
        stdbParamsToJson(params as object, "CreateSubscriptionPaymentIntentParams"),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error('Failed to create payment intent')
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['subscription-payment-intents', rqBigIntKey(organizationId)],
      }),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from '@lumiere/stdb/types'
