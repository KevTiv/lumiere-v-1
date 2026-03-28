"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newSubscriptionForm,
  newSubscriptionPlanForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { subscriptionsModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useSubscriptions,
  useSubscriptionPlans,
  useCreateSubscription,
  useCreateSubscriptionPlan,
} from "@/hooks/subscriptions"
import type {
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
} from "@/hooks/subscriptions"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useSaleOrders, usePricelists } from "@/hooks/sales"
import { useProducts } from "@/hooks/inventory"
import { useAccountJournals } from "@/hooks/accounting"
import {
  saleOrderRowsToSelectOptions,
  subscriptionPlanRowsToSelectOptions,
  pricelistRowsToSelectOptions,
  productRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
} from "@/lib/form-lookup"

interface SubscriptionsClientProps {
  initialSubscriptions?: Record<string, unknown>[]
  initialPlans?: Record<string, unknown>[]
  initialSaleOrders?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialProducts?: Record<string, unknown>[]
  initialJournals?: Record<string, unknown>[]
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
  initialSaleOrders,
  initialPricelists,
  initialProducts,
  initialJournals,
  organizationId,
}: SubscriptionsClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => subscriptionsModuleConfig(t), [t])
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: subscriptions = [] } = useSubscriptions(orgId, initialSubscriptions)
  const { data: plans = [] } = useSubscriptionPlans(orgId, initialPlans)
  const { data: saleOrders = [] } = useSaleOrders(companyId, initialSaleOrders)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: journals = [] } = useAccountJournals(orgId, initialJournals)

  const createSubscription = useCreateSubscription(orgId, orgId)
  const createPlan = useCreateSubscriptionPlan(orgId, orgId)

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

  const liveSections = useMemo(() => {
    const active = subscriptions.filter((s) => String(s.state) === "open").length
    const mrr = subscriptions
      .filter((s) => String(s.state) === "open")
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
                { label: "Plans", value: String(plans.length), icon: "List" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_subscription: () => setQuickActionForm({ form: subscriptionFormConfig, action: "createSubscription" }),
            new_plan: () => setQuickActionForm({ form: planFormConfig, action: "createPlan" }),
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
  }, [subscriptions, plans, moduleConfig, t, subscriptionFormConfig, planFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "subscriptions") return { ...tab, createForm: subscriptionFormConfig }
          if (tab.id === "plans") return { ...tab, createForm: planFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [liveSections, moduleConfig, subscriptionFormConfig, planFormConfig],
  )

  const data = useMemo(
    () => ({
      subscriptions: subscriptions as unknown as Record<string, unknown>[],
      plans: plans as unknown as Record<string, unknown>[],
    }),
    [subscriptions, plans],
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
      if (plRaw === "" || plRaw == null || jRaw === "" || jRaw == null || prodRaw === "" || prodRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const currencyId = Number(pl.currencyId)
      createPlan.mutate({
        name: String(formData.name ?? ""),
        code: String(formData.code ?? formData.name ?? ""),
        description: formData.description ? String(formData.description) : undefined,
        currencyId,
        journalId: Number(jRaw),
        productId: Number(prodRaw),
        billingPeriod: String(formData.billingPeriod ?? "monthly"),
        billingPeriodUnit: Number(formData.billingPeriodUnit ?? 1),
        recurringInvoiceDay: Number(formData.recurringInvoiceDay ?? 1),
        trialPeriod: Boolean(formData.trialPeriod),
        trialDuration: Number(formData.trialDuration ?? 0),
        trialUnit: String(formData.trialUnit ?? "day"),
        autoCloseLimit: Number(formData.autoCloseLimit ?? 0),
        paymentMode: String(formData.paymentMode ?? "manual"),
        templateId: undefined,
        invoiceMailTemplateId: undefined,
        websiteUrl: undefined,
        isPublished: true,
        isDefault: Boolean(formData.isDefault),
        color: Number(formData.color ?? 0),
        image1920Url: undefined,
        active: true,
        recurringRuleCount: Number(formData.billingPeriodUnit ?? 1),
        recurringRuleMinUnit: String(formData.billingPeriod ?? "monthly"),
        recurringRuleMaxUnit: String(formData.billingPeriod ?? "monthly"),
        recurringRuleMinCount: Number(formData.billingPeriodUnit ?? 1),
        recurringRuleMaxCount: Number(formData.billingPeriodUnit ?? 1),
        metadata: undefined,
      } as unknown as CreateSubscriptionPlanParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
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
    </>
  )
}
