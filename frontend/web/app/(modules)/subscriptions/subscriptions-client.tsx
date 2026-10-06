"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  ModuleView,
  FormModal,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  newDeferredRevenueScheduleForm,
  newRevenueRecognitionRuleForm,
  closeSubscriptionForm,
  generateSubscriptionInvoiceForm,
  paySubscriptionInvoiceForm,
  amendSubscriptionForm,
  renewSubscriptionForm,
  cancelSubscriptionForm,
  ingestSubscriptionUsageEventForm,
  createSubscriptionPriceTierForm,
  setSubscriptionCommitmentForm,
  recognizeDeferredRevenueLineForm,
  importSubscriptionPlanCsvForm,
  importSubscriptionCsvForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  subscriptionsTableConfig,
  subscriptionLinesTableConfig,
  subscriptionAmendmentsTableConfig,
  subscriptionUsageEventsTableConfig,
  subscriptionUsageChargesTableConfig,
  subscriptionRatingBacklogTableConfig,
  subscriptionPriceTiersTableConfig,
  subscriptionPastDueTableConfig,
  subscriptionDueToBillTableConfig,
  subscriptionEntitlementsTableConfig,
  subscriptionPaymentIntentsTableConfig,
  deferredRevenueLinesTableConfig,
  revenueRecognitionRulesTableConfig,
} from "@lumiere/ui"
import type { EntityAction, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  PlayCircle,
  PauseCircle,
  XCircle,
  FileText,
  ClipboardCheck,
  CheckCircle2,
  CircleSlash,
  RefreshCw,
  Pencil,
  Gauge,
  Activity,
  AlertTriangle,
  Shield,
} from "lucide-react"
import { subscriptionsModuleConfig } from "@/lib/module-dashboard-configs"
import { useSubscriptionsModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useSubscriptions,
  useSubscriptionBillingRuns,
  useSubscriptionPlans,
  useSubscriptionLines,
  useSubscriptionAmendments,
  useSubscriptionUsageEvents,
  useSubscriptionUsageCharges,
  useSubscriptionRatingBacklog,
  useSubscriptionPriceTiers,
  useIngestSubscriptionUsageEvent,
  useRateSubscriptionUsageEvents,
  useCreateSubscriptionPriceTier,
  useSetSubscriptionCommitment,
  useSubscriptionPastDue,
  useSubscriptionDueToBill,
  useSubscriptionEntitlements,
  useSubscriptionPaymentIntents,
  useAdvanceSubscriptionDunning,
  useRecordSubscriptionPaymentFailure,
  useRefreshSubscriptionExceptionFlags,
  useCreateSubscription,
  useCreateSubscriptionPlan,
  useDeferredRevenueSchedules,
  useDeferredRevenueLines,
  useRevenueRecognitionRules,
  useActivateSubscription,
  useCloseSubscription,
  useGenerateSubscriptionInvoice,
  usePaySubscriptionInvoice,
  useAmendSubscription,
  usePauseSubscription,
  useResumeSubscription,
  useRenewSubscription,
  useCancelSubscription,
  useCreateDeferredRevenueSchedule,
  useRecognizeDeferredRevenue,
  useCreateRevenueRecognitionRule,
  useActivateRevenueRecognitionRule,
  useDeactivateRevenueRecognitionRule,
  useImportSubscriptionPlanCsv,
  useImportSubscriptionCsv,
  type Subscription,
  type SubscriptionPlan,
  type DeferredRevenueSchedule,
  type DeferredRevenueLine,
  type RevenueRecognitionRule,
} from "@lumiere/query-hooks/hooks/subscriptions"
import {
  toCreateSubscriptionFromSaleOrderParams,
  toCreateSubscriptionPlanParams,
} from "@/lib/subscriptions-create-params"
import {
  buildCloseSubscriptionParams,
  buildCreateDeferredRevenueScheduleParams,
  buildCreateRevenueRecognitionRuleParams,
  buildGenerateSubscriptionInvoiceParams,
  buildPaySubscriptionInvoiceParams,
  buildAmendSubscriptionParams,
  buildRenewSubscriptionParams,
  buildCancelSubscriptionParams,
  buildIngestSubscriptionUsageEventParams,
  buildCreateSubscriptionPriceTierParams,
  buildSetSubscriptionCommitmentParams,
  buildRecognizeDeferredRevenueParams,
} from "@/lib/subscriptions-revenue-params"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useSaleOrders, usePricelists, type SaleOrder, type ProductPricelist } from "@lumiere/query-hooks/hooks/sales"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { useAccountJournals, useAccountAccounts, useAccountMoves, useAccountMoveLines, useAccountPayments } from "@lumiere/query-hooks/hooks/accounting"
import { subscriptionRecordLinks } from "@lumiere/query-hooks/hooks/cross-record-links"
import { CrossRecordLinks } from "../../../components/order-handoff-links"
import { useModuleTab } from "@/hooks/use-module-tab"
import type { Product } from "@lumiere/stdb/types"
import {
  saleOrderRowsToSelectOptions,
  subscriptionPlanRowsToSelectOptions,
  pricelistRowsToSelectOptions,
  productRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  accountMoveRowsToSelectOptions,
  accountMoveLineRowsToSelectOptions,
  currencyOptionsFromRows,
} from "@/lib/form-lookup"

