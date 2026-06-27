"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  newDeferredRevenueScheduleForm,
  newRevenueRecognitionRuleForm,
  closeSubscriptionForm,
  generateSubscriptionInvoiceForm,
  recognizeDeferredRevenueLineForm,
  importSubscriptionPlanCsvForm,
  importSubscriptionCsvForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  subscriptionsTableConfig,
  deferredRevenueLinesTableConfig,
  revenueRecognitionRulesTableConfig,
} from "@lumiere/ui"
import type { EntityAction, FormConfig, ModuleConfig } from "@lumiere/ui"
import { PlayCircle, XCircle, FileText, ClipboardCheck, CheckCircle2, CircleSlash } from "lucide-react"
import { subscriptionsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useSubscriptions,
  useSubscriptionPlans,
  useCreateSubscription,
  useCreateSubscriptionPlan,
  useDeferredRevenueSchedules,
  useDeferredRevenueLines,
  useRevenueRecognitionRules,
  useActivateSubscription,
  useCloseSubscription,
  useGenerateSubscriptionInvoice,
  useCreateDeferredRevenueSchedule,
  useRecognizeDeferredRevenue,
  useCreateRevenueRecognitionRule,
  useActivateRevenueRecognitionRule,
  useDeactivateRevenueRecognitionRule,
  useImportSubscriptionPlanCsv,
  useImportSubscriptionCsv,
} from "@lumiere/query-hooks/hooks/subscriptions"
import type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from "@lumiere/query-hooks/hooks/subscriptions"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useSaleOrders, usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { useAccountJournals, useAccountAccounts } from "@lumiere/query-hooks/hooks/accounting"
import {
  saleOrderRowsToSelectOptions,
  subscriptionPlanRowsToSelectOptions,
  pricelistRowsToSelectOptions,
  productRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  buildCloseSubscriptionParams,
  buildCreateDeferredRevenueScheduleParams,
  buildCreateRevenueRecognitionRuleParams,
  buildGenerateSubscriptionInvoiceParams,
  buildRecognizeDeferredRevenueParams,
} from "@/lib/subscriptions-revenue-params"

function isSubscriptionActiveForMetrics(row: Record<string, unknown>): boolean {
  const state = String(row.state ?? "")
  if (state === "closed") return false
  return state === "active" || state === "open"
}

function isTrialSubscriptionRow(row: Record<string, unknown>): boolean {
  return row.isTrial === true || row.isTrial === 1 || row.is_trial === true || row.is_trial === 1
}

