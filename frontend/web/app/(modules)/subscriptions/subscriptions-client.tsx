"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newSubscriptionForm, newSubscriptionPlanForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { subscriptionsModuleConfig } from "@/lib/module-dashboard-configs"
import { useSubscriptions, useSubscriptionPlans, useStdbConnection, getStdbConnection, subscriptionsSubscriptions } from "@lumiere/stdb"

interface SubscriptionsClientProps {
  initialSubscriptions?: Record<string, unknown>[]
  initialPlans?: Record<string, unknown>[]
  organizationId?: number
}

export function SubscriptionsClient({ initialSubscriptions, initialPlans, organizationId }: SubscriptionsClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => subscriptionsModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] subscriptions subscription error", err))
      .subscribe(subscriptionsSubscriptions(orgId))
  }, [connected, orgId])

  const { data: subscriptions = [] } = useSubscriptions(orgId, initialSubscriptions)
  const { data: plans = [] } = useSubscriptionPlans(orgId, initialPlans)

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
            new_subscription: () => setQuickActionForm({ form: newSubscriptionForm(t), action: "createSubscription" }),
            new_plan: () => setQuickActionForm({ form: newSubscriptionPlanForm(t), action: "createPlan" }),
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
  }, [subscriptions, plans, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
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
    _action: string,
    _formData: Record<string, unknown>,
  ) => {
    // reducers for subscriptions can be wired here
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
        config={quickActionForm?.form ?? newSubscriptionForm(t)}
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