function subscriptionState(row: unknown): string {
  if (!row || typeof row !== "object" || !("state" in row)) return ""
  const value = row.state
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value && typeof value.tag === "string") return value.tag.toLowerCase()
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

function isSubscriptionActiveForMetrics(row: Record<string, unknown>): boolean {
  const state = subscriptionState(row)
  if (state === "closed") return false
  return state === "active" || state === "open"
}

function isTrialSubscriptionRow(row: Record<string, unknown>): boolean {
  return row.isTrial === true || row.isTrial === 1 || row.is_trial === true || row.is_trial === 1
}

interface SubscriptionsClientProps {
  initialSubscriptions?: Subscription[]
  initialPlans?: SubscriptionPlan[]
  initialDeferredSchedules?: DeferredRevenueSchedule[]
  initialDeferredLines?: DeferredRevenueLine[]
  initialRecognitionRules?: RevenueRecognitionRule[]
  initialSaleOrders?: SaleOrder[]
  initialPricelists?: ProductPricelist[]
  initialProducts?: Product[]
  organizationId?: number
}

type SubscriptionsClientLoadedProps = Omit<SubscriptionsClientProps, "organizationId"> & {
  organizationId: number
}

export function SubscriptionsClient(props: SubscriptionsClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <SubscriptionsClientLoaded {...props} organizationId={props.organizationId} />
}