interface SubscriptionsClientProps {
  initialSubscriptions?: Record<string, unknown>[]
  initialPlans?: Record<string, unknown>[]
  initialDeferredSchedules?: Record<string, unknown>[]
  initialDeferredLines?: Record<string, unknown>[]
  initialRecognitionRules?: Record<string, unknown>[]
  initialSaleOrders?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialProducts?: Record<string, unknown>[]
  initialJournals?: Record<string, unknown>[]
  initialAccounts?: Record<string, unknown>[]
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
  initialJournals,
  initialAccounts,
  organizationId,
}: SubscriptionsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => subscriptionsModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(
    null,
  )
  const [closeTargetId, setCloseTargetId] = useState<number | null>(null)
  const [generateTargetId, setGenerateTargetId] = useState<number | null>(null)
  const [recognizeLineId, setRecognizeLineId] = useState<number | null>(null)

  const { data: subscriptions = [] } = useSubscriptions(orgId, initialSubscriptions)
  const { data: plans = [] } = useSubscriptionPlans(orgId, initialPlans)
  const { data: deferredSchedules = [] } = useDeferredRevenueSchedules(orgId, initialDeferredSchedules)
  const { data: deferredLines = [] } = useDeferredRevenueLines(orgId, initialDeferredLines)
  const { data: recognitionRules = [] } = useRevenueRecognitionRules(orgId, initialRecognitionRules)
  const { data: saleOrders = [] } = useSaleOrders(orgId, initialSaleOrders)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: journals = [] } = useAccountJournals(orgId, { initialData: initialJournals })
  const { data: accounts = [] } = useAccountAccounts(orgId, { initialData: initialAccounts })

  const createSubscription = useCreateSubscription(orgId, orgId)
  const createPlan = useCreateSubscriptionPlan(orgId, orgId)
  const activateSubscription = useActivateSubscription(orgId, orgId)
  const closeSubscription = useCloseSubscription(orgId, orgId)
  const generateInvoice = useGenerateSubscriptionInvoice(orgId, orgId)
  const createDeferredSchedule = useCreateDeferredRevenueSchedule(orgId, orgId)
  const recognizeDeferred = useRecognizeDeferredRevenue(orgId, orgId)
  const createRecognitionRule = useCreateRevenueRecognitionRule(orgId, orgId)
  const activateRule = useActivateRevenueRecognitionRule(orgId, orgId)
  const deactivateRule = useDeactivateRevenueRecognitionRule(orgId, orgId)
  const importPlanCsv = useImportSubscriptionPlanCsv(orgId, orgId)
  const importSubscriptionCsv = useImportSubscriptionCsv(orgId, orgId)

  const isFormMutationPending =
    createSubscription.isPending ||
    createPlan.isPending ||
    activateSubscription.isPending ||
    closeSubscription.isPending ||
    generateInvoice.isPending ||
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
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )

  const recognitionRuleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newRevenueRecognitionRuleForm(t), {
        recognitionAccountId: accountFieldOptions,
        deferredAccountId: accountFieldOptions,
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
        onClick: (rows) => {
          const r = rows[0]
          if (!r || String(r.state) !== "draft") return
          void activateSubscription.mutate({ subscriptionId: BigInt(String(r.id)) })
        },
      },
      {
        id: "close-sub",
        label: t("subscriptions.actions.close"),
        icon: XCircle,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (String(r.state) === "closed") return
          setCloseTargetId(Number(r.id))
        },
      },
      {
        id: "gen-inv",
        label: t("subscriptions.actions.generateInvoice"),
        icon: FileText,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          if (String(r.state) !== "active") return
          setGenerateTargetId(Number(r.id))
        },
      },
    ]
  }, [t, activateSubscription])

  const deferredLineActions = useMemo((): EntityAction[] => {
    return [
      {
        id: "recognize-line",
        label: t("subscriptions.actions.recognizeLine"),
        icon: ClipboardCheck,
        variant: "default",
        requiresSelection: true,
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
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          void activateRule.mutate({ ruleId: BigInt(String(r.id)) })
        },
      },
      {
        id: "deactivate-rule",
        label: t("subscriptions.actions.deactivateRule"),
        icon: CircleSlash,
        variant: "outline",
        requiresSelection: true,
        onClick: (rows) => {
          const r = rows[0]
          if (!r) return
          void deactivateRule.mutate({ ruleId: BigInt(String(r.id)) })
        },
      },
    ]
  }, [t, activateRule, deactivateRule])

  const liveSections = useMemo(() => {
    const rows = subscriptions as Record<string, unknown>[]
    const active = rows.filter(isSubscriptionActiveForMetrics).length
    const trials = rows.filter(isTrialSubscriptionRow).length
    const mrr = rows
      .filter(isSubscriptionActiveForMetrics)
      .reduce((sum, s) => sum + Number(s.recurringMonthly ?? 0), 0)

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Total Subscriptions", value: String(subscriptions.length), icon: "RefreshCw" },
                { label: "Active", value: String(active), icon: "CheckCircle" },
                { label: "MRR", value: `$${mrr.toLocaleString()}`, icon: "TrendingUp" },
                { label: "Trials", value: String(trials), icon: "Clock" },
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
      }),
    }))
  }, [
    subscriptions,
    plans,
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
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "subscriptions")
            return {
              ...tab,
              createForm: subscriptionFormConfig,
              entityConfig: subscriptionsTableConfig(t, subscriptionRowActions),
            }
          if (tab.id === "plans") return { ...tab, createForm: planFormConfig }
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
    ],
  )

  const data = useMemo(
    () => ({
      subscriptions: subscriptions as unknown as Record<string, unknown>[],
      plans: plans as unknown as Record<string, unknown>[],
      "deferred-schedules": deferredSchedules as unknown as Record<string, unknown>[],
      "deferred-lines": deferredLines as unknown as Record<string, unknown>[],
      "recognition-rules": recognitionRules as unknown as Record<string, unknown>[],
    }),
    [subscriptions, plans, deferredSchedules, deferredLines, recognitionRules],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createSubscription") {
      const soRaw = formData.saleOrderId
      const planRaw = formData.planId
      if (soRaw === "" || soRaw == null || planRaw === "" || planRaw == null) return
      const so = saleOrders.find((s) => String(s.id) === String(soRaw))
      if (!so) return
      const currencyId = Number(so.currencyId)
      const pricelistId = Number(so.pricelistId)
      if (Number.isNaN(currencyId) || Number.isNaN(pricelistId)) return
      const recurringDay = Math.min(31, Math.max(1, Math.floor(Number(formData.recurringInvoiceDay ?? 1))))
      createSubscription.mutate({
        saleOrderId: Number(soRaw),
        code: formData.code ? String(formData.code) : undefined,
        planId: Number(planRaw),
        dateStart: new Date(String(formData.dateStart ?? new Date().toISOString())) as unknown as CreateSubscriptionFromSaleOrderParams["dateStart"],
        recurringInvoiceDay: recurringDay,
        isTrial: formData.isTrial === true,
        description: formData.description ? String(formData.description) : undefined,
        recurringRuleType: String(formData.recurringRuleType ?? "monthly"),
        recurringInterval: Math.max(1, Math.floor(Number(formData.recurringInterval ?? 1))),
        paymentMode: String(formData.paymentMode ?? "manual"),
        partnerId: Number(so.partnerId),
        partnerInvoiceId: Number(so.partnerInvoiceId),
        partnerShippingId: Number(so.partnerShippingId),
        currencyId,
        pricelistId,
        analyticAccountId: undefined,
        teamId: undefined,
        health: String(formData.health ?? "normal"),
        stageId: undefined,
        state: String(formData.state ?? "draft"),
        isActive: true,
        invoiceCount: 0,
        recurringTotal: 0,
        recurringMonthly: 0,
        recurringMrr: 0,
        recurringMrrLocal: 0,
        percentageMrr: 0,
        kpi1MonthMrr: 0,
        kpi3MonthsMrr: 0,
        kpi12MonthsMrr: 0,
        ratingLastValue: 0,
        invoiceIds: [],
        subscriptionLineIds: [],
        activityIds: [],
        messageFollowerIds: [],
        messageIds: [],
        metadata: undefined,
      } as unknown as CreateSubscriptionFromSaleOrderParams)
    } else if (action === "createPlan") {
      const plRaw = formData.pricelistId
      const jRaw = formData.journalId
      const prodRaw = formData.productId
      if (plRaw === "" || plRaw == null || jRaw === "" || jRaw == null || prodRaw === "" || prodRaw == null)
        return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const currencyId = Number(pl.currencyId)
      createPlan.mutate({
        name: String(formData.name ?? ""),
        code: String(formData.code ?? formData.name ?? ""),
        description: formData.description ? String(formData.description) : undefined,
        currencyId: plRaw == null ? currencyId : currencyId,
        journalId: Number(jRaw),
        productId: Number(prodRaw),
        billingPeriod: String(formData.billingPeriod ?? "monthly"),
        billingPeriodUnit: Number(formData.billingPeriodUnit ?? 1),
        recurringInvoiceDay: 1,
        trialPeriod: Boolean(formData.trialPeriod),
        trialDuration: Number(formData.trialDuration ?? 0),
        trialUnit: "day",
        autoCloseLimit: 0,
        paymentMode: "manual",
        templateId: undefined,
        invoiceMailTemplateId: undefined,
        websiteUrl: undefined,
        isPublished: true,
        isDefault: Boolean(formData.isDefault),
        color: 0,
        image1920Url: undefined,
        active: true,
        recurringRuleCount: Number(formData.billingPeriodUnit ?? 1),
        recurringRuleMinUnit: String(formData.billingPeriod ?? "monthly"),
        recurringRuleMaxUnit: String(formData.billingPeriod ?? "monthly"),
        recurringRuleMinCount: Number(formData.billingPeriodUnit ?? 1),
        recurringRuleMaxCount: Number(formData.billingPeriodUnit ?? 1),
        metadata: undefined,
      } as unknown as CreateSubscriptionPlanParams)
    } else if (action === "createDeferredSchedule") {
      const params = buildCreateDeferredRevenueScheduleParams(formData)
      void createDeferredSchedule.mutate(params)
    } else if (action === "createRecognitionRule") {
      const raw = { ...formData }
      if (raw.expenseAccountId != null && String(raw.expenseAccountId).trim() !== "") {
        raw.expenseAccountId = raw.expenseAccountId
      } else {
        delete raw.expenseAccountId
      }
      const params = buildCreateRevenueRecognitionRuleParams(raw)
      void createRecognitionRule.mutate(params)
    } else if (action === "importPlanCsv") {
      const raw = formData.csvData
      if (raw == null || String(raw).trim() === "") return
      void importPlanCsv.mutate({ csvData: String(raw) })
    } else if (action === "importSubscriptionCsv") {
      const raw = formData.csvData
      if (raw == null || String(raw).trim() === "") return
      void importSubscriptionCsv.mutate({ csvData: String(raw) })
    }
  }

  const closeForm = useMemo(() => closeSubscriptionForm(t), [t])
  const generateForm = useMemo(() => generateSubscriptionInvoiceForm(t), [t])
  const recognizeForm = useMemo(() => recognizeDeferredRevenueLineForm(t), [t])

  return (
    <>
      <ModuleView config={config} data={data} onFormSubmit={handleFormSubmit} isPending={isFormMutationPending} />
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
          const closeReasonId = formData.closeReasonId
          const notes = formData.notes
          const params = buildCloseSubscriptionParams({ closeReasonId, notes })
          void closeSubscription.mutate({
            subscriptionId: BigInt(closeTargetId),
            params: params as unknown as Record<string, unknown>,
          })
          setCloseTargetId(null)
        }}
      />
      <FormModal
        open={generateTargetId !== null}
        onOpenChange={(open) => !open && setGenerateTargetId(null)}
        config={generateForm}
        onSubmit={(formData) => {
          if (generateTargetId == null) return
          const invoiceDate = formData.invoiceDate
          const params = buildGenerateSubscriptionInvoiceParams({ invoiceDate })
          void generateInvoice.mutate({
            subscriptionId: BigInt(generateTargetId),
            params: params as unknown as Record<string, unknown>,
          })
          setGenerateTargetId(null)
        }}
      />
      <FormModal
        open={recognizeLineId !== null}
        onOpenChange={(open) => !open && setRecognizeLineId(null)}
        config={recognizeForm}
        onSubmit={(formData) => {
          if (recognizeLineId == null) return
          const moveId = formData.moveId
          const moveLineId = formData.moveLineId
          const params = buildRecognizeDeferredRevenueParams({ moveId, moveLineId })
          void recognizeDeferred.mutate({
            lineId: BigInt(recognizeLineId),
            params: params as unknown as Record<string, unknown>,
          })
          setRecognizeLineId(null)
        }}
      />
    </>
  )
}
