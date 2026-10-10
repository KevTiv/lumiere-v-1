"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { canActivatePlan, canDeactivatePlan } from "./subscription-plan-actions"
import {
  PLAN_BILLING_PERIODS,
  PLAN_PAYMENT_MODES,
  planEditDefaults,
  toBundleCreateParams,
  toPlanUpdateParams,
  type PlanEditFailure,
} from "./subscription-plan-edit"
import {
  ModuleView,
  FormModal,
  useFormDialog,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  newDeferredRevenueScheduleForm,
  newRevenueRecognitionRuleForm,
  createSubscriptionPriceTierForm,
  recognizeDeferredRevenueLineForm,
  importSubscriptionPlanCsvForm,
  importSubscriptionCsvForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  subscriptionsTableConfig,
  subscriptionPlansTableConfig,
  subscriptionsWithBoard,
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
import type { EntityAction, EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
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
  useCreateSubscriptionPriceTier,
  useSubscriptionPastDue,
  useSubscriptionDueToBill,
  useSubscriptionEntitlements,
  useSubscriptionPaymentIntents,
  useCreateSubscription,
  useCreateSubscriptionPlan,
  useActivateSubscriptionPlan,
  useDeactivateSubscriptionPlan,
  useUpdateSubscriptionPlan,
  useCreateSubscriptionBundle,
  useDeferredRevenueSchedules,
  useDeferredRevenueLines,
  useRevenueRecognitionRules,
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
  buildCreateDeferredRevenueScheduleParams,
  buildCreateRevenueRecognitionRuleParams,
  buildCreateSubscriptionPriceTierParams,
  buildRecognizeDeferredRevenueParams,
} from "@/lib/subscriptions-revenue-params"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { isSubscriptionActionApplicable, type SubscriptionActionId } from "./subscription-actions"
import { useSubscriptionActions, type SubscriptionDialogAction } from "./use-subscription-actions"
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
  const subscriptionActions = useSubscriptionActions(orgId, operatingCompanyId)
  const createPriceTier = useCreateSubscriptionPriceTier(orgId, operatingCompanyId)
  const createDeferredSchedule = useCreateDeferredRevenueSchedule(orgId, operatingCompanyId)
  const recognizeDeferred = useRecognizeDeferredRevenue(orgId, operatingCompanyId)
  const createRecognitionRule = useCreateRevenueRecognitionRule(orgId, operatingCompanyId)
  const activateRule = useActivateRevenueRecognitionRule(orgId, operatingCompanyId)
  const deactivateRule = useDeactivateRevenueRecognitionRule(orgId, operatingCompanyId)
  const importPlanCsv = useImportSubscriptionPlanCsv(orgId, operatingCompanyId)
  const activatePlan = useActivateSubscriptionPlan(orgId, operatingCompanyId)
  const deactivatePlan = useDeactivateSubscriptionPlan(orgId, operatingCompanyId)
  const updatePlan = useUpdateSubscriptionPlan(orgId, operatingCompanyId)
  const createBundle = useCreateSubscriptionBundle(orgId, operatingCompanyId)
  const { askForm, formDialog } = useFormDialog()
  const importSubscriptionCsv = useImportSubscriptionCsv(orgId, operatingCompanyId)

  const isFormMutationPending =
    subscriptionActions.pending ||
    createSubscription.isPending ||
    createPlan.isPending ||
    createPriceTier.isPending ||
    createDeferredSchedule.isPending ||
    recognizeDeferred.isPending ||
    createRecognitionRule.isPending ||
    activateRule.isPending ||
    activatePlan.isPending ||
    deactivatePlan.isPending ||
    updatePlan.isPending ||
    createBundle.isPending ||
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
    const gate = (id: SubscriptionActionId) => (rows: Record<string, unknown>[]) =>
      rows.every((row) => isSubscriptionActionApplicable(id, subscriptionState(row)))
    const direct = (
      id: string,
      action: Exclude<SubscriptionActionId, SubscriptionDialogAction>,
      label: string,
      icon: EntityAction["icon"],
      opts: { gated?: boolean; toast?: boolean } = {},
    ): EntityAction => ({
      id,
      label,
      icon,
      variant: "outline",
      requiresSelection: true,
      ...(opts.gated === false ? {} : { isApplicable: gate(action) }),
      ...(opts.toast === false ? {} : { successMessage: t("common.actionCompleted", { action: label }) }),
      onClick: async (rows) => {
        const r = rows[0]
        if (!r || (opts.gated !== false && !isSubscriptionActionApplicable(action, subscriptionState(r)))) return
        await subscriptionActions.runDirect(action, BigInt(String(r.id)))
      },
    })
    const dialog = (
      id: string,
      action: SubscriptionDialogAction,
      label: string,
      icon: EntityAction["icon"],
    ): EntityAction => ({
      id,
      label,
      icon,
      variant: "outline",
      requiresSelection: true,
      isApplicable: gate(action),
      onClick: (rows) => {
        const r = rows[0]
        if (!r || !isSubscriptionActionApplicable(action, subscriptionState(r))) return
        subscriptionActions.openDialog(action, Number(r.id))
      },
    })
    return [
      direct("activate-sub", "activate", t("subscriptions.actions.activate"), PlayCircle, { toast: true }),
      dialog("close-sub", "close", t("subscriptions.actions.close"), XCircle),
      dialog("gen-inv", "generate-invoice", t("subscriptions.actions.generateInvoice"), FileText),
      dialog("pay-inv", "pay-invoice", t("subscriptions.actions.payInvoice", { defaultValue: "Apply payment" }), CheckCircle2),
      dialog("amend-sub", "amend", t("subscriptions.actions.amend", { defaultValue: "Amend" }), Pencil),
      direct("pause-sub", "pause", t("subscriptions.actions.pause", { defaultValue: "Pause" }), PauseCircle),
      direct("resume-sub", "resume", t("subscriptions.actions.resume", { defaultValue: "Resume" }), PlayCircle),
      dialog("renew-sub", "renew", t("subscriptions.actions.renew", { defaultValue: "Renew" }), RefreshCw),
      dialog("cancel-sub", "cancel", t("subscriptions.actions.cancel", { defaultValue: "Cancel + credit" }), XCircle),
      dialog("ingest-usage", "ingest-usage", t("subscriptions.actions.ingestUsage", { defaultValue: "Ingest usage" }), Activity),
      direct("rate-usage", "rate-usage", t("subscriptions.actions.rateUsage", { defaultValue: "Rate usage" }), Gauge, { gated: false }),
      dialog("set-commitment", "set-commitment", t("subscriptions.actions.setCommitment", { defaultValue: "Set commitment" }), CheckCircle2),
      direct("record-failure", "record-failure", t("subscriptions.actions.recordFailure", { defaultValue: "Record payment fail" }), AlertTriangle),
      direct("advance-dunning", "advance-dunning", t("subscriptions.actions.advanceDunning", { defaultValue: "Advance dunning" }), Shield, { gated: false }),
      direct("refresh-flags", "refresh-flags", t("subscriptions.actions.refreshFlags", { defaultValue: "Refresh exception flags" }), RefreshCw, { gated: false }),
    ]
  }, [t, subscriptionActions])

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

  const planEntityConfig = useMemo((): EntityViewConfig => {
    const base = subscriptionPlansTableConfig(t)
    const view = base.view as EntityTableConfig
    const activateLabel = t("subscriptions.plans.actions.activate", { defaultValue: "Activate plan" })
    const deactivateLabel = t("subscriptions.plans.actions.deactivate", { defaultValue: "Deactivate plan" })
    const editLabel = t("subscriptions.plans.actions.edit", { defaultValue: "Edit plan" })
    const bundleLabel = t("subscriptions.plans.actions.newBundle", { defaultValue: "New bundle" })
    const failedTitle = (action: string) => t("subscriptions.plans.actions.failed", { defaultValue: "{{action}} failed", action })
    /** Runs a command and reports success or failure itself, so a cancelled dialog is not a success. */
    const runCommand = async (action: string, work: () => Promise<unknown>) => {
      try {
        await work()
        showWorkflowToast({ kind: "success", title: t("common.actionCompleted", { action }) })
      } catch (error) {
        showWorkflowToast({
          kind: "error",
          title: failedTitle(action),
          description: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const planEditProblem = (reason: PlanEditFailure): string => {
      switch (reason) {
        case "name":
          return t("subscriptions.plans.edit.invalidName", { defaultValue: "Enter a plan name." })
        case "code":
          return t("subscriptions.plans.edit.invalidCode", { defaultValue: "A plan code cannot be blank." })
        case "billingPeriod":
          return t("subscriptions.plans.edit.invalidBillingPeriod", { defaultValue: "Choose a billing period: day, week, month or year." })
        case "billingPeriodUnit":
          return t("subscriptions.plans.edit.invalidBillingPeriodUnit", { defaultValue: "The billing interval must be a whole number of at least 1." })
        case "recurringInvoiceDay":
          return t("subscriptions.plans.edit.invalidInvoiceDay", { defaultValue: "The invoice day must be a whole number from 1 to 28." })
        case "paymentMode":
          return t("subscriptions.plans.edit.invalidPaymentMode", { defaultValue: "Choose a payment mode: draft invoice or automated payment." })
        case "trialDuration":
          return t("subscriptions.plans.edit.invalidTrialDuration", { defaultValue: "The trial duration must be a whole number of 0 or more." })
        case "unchanged":
          return t("subscriptions.plans.edit.unchanged", { defaultValue: "Nothing to change." })
      }
    }
    const promptEdit = async (plan: Record<string, unknown>) => {
      const current = planEditDefaults(plan)
      const values = await askForm({
        title: editLabel,
        fields: [
          { id: "name", name: "name", label: t("subscriptions.plans.columns.name"), type: "text", required: true, defaultValue: current.name, width: "1/2" },
          { id: "code", name: "code", label: t("subscriptions.plans.columns.code"), type: "text", defaultValue: current.code, width: "1/2" },
          { id: "description", name: "description", label: t("subscriptions.plans.edit.description", { defaultValue: "Description" }), type: "textarea", defaultValue: current.description },
          {
            id: "billingPeriod",
            name: "billingPeriod",
            label: t("subscriptions.plans.columns.billingPeriod"),
            type: "select",
            required: true,
            defaultValue: current.billingPeriod,
            width: "1/2",
            options: PLAN_BILLING_PERIODS.map((value) => ({
              value,
              label: t(`subscriptions.plans.edit.billingPeriods.${value}`, { defaultValue: value.charAt(0).toUpperCase() + value.slice(1) }),
            })),
          },
          { id: "billingPeriodUnit", name: "billingPeriodUnit", label: t("subscriptions.plans.columns.billingPeriodUnit"), type: "number", required: true, min: 1, step: 1, defaultValue: current.billingPeriodUnit, width: "1/2" },
          { id: "recurringInvoiceDay", name: "recurringInvoiceDay", label: t("subscriptions.plans.edit.recurringInvoiceDay", { defaultValue: "Invoice day (1-28)" }), type: "number", required: true, min: 1, max: 28, step: 1, defaultValue: current.recurringInvoiceDay, width: "1/2" },
          {
            id: "paymentMode",
            name: "paymentMode",
            label: t("subscriptions.plans.edit.paymentMode", { defaultValue: "Payment mode" }),
            type: "select",
            required: true,
            defaultValue: current.paymentMode,
            width: "1/2",
            options: PLAN_PAYMENT_MODES.map((value) => ({
              value,
              label: t(`subscriptions.plans.edit.paymentModes.${value}`, {
                defaultValue: value === "draft_invoice" ? "Draft invoice" : "Automated payment",
              }),
            })),
          },
          { id: "trialPeriod", name: "trialPeriod", label: t("subscriptions.plans.columns.trialPeriod"), type: "switch", defaultValue: current.trialPeriod, width: "1/2" },
          { id: "trialDuration", name: "trialDuration", label: t("subscriptions.plans.columns.trialDuration"), type: "number", min: 0, step: 1, defaultValue: current.trialDuration, width: "1/2" },
          { id: "isPublished", name: "isPublished", label: t("subscriptions.plans.edit.isPublished", { defaultValue: "Published" }), type: "switch", defaultValue: current.isPublished, width: "1/2" },
          { id: "isDefault", name: "isDefault", label: t("subscriptions.plans.columns.isDefault"), type: "switch", defaultValue: current.isDefault, width: "1/2" },
        ],
      })
      if (values == null) return
      const result = toPlanUpdateParams(values, plan)
      if (!result.ok) {
        showWorkflowToast({
          kind: result.reason === "unchanged" ? "info" : "error",
          title: result.reason === "unchanged" ? planEditProblem(result.reason) : failedTitle(editLabel),
          description: result.reason === "unchanged" ? undefined : planEditProblem(result.reason),
        })
        return
      }
      await runCommand(editLabel, () => updatePlan.mutateAsync({ planId: BigInt(String(plan.id)), params: result.params }))
    }
    const promptNewBundle = async (selected: Record<string, unknown> | undefined) => {
      const planOptions = subscriptionPlanRowsToSelectOptions(plans as unknown as Record<string, unknown>[])
      const values = await askForm({
        title: bundleLabel,
        fields: [
          { id: "planId", name: "planId", label: t("subscriptions.plans.bundle.plan", { defaultValue: "Plan" }), type: "select", required: true, searchable: true, defaultValue: selected?.id != null ? String(selected.id) : "", options: planOptions },
          { id: "name", name: "name", label: t("subscriptions.plans.columns.name"), type: "text", required: true, width: "1/2" },
          { id: "code", name: "code", label: t("subscriptions.plans.columns.code"), type: "text", required: true, width: "1/2" },
          { id: "active", name: "active", label: t("subscriptions.plans.columns.active"), type: "switch", defaultValue: true },
        ],
      })
      if (values == null) return
      const params = toBundleCreateParams(values, plans as unknown as Record<string, unknown>[])
      if (params == null) {
        showWorkflowToast({
          kind: "error",
          title: failedTitle(bundleLabel),
          description: t("subscriptions.plans.bundle.invalid", { defaultValue: "Choose a plan and enter a name and a code." }),
        })
        return
      }
      await runCommand(bundleLabel, () => createBundle.mutateAsync(params))
    }
    const actions: EntityAction[] = [
      {
        id: "edit-plan",
        label: editLabel,
        variant: "outline",
        requiresSelection: true,
        permission: { resource: "subscription_plan", action: "write" },
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          return promptEdit(r)
        },
      },
      {
        id: "new-bundle",
        label: bundleLabel,
        variant: "outline",
        // The reducer checks subscription:write, not the plan resource.
        permission: { resource: "subscription", action: "write" },
        onClick: (rows) => promptNewBundle(rows[0]),
      },
      {
        id: "activate-plan",
        label: activateLabel,
        icon: CheckCircle2,
        variant: "outline",
        requiresSelection: true,
        permission: { resource: "subscription_plan", action: "write" },
        isApplicable: (rows) => rows.every((r) => canActivatePlan(r)),
        successMessage: t("common.actionCompleted", { action: activateLabel }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await activatePlan.mutateAsync({ planId: BigInt(String(r.id)) })
        },
      },
      {
        id: "deactivate-plan",
        label: deactivateLabel,
        icon: CircleSlash,
        variant: "outline",
        requiresSelection: true,
        permission: { resource: "subscription_plan", action: "write" },
        isApplicable: (rows) => rows.every((r) => canDeactivatePlan(r)),
        confirm: {
          title: deactivateLabel,
          description: t("subscriptions.plans.actions.deactivateConfirm", {
            defaultValue: "Deactivating a plan also unpublishes it, so it can no longer be chosen for new subscriptions.",
          }),
          confirmLabel: deactivateLabel,
          cancelLabel: t("common.cancel", { defaultValue: "Cancel" }),
        },
        successMessage: t("common.actionCompleted", { action: deactivateLabel }),
        onClick: async (rows) => {
          const r = rows[0]
          if (!r) return
          await deactivatePlan.mutateAsync({ planId: BigInt(String(r.id)) })
        },
      },
    ]
    return { ...base, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [t, activatePlan, deactivatePlan, updatePlan, createBundle, askForm, plans])

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
              entityConfig: subscriptionsWithBoard(t, subscriptionsTableConfig(t, subscriptionRowActions)),
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
          if (tab.id === "plans") return { ...tab, createForm: planFormConfig, entityConfig: planEntityConfig }
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
      planEntityConfig,
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
      {subscriptionActions.dialogs}
      {formDialog}
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