function SubscriptionsClientLoaded({
  initialSubscriptions,
  initialPlans,
  initialDeferredSchedules,
  initialDeferredLines,
  initialRecognitionRules,
  initialSaleOrders,
  initialPricelists,
  initialProducts,
  organizationId,
}: SubscriptionsClientLoadedProps) {
  useSubscriptionsModuleSubscription()
  const { t } = useTranslation()
  const mutationErrorOptions = {
    onError: (error: Error) =>
      showWorkflowToast({ kind: "error", title: t("common.error.title"), description: error.message }),
  }
  const moduleConfig = useMemo(() => subscriptionsModuleConfig(t), [t])
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    moduleConfig.tabs.map((tab) => tab.id),
  )
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )
  const [closeTargetId, setCloseTargetId] = useState<number | null>(null)
  const [generateTargetId, setGenerateTargetId] = useState<number | null>(null)
  const [payTargetId, setPayTargetId] = useState<number | null>(null)
  const [amendTargetId, setAmendTargetId] = useState<number | null>(null)
  const [renewTargetId, setRenewTargetId] = useState<number | null>(null)
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null)
  const [ingestUsageTargetId, setIngestUsageTargetId] = useState<number | null>(null)
  const [commitmentTargetId, setCommitmentTargetId] = useState<number | null>(null)
  const [recognizeLineId, setRecognizeLineId] = useState<number | null>(null)
  const [recognizeMoveId, setRecognizeMoveId] = useState("")

  const { data: subscriptions = [] } = useSubscriptions(orgId, initialSubscriptions)
  const { data: billingRuns = [], isLoading: billingRunsLoading, isError: billingRunsError } = useSubscriptionBillingRuns(orgId)
  const { data: plans = [] } = useSubscriptionPlans(orgId, initialPlans)
  const { data: subscriptionLines = [] } = useSubscriptionLines(orgId)
  const { data: subscriptionAmendments = [] } = useSubscriptionAmendments(orgId)
  const { data: usageEvents = [] } = useSubscriptionUsageEvents(orgId)
  const { data: usageCharges = [] } = useSubscriptionUsageCharges(orgId)
  const { data: ratingBacklog = [] } = useSubscriptionRatingBacklog(orgId)
  const { data: priceTiers = [] } = useSubscriptionPriceTiers(orgId)
  const { data: pastDue = [] } = useSubscriptionPastDue(orgId)
  const { data: dueToBill = [] } = useSubscriptionDueToBill(orgId)
  const { data: entitlements = [] } = useSubscriptionEntitlements(orgId)
  const { data: paymentIntents = [] } = useSubscriptionPaymentIntents(orgId)
  const { data: deferredSchedules = [] } = useDeferredRevenueSchedules(orgId, initialDeferredSchedules)
  const { data: deferredLines = [] } = useDeferredRevenueLines(orgId, initialDeferredLines)
  const { data: recognitionRules = [] } = useRevenueRecognitionRules(orgId, initialRecognitionRules)
  const { data: saleOrders = [] } = useSaleOrders(orgId, initialSaleOrders)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: journals = [] } = useAccountJournals(orgId)
  const { data: accounts = [] } = useAccountAccounts(orgId)
  const { data: accountMoves = [], isLoading: accountMovesLoading, isError: accountMovesError } = useAccountMoves(orgId)
  const { data: accountPayments = [], isLoading: accountPaymentsLoading, isError: accountPaymentsError } = useAccountPayments(orgId)
  const { data: accountMoveLines = [] } = useAccountMoveLines(orgId)
  const { data: currencies = [] } = useCurrencies()

  const createSubscription = useCreateSubscription(orgId, operatingCompanyId)
  const createPlan = useCreateSubscriptionPlan(orgId, operatingCompanyId)
  const activateSubscription = useActivateSubscription(orgId, operatingCompanyId)
  const closeSubscription = useCloseSubscription(orgId, operatingCompanyId)
  const generateInvoice = useGenerateSubscriptionInvoice(orgId, operatingCompanyId)
  const paySubscriptionInvoice = usePaySubscriptionInvoice(orgId, operatingCompanyId)
  const amendSubscription = useAmendSubscription(orgId, operatingCompanyId)
  const pauseSubscription = usePauseSubscription(orgId, operatingCompanyId)
  const resumeSubscription = useResumeSubscription(orgId, operatingCompanyId)
  const renewSubscription = useRenewSubscription(orgId, operatingCompanyId)
  const cancelSubscription = useCancelSubscription(orgId, operatingCompanyId)
  const ingestUsage = useIngestSubscriptionUsageEvent(orgId, operatingCompanyId)
  const rateUsage = useRateSubscriptionUsageEvents(orgId, operatingCompanyId)
  const createPriceTier = useCreateSubscriptionPriceTier(orgId, operatingCompanyId)
  const setCommitment = useSetSubscriptionCommitment(orgId, operatingCompanyId)
  const advanceDunning = useAdvanceSubscriptionDunning(orgId, operatingCompanyId)
  const recordPaymentFailure = useRecordSubscriptionPaymentFailure(orgId, operatingCompanyId)
  const refreshExceptionFlags = useRefreshSubscriptionExceptionFlags(orgId, operatingCompanyId)
  const createDeferredSchedule = useCreateDeferredRevenueSchedule(orgId, operatingCompanyId)
  const recognizeDeferred = useRecognizeDeferredRevenue(orgId, operatingCompanyId)
  const createRecognitionRule = useCreateRevenueRecognitionRule(orgId, operatingCompanyId)
  const activateRule = useActivateRevenueRecognitionRule(orgId, operatingCompanyId)
  const deactivateRule = useDeactivateRevenueRecognitionRule(orgId, operatingCompanyId)
  const importPlanCsv = useImportSubscriptionPlanCsv(orgId, operatingCompanyId)
  const importSubscriptionCsv = useImportSubscriptionCsv(orgId, operatingCompanyId)

  const isFormMutationPending =
    createSubscription.isPending ||
    createPlan.isPending ||
    activateSubscription.isPending ||
    closeSubscription.isPending ||
    generateInvoice.isPending ||
    paySubscriptionInvoice.isPending ||
    amendSubscription.isPending ||
    pauseSubscription.isPending ||
    resumeSubscription.isPending ||
    renewSubscription.isPending ||
    cancelSubscription.isPending ||
    ingestUsage.isPending ||
    rateUsage.isPending ||
    createPriceTier.isPending ||
    setCommitment.isPending ||
    advanceDunning.isPending ||
    recordPaymentFailure.isPending ||
    refreshExceptionFlags.isPending ||
    createDeferredSchedule.isPending ||
    recognizeDeferred.isPending ||
    createRecognitionRule.isPending ||
    activateRule.isPending ||
    deactivateRule.isPending ||
    importPlanCsv.isPending ||
    importSubscriptionCsv.isPending

  const saleOrderOptions = useMemo(() => {
    const fromApi = saleOrderRowsToSelectOptions(saleOrders)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noSaleOrders"), disabled: true }]
  }, [saleOrders, t])

  const planFieldOptions = useMemo(() => {
    const fromApi = subscriptionPlanRowsToSelectOptions(plans)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noSubscriptionPlans"), disabled: true }]
  }, [plans, t])

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(journals)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [journals, t])

  const productFieldOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noProducts"), disabled: true }]
  }, [products, t])

  const accountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accounts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accounts, t])

  const currencyFieldOptions = useMemo(() => {
    const fromApi = currencyOptionsFromRows(currencies)
    return fromApi.length > 0
      ? fromApi
      : [{ value: "", label: "No currencies available", disabled: true }]
  }, [currencies])

  const recognizeMoveSelectOptions = useMemo(() => {
    const posted = (accountMoves as Record<string, unknown>[]).filter((m) => {
      const state = m.state
      const tag =
        state != null && typeof state === "object" && "tag" in state
          ? String((state as { tag: string }).tag)
          : String(state ?? "")
      return tag === "Posted"
    })
    const fromApi = accountMoveRowsToSelectOptions(posted)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accountMoves, t])

  const recognizeMoveLineSelectOptions = useMemo(() => {
    const lines = accountMoveLines.filter((line) => {
      if (!recognizeMoveId) return true
      return String(line.moveId ?? "") === recognizeMoveId
    })
    const fromApi = accountMoveLineRowsToSelectOptions(lines)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accountMoveLines, recognizeMoveId, t])

  const subscriptionFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSubscriptionForm(t), {
        saleOrderId: saleOrderOptions,
        planId: planFieldOptions,
      }),
    [t, saleOrderOptions, planFieldOptions],
  )

  const planFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSubscriptionPlanForm(t), {
        pricelistId: pricelistFieldOptions,
        journalId: journalFieldOptions,
        productId: productFieldOptions,
      }),
    [t, pricelistFieldOptions, journalFieldOptions, productFieldOptions],
  )

  const deferredScheduleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newDeferredRevenueScheduleForm(t), {
        journalId: journalFieldOptions,
        accountId: accountFieldOptions,
        deferredAccountId: accountFieldOptions,
        currencyId: currencyFieldOptions,
      }),
    [t, journalFieldOptions, accountFieldOptions, currencyFieldOptions],
  )

  const recognitionRuleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newRevenueRecognitionRuleForm(t), {
        recognitionAccountId: accountFieldOptions,
        deferredAccountId: accountFieldOptions,
        expenseAccountId: [{ value: "", label: "—" }, ...accountFieldOptions.filter((o) => o.value !== "")],
      }),
    [t, accountFieldOptions],
  )

  const importPlanCsvFormConfig = useMemo(() => importSubscriptionPlanCsvForm(t), [t])
  const importSubscriptionCsvFormConfig = useMemo(() => importSubscriptionCsvForm(t), [t])

  const subscriptionRowActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "activate-sub",
        label: t("subscriptions.actions.activate"),
        icon: PlayCircle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) === "draft"),
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.activate") }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) !== "draft") return
          await activateSubscription.mutateAsync({ subscriptionId: BigInt(String(r.id)) })
        },
      },
      {
        id: "close-sub",
        label: t("subscriptions.actions.close"),
        icon: XCircle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) !== "closed"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (subscriptionState(r) === "closed") return
          setCloseTargetId(Number(r.id))
        },
      },
      {
        id: "gen-inv",
        label: t("subscriptions.actions.generateInvoice"),
        icon: FileText,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) === "active"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (subscriptionState(r) !== "active") return
          setGenerateTargetId(Number(r.id))
        },
      },
      {
        id: "pay-inv",
        label: t("subscriptions.actions.payInvoice", { defaultValue: "Apply payment" }),
        icon: CheckCircle2,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) === "active"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (subscriptionState(r) !== "active") return
          setPayTargetId(Number(r.id))
        },
      },
      {
        id: "amend-sub",
        label: t("subscriptions.actions.amend", { defaultValue: "Amend" }),
        icon: Pencil,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => ["active", "paused"].includes(subscriptionState(row))),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          const state = subscriptionState(r)
          if (state !== "active" && state !== "paused") return
          setAmendTargetId(Number(r.id))
        },
      },
      {
        id: "pause-sub",
        label: t("subscriptions.actions.pause", { defaultValue: "Pause" }),
        icon: PauseCircle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) === "active"),
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.pause", { defaultValue: "Pause" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) !== "active") return
          await pauseSubscription.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
          })
        },
      },
      {
        id: "resume-sub",
        label: t("subscriptions.actions.resume", { defaultValue: "Resume" }),
        icon: PlayCircle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) === "paused"),
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.resume", { defaultValue: "Resume" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) !== "paused") return
          await resumeSubscription.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
          })
        },
      },
      {
        id: "renew-sub",
        label: t("subscriptions.actions.renew", { defaultValue: "Renew" }),
        icon: RefreshCw,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => ["active", "paused"].includes(subscriptionState(row))),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          const state = subscriptionState(r)
          if (state !== "active" && state !== "paused") return
          setRenewTargetId(Number(r.id))
        },
      },
      {
        id: "cancel-sub",
        label: t("subscriptions.actions.cancel", { defaultValue: "Cancel + credit" }),
        icon: XCircle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) !== "closed"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) === "closed") return
          setCancelTargetId(Number(r.id))
        },
      },
      {
        id: "ingest-usage",
        label: t("subscriptions.actions.ingestUsage", { defaultValue: "Ingest usage" }),
        icon: Activity,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) !== "closed"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) === "closed") return
          setIngestUsageTargetId(Number(r.id))
        },
      },
      {
        id: "rate-usage",
        label: t("subscriptions.actions.rateUsage", { defaultValue: "Rate usage" }),
        icon: Gauge,
        variant: "outline",
        requiresSelection: true,
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.rateUsage", { defaultValue: "Rate usage" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await rateUsage.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
            params: { limit: 100 },
          })
        },
      },
      {
        id: "set-commitment",
        label: t("subscriptions.actions.setCommitment", { defaultValue: "Set commitment" }),
        icon: CheckCircle2,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) !== "closed"),
        onClick: (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) === "closed") return
          setCommitmentTargetId(Number(r.id))
        },
      },
      {
        id: "record-failure",
        label: t("subscriptions.actions.recordFailure", { defaultValue: "Record payment fail" }),
        icon: AlertTriangle,
        variant: "outline",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => subscriptionState(row) !== "closed"),
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.recordFailure", { defaultValue: "Record payment fail" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r || subscriptionState(r) === "closed") return
          await recordPaymentFailure.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
            params: { reason: "manual", pastDueDays: 1 },
          })
        },
      },
      {
        id: "advance-dunning",
        label: t("subscriptions.actions.advanceDunning", { defaultValue: "Advance dunning" }),
        icon: Shield,
        variant: "outline",
        requiresSelection: true,
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.advanceDunning", { defaultValue: "Advance dunning" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await advanceDunning.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
            params: {},
          })
        },
      },
      {
        id: "refresh-flags",
        label: t("subscriptions.actions.refreshFlags", { defaultValue: "Refresh exception flags" }),
        icon: RefreshCw,
        variant: "outline",
        requiresSelection: true,
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.refreshFlags", { defaultValue: "Refresh exception flags" }) }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await refreshExceptionFlags.mutateAsync({
            subscriptionId: BigInt(String(r.id)),
          })
        },
      },
    ]
  }, [
    t,
    activateSubscription,
    pauseSubscription,
    resumeSubscription,
    rateUsage,
    recordPaymentFailure,
    advanceDunning,
    refreshExceptionFlags,
  ])

  const deferredLineActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "recognize-line",
        label: t("subscriptions.actions.recognizeLine"),
        icon: ClipboardCheck,
        variant: "default",
        requiresSelection: true,
        isApplicable: (rows) => rows.every((row) => !(row.recognized === true || row.recognized === 1)),
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (r.recognized === true || r.recognized === 1) return
          setRecognizeLineId(Number(r.id))
        },
      },
    ]
  }, [t])

  const recognitionRuleActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "activate-rule",
        label: t("subscriptions.actions.activateRule"),
        icon: CheckCircle2,
        variant: "outline",
        requiresSelection: true,
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.activateRule") }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await activateRule.mutateAsync({ ruleId: BigInt(String(r.id)) })
        },
      },
      {
        id: "deactivate-rule",
        label: t("subscriptions.actions.deactivateRule"),
        icon: CircleSlash,
        variant: "outline",
        requiresSelection: true,
        successMessage: t("common.actionCompleted", { action: t("subscriptions.actions.deactivateRule") }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await deactivateRule.mutateAsync({ ruleId: BigInt(String(r.id)) })
        },
      },
    ]
  }, [t, activateRule, deactivateRule])

  const liveSections = useMemo(() => {
    const rows = subscriptions as Record<string, unknown>[]
    const activeRows = rows.filter(isSubscriptionActiveForMetrics)
    const active = activeRows.length
    const trials = rows.filter(isTrialSubscriptionRow).length
    // Prefer server-derived local MRR (FX snapshot); fall back to contract MRR / monthly.
    const mrr = activeRows.reduce((sum, s) => {
      const local = Number(s.recurringMrrLocal ?? s.recurring_mrr_local ?? 0)
      if (local > 0) return sum + local
      const contract = Number(s.recurringMrr ?? s.recurring_mrr ?? 0)
      if (contract > 0) return sum + contract
      return sum + Number(s.recurringMonthly ?? s.recurring_monthly ?? 0)
    }, 0)
    const deferredRemaining = (deferredSchedules as Record<string, unknown>[]).reduce(
      (sum, s) => sum + Number(s.deferredAmount ?? s.deferred_amount ?? 0),
      0,
    )
    const invoicedUntaxed = (accountMoves as Record<string, unknown>[])
      .filter((m) => {
        const origin = String(m.invoiceOrigin ?? m.invoice_origin ?? "")
        return origin.startsWith("SUB")
      })
      .reduce((sum, m) => sum + Number(m.amountUntaxed ?? m.amount_untaxed ?? 0), 0)

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Active", value: String(active), icon: "CheckCircle" },
                { label: "MRR (local)", value: `$${mrr.toLocaleString()}`, icon: "TrendingUp" },
                {
                  label: "Invoiced untaxed",
                  value: `$${invoicedUntaxed.toLocaleString()}`,
                  icon: "FileText",
                },
                {
                  label: "Deferred remaining",
                  value: `$${deferredRemaining.toLocaleString()}`,
                  icon: "Clock",
                },
                { label: "Trials", value: String(trials), icon: "Package" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_subscription: () =>
              setQuickActionForm({ form: subscriptionFormConfig, action: "createSubscription" }),
            new_plan: () => setQuickActionForm({ form: planFormConfig, action: "createPlan" }),
            import_plan_csv: () =>
              setQuickActionForm({ form: importPlanCsvFormConfig, action: "importPlanCsv" }),
            import_subscription_csv: () =>
              setQuickActionForm({ form: importSubscriptionCsvFormConfig, action: "importSubscriptionCsv" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
          })
  }, [
    subscriptions,
    plans,
    deferredSchedules,
    accountMoves,
    moduleConfig,
    subscriptionFormConfig,
    planFormConfig,
    importPlanCsvFormConfig,
    importSubscriptionCsvFormConfig,
  ])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
          if (tab.id === "subscriptions")
            return {
              ...tab,
              createForm: subscriptionFormConfig,
              entityConfig: subscriptionsTableConfig(t, subscriptionRowActions),
              recordSheet: {
                titleKey: "code",
                statusKey: "state",
                auditTableName: "subscription",
                discussion: {},
                openHref: (record) => (record.id == null ? undefined : `/subscriptions/${String(record.id)}`),
                detailConfig: { mode: "detail", sections: [{ id: "subscription", fields: [
                  { key: "code", label: t("subscriptions.subscriptions.columns.code") },
                  { key: "description", label: t("subscriptions.subscriptions.columns.description") },
                ] }] },
                customTabs: [{
                  id: "handoffs",
                  label: "Billing run invoices & reconciled payments",
                  content: (record) => billingRunsLoading || accountMovesLoading
                    ? <p>Loading linked records…</p>
                    : <CrossRecordLinks testIdPrefix="subscription-handoff"
                        result={billingRunsError || accountMovesError
                          ? { status: "unavailable", links: [], reason: "Linked billing records are unavailable" }
                          : subscriptionRecordLinks(record, { organizationId: orgId, companyId: operatingCompanyId },
                              billingRuns, accountMoves,
                              accountPaymentsError || accountPaymentsLoading ? undefined : accountPayments)}
                      />,
                }],
              },
            }
          if (tab.id === "plans") return { ...tab, createForm: planFormConfig }
          if (tab.id === "lines")
            return { ...tab, entityConfig: subscriptionLinesTableConfig(t) }
          if (tab.id === "amendments")
            return { ...tab, entityConfig: subscriptionAmendmentsTableConfig(t) }
          if (tab.id === "usage-events")
            return { ...tab, entityConfig: subscriptionUsageEventsTableConfig(t) }
          if (tab.id === "usage-charges")
            return { ...tab, entityConfig: subscriptionUsageChargesTableConfig(t) }
          if (tab.id === "rating-backlog")
            return { ...tab, entityConfig: subscriptionRatingBacklogTableConfig(t) }
          if (tab.id === "price-tiers")
            return {
              ...tab,
              createForm: mergeSelectOptionsForFields(createSubscriptionPriceTierForm(t), {
                planId: subscriptionPlanRowsToSelectOptions(
                  plans as Record<string, unknown>[],
                ),
              }),
              entityConfig: subscriptionPriceTiersTableConfig(t),
            }
          if (tab.id === "past-due")
            return { ...tab, entityConfig: subscriptionPastDueTableConfig(t) }
          if (tab.id === "due-to-bill")
            return { ...tab, entityConfig: subscriptionDueToBillTableConfig(t) }
          if (tab.id === "entitlements")
            return { ...tab, entityConfig: subscriptionEntitlementsTableConfig(t) }
          if (tab.id === "payment-intents")
            return { ...tab, entityConfig: subscriptionPaymentIntentsTableConfig(t) }
          if (tab.id === "deferred-schedules") return { ...tab, createForm: deferredScheduleFormConfig }
          if (tab.id === "deferred-lines")
            return {
              ...tab,
              entityConfig: deferredRevenueLinesTableConfig(t, deferredLineActions),
            }
          if (tab.id === "recognition-rules")
            return {
              ...tab,
              createForm: recognitionRuleFormConfig,
              entityConfig: revenueRecognitionRulesTableConfig(t, recognitionRuleActions),
            }
          return tab
        }),
      }) as ModuleConfig,
    [
      liveSections,
      moduleConfig,
      subscriptionFormConfig,
      planFormConfig,
      deferredScheduleFormConfig,
      recognitionRuleFormConfig,
      t,
      subscriptionRowActions,
      deferredLineActions,
      recognitionRuleActions,
      plans,
      orgId,
      operatingCompanyId,
      billingRuns,
      billingRunsLoading,
      billingRunsError,
      accountMoves,
      accountMovesLoading,
      accountMovesError,
      accountPayments,
      accountPaymentsLoading,
      accountPaymentsError,
    ],
  )

  const data = useMemo(
    () => ({
      subscriptions: subscriptions as unknown as Record<string, unknown>[],
      plans: plans as unknown as Record<string, unknown>[],
      lines: subscriptionLines as unknown as Record<string, unknown>[],
      amendments: subscriptionAmendments as unknown as Record<string, unknown>[],
      "usage-events": usageEvents as unknown as Record<string, unknown>[],
      "usage-charges": usageCharges as unknown as Record<string, unknown>[],
      "rating-backlog": ratingBacklog as unknown as Record<string, unknown>[],
      "price-tiers": priceTiers as unknown as Record<string, unknown>[],
      "past-due": pastDue as unknown as Record<string, unknown>[],
      "due-to-bill": dueToBill as unknown as Record<string, unknown>[],
      entitlements: entitlements as unknown as Record<string, unknown>[],
      "payment-intents": paymentIntents as unknown as Record<string, unknown>[],
      "deferred-schedules": deferredSchedules as unknown as Record<string, unknown>[],
      "deferred-lines": deferredLines as unknown as Record<string, unknown>[],
      "recognition-rules": recognitionRules as unknown as Record<string, unknown>[],
    }),
    [
      subscriptions,
      plans,
      subscriptionLines,
      subscriptionAmendments,
      usageEvents,
      usageCharges,
      ratingBacklog,
      priceTiers,
      pastDue,
      dueToBill,
      entitlements,
      paymentIntents,
      deferredSchedules,
      deferredLines,
      recognitionRules,
    ],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createSubscription") {
      const params = toCreateSubscriptionFromSaleOrderParams(formData, saleOrders, orgId)
      if (!params) return
      createSubscription.mutate(params, mutationErrorOptions)
    } else if (action === "createPlan") {
      const params = toCreateSubscriptionPlanParams(formData, pricelists, orgId)
      if (!params) return
      createPlan.mutate(params, mutationErrorOptions)
    } else if (action === "createPriceTier") {
      const params = buildCreateSubscriptionPriceTierParams(formData)
      createPriceTier.mutate(params, mutationErrorOptions)
    } else if (action === "createDeferredSchedule") {
      const params = buildCreateDeferredRevenueScheduleParams(formData)
      createDeferredSchedule.mutate(params, mutationErrorOptions)
    } else if (action === "createRecognitionRule") {
      const raw = { ...formData }
      if (raw.expenseAccountId != null && String(raw.expenseAccountId).trim() !== "") {
        raw.expenseAccountId = raw.expenseAccountId
      } else {
        delete raw.expenseAccountId
      }
      const params = buildCreateRevenueRecognitionRuleParams(raw)
      createRecognitionRule.mutate(params, mutationErrorOptions)
    } else if (action === "importPlanCsv") {
      const raw = formData.csvData
      if (raw == null || String(raw).trim() === "") return
      importPlanCsv.mutate({ csvData: String(raw) }, mutationErrorOptions)
    } else if (action === "importSubscriptionCsv") {
      const raw = formData.csvData
      if (raw == null || String(raw).trim() === "") return
      importSubscriptionCsv.mutate({ csvData: String(raw) }, mutationErrorOptions)
    }
  }

  const closeForm = useMemo(() => closeSubscriptionForm(t), [t])
  const generateForm = useMemo(
    () =>
      mergeSelectOptionsForFields(generateSubscriptionInvoiceForm(t), {
        journalId: journalFieldOptions,
        incomeAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
        taxAccountId: [{ value: "", label: "—" }, ...accountFieldOptions.filter((o) => o.value !== "")],
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )
  const payInvoiceMoveOptions = useMemo(() => {
    if (payTargetId == null) return [{ value: "", label: "—", disabled: true }]
    const ids = new Set(
      (billingRuns as Record<string, unknown>[])
        .filter(
          (run) =>
            Number(run.subscriptionId ?? run.subscription_id) === payTargetId,
        )
        .map((run) => run.invoiceMoveId ?? run.invoice_move_id)
        .filter((id) => id != null)
        .map(String),
    )
    const moves = (accountMoves as Record<string, unknown>[]).filter((move) =>
      ids.has(String(move.id)),
    )
    const fromApi = accountMoveRowsToSelectOptions(moves)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [payTargetId, billingRuns, accountMoves, t])
  const payForm = useMemo(
    () =>
      mergeSelectOptionsForFields(paySubscriptionInvoiceForm(t), {
        invoiceMoveId: payInvoiceMoveOptions,
        paymentJournalId: journalFieldOptions,
        bankAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
        cogsAccountId: accountFieldOptions,
        inventoryAccountId: accountFieldOptions,
      }),
    [t, payInvoiceMoveOptions, journalFieldOptions, accountFieldOptions],
  )
  const amendLineOptions = useMemo(() => {
    if (amendTargetId == null) return [{ value: "", label: "—", disabled: true }]
    const lines = (subscriptionLines as Record<string, unknown>[]).filter(
      (l) => Number(l.subscriptionId ?? l.subscription_id) === amendTargetId,
    )
    if (lines.length === 0) return [{ value: "", label: "No lines", disabled: true }]
    return lines.map((l) => ({
      value: String(l.id),
      label: `${l.name ?? "Line"} (#${l.id})`,
    }))
  }, [amendTargetId, subscriptionLines])
  const amendForm = useMemo(
    () =>
      mergeSelectOptionsForFields(amendSubscriptionForm(t), {
        lineId: amendLineOptions,
        journalId: journalFieldOptions,
        incomeAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
      }),
    [t, amendLineOptions, journalFieldOptions, accountFieldOptions],
  )
  const renewForm = useMemo(() => renewSubscriptionForm(t), [t])
  const cancelInvoiceOptions = useMemo(() => {
    if (cancelTargetId == null) return [{ value: "", label: "—" }]
    const sub = (subscriptions as Record<string, unknown>[]).find(
      (s) => Number(s.id) === cancelTargetId,
    )
    const ids = (sub?.invoiceIds ?? sub?.invoice_ids ?? []) as unknown[]
    const idSet = new Set(ids.map((id) => String(id)))
    const moves = (accountMoves as Record<string, unknown>[]).filter((m) =>
      idSet.has(String(m.id)),
    )
    const fromApi = accountMoveRowsToSelectOptions(moves)
    return [{ value: "", label: "—" }, ...fromApi.filter((o) => o.value !== "")]
  }, [cancelTargetId, subscriptions, accountMoves])
  const cancelForm = useMemo(
    () =>
      mergeSelectOptionsForFields(cancelSubscriptionForm(t), {
        invoiceMoveId: cancelInvoiceOptions,
      }),
    [t, cancelInvoiceOptions],
  )
  const recognizeForm = useMemo(
    () =>
      mergeSelectOptionsForFields(recognizeDeferredRevenueLineForm(t), {
        moveId: recognizeMoveSelectOptions,
        moveLineId: recognizeMoveLineSelectOptions,
      }),
    [t, recognizeMoveSelectOptions, recognizeMoveLineSelectOptions],
  )

  return (
    <>
      <ModuleView config={config} data={data} activeTab={activeTab} onActiveTabChange={setActiveTab} onFormSubmit={handleFormSubmit} isPending={isFormMutationPending} />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? subscriptionFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <FormModal
        open={closeTargetId !== null}
        onOpenChange={(open) => !open && setCloseTargetId(null)}
        config={closeForm}
        onSubmit={(formData) => {
          if (closeTargetId == null) return
          const params = buildCloseSubscriptionParams(formData)
          closeSubscription.mutate({
            subscriptionId: BigInt(closeTargetId),
            params,
          }, mutationErrorOptions)
          setCloseTargetId(null)
        }}
      />
      <FormModal
        open={generateTargetId !== null}
        onOpenChange={(open) => !open && setGenerateTargetId(null)}
        config={generateForm}
        onSubmit={(formData) => {
          if (generateTargetId == null) return
          if (!formData.incomeAccountId || !formData.receivableAccountId) return
          const params = buildGenerateSubscriptionInvoiceParams(formData)
          generateInvoice.mutate({
            subscriptionId: BigInt(generateTargetId),
            params,
          }, mutationErrorOptions)
          setGenerateTargetId(null)
        }}
      />
      <FormModal
        open={payTargetId !== null}
        onOpenChange={(open) => !open && setPayTargetId(null)}
        config={payForm}
        onSubmit={(formData) => {
          if (payTargetId == null) return
          if (
            !formData.invoiceMoveId ||
            !formData.paymentJournalId ||
            !formData.bankAccountId ||
            !formData.receivableAccountId
          ) {
            return
          }
          const params = buildPaySubscriptionInvoiceParams(formData)
          paySubscriptionInvoice.mutate({
            subscriptionId: BigInt(payTargetId),
            params,
          }, mutationErrorOptions)
          setPayTargetId(null)
        }}
      />
      <FormModal
        open={amendTargetId !== null}
        onOpenChange={(open) => !open && setAmendTargetId(null)}
        config={amendForm}
        onSubmit={(formData) => {
          if (amendTargetId == null || !formData.lineId) return
          const params = buildAmendSubscriptionParams(formData)
          amendSubscription.mutate({
            subscriptionId: BigInt(amendTargetId),
            params,
          }, mutationErrorOptions)
          setAmendTargetId(null)
        }}
      />
      <FormModal
        open={renewTargetId !== null}
        onOpenChange={(open) => !open && setRenewTargetId(null)}
        config={renewForm}
        onSubmit={(formData) => {
          if (renewTargetId == null) return
          const params = buildRenewSubscriptionParams(formData)
          renewSubscription.mutate({
            subscriptionId: BigInt(renewTargetId),
            params,
          }, mutationErrorOptions)
          setRenewTargetId(null)
        }}
      />
      <FormModal
        open={cancelTargetId !== null}
        onOpenChange={(open) => !open && setCancelTargetId(null)}
        config={cancelForm}
        onSubmit={(formData) => {
          if (cancelTargetId == null) return
          const params = buildCancelSubscriptionParams(formData)
          cancelSubscription.mutate({
            subscriptionId: BigInt(cancelTargetId),
            params,
          }, mutationErrorOptions)
          setCancelTargetId(null)
        }}
      />
      <FormModal
        open={ingestUsageTargetId !== null}
        onOpenChange={(open) => !open && setIngestUsageTargetId(null)}
        config={ingestSubscriptionUsageEventForm(t)}
        onSubmit={(formData) => {
          if (ingestUsageTargetId == null || !formData.eventId) return
          const params = buildIngestSubscriptionUsageEventParams(formData)
          ingestUsage.mutate({
            subscriptionId: BigInt(ingestUsageTargetId),
            params,
          }, mutationErrorOptions)
          setIngestUsageTargetId(null)
        }}
      />
      <FormModal
        open={commitmentTargetId !== null}
        onOpenChange={(open) => !open && setCommitmentTargetId(null)}
        config={setSubscriptionCommitmentForm(t)}
        onSubmit={(formData) => {
          if (commitmentTargetId == null) return
          const params = buildSetSubscriptionCommitmentParams(formData)
          setCommitment.mutate({
            subscriptionId: BigInt(commitmentTargetId),
            params,
          }, mutationErrorOptions)
          setCommitmentTargetId(null)
        }}
      />
      <FormModal
        key={recognizeLineId != null ? `recognize-${recognizeMoveId || "new"}` : "recognize-closed"}
        open={recognizeLineId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecognizeLineId(null)
            setRecognizeMoveId("")
          }
        }}
        config={recognizeForm}
        onValuesChange={(values) => {
          const moveId = String(values.moveId ?? "")
          if (moveId !== recognizeMoveId) setRecognizeMoveId(moveId)
        }}
        onSubmit={(formData) => {
          if (recognizeLineId == null) return
          const moveId = formData.moveId
          const moveLineId = formData.moveLineId
          const params = buildRecognizeDeferredRevenueParams({ moveId, moveLineId })
          recognizeDeferred.mutate({
            lineId: BigInt(recognizeLineId),
            params,
          }, mutationErrorOptions)
          setRecognizeLineId(null)
        }}
      />
    </>
  )
}
