"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newManufacturingOrderForm, newBomForm, newWorkcenterForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { manufacturingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useMrpProductions,
  useMrpBoms,
  useMrpWorkorders,
  useMrpWorkcenters,
  useQualityChecks,
  useCreateManufacturingOrder,
  useCreateBom,
  useCreateWorkcenter,
} from "@lumiere/stdb"

interface ManufacturingClientProps {
  initialProductions?: Record<string, unknown>[]
  initialBoms?: Record<string, unknown>[]
  initialWorkorders?: Record<string, unknown>[]
  initialWorkcenters?: Record<string, unknown>[]
  organizationId?: number
}

export function ManufacturingClient({
  initialProductions,
  initialBoms,
  initialWorkorders,
  initialWorkcenters,
  organizationId,
}: ManufacturingClientProps) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: productions = [] } = useMrpProductions(companyId, initialProductions)
  const { data: boms = [] } = useMrpBoms(companyId, initialBoms)
  const { data: workorders = [] } = useMrpWorkorders(companyId, initialWorkorders)
  const { data: workcenters = [] } = useMrpWorkcenters(companyId, initialWorkcenters)
  const { data: qualityChecks = [] } = useQualityChecks(companyId)

  const createManufacturingOrder = useCreateManufacturingOrder(orgId, companyId)
  const createBom = useCreateBom(orgId, companyId)
  const createWorkcenter = useCreateWorkcenter(orgId, companyId)

  const moduleConfig = useMemo(() => manufacturingModuleConfig(t), [t])

  const liveSections = useMemo(() => {
    const activeOrders = productions.filter(
      (p) => String(p.state) === "Confirmed" || String(p.state) === "Progress"
    )
    const doneOrders = productions.filter((p) => String(p.state) === "Done")
    const totalOrders = productions.length
    const onTimeRate =
      totalOrders > 0 ? Math.round((doneOrders.length / totalOrders) * 100) : 0

    const avgOee =
      workcenters.length > 0
        ? Math.round(
            workcenters.reduce((s, wc) => s + Number(wc.oee ?? 0), 0) / workcenters.length
          )
        : 0

    const readyWorkorders = workorders.filter((wo) => String(wo.state) === "Ready").length

    return (
      moduleConfig.tabs
        .find((tab) => tab.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: "Active Orders", value: activeOrders.length.toString(), icon: "Factory" },
                    { label: "On-Time Rate", value: `${onTimeRate}%`, icon: "CheckCircle" },
                    { label: "OEE Efficiency", value: `${avgOee}%`, icon: "Settings" },
                    { label: "Ready Work Orders", value: readyWorkorders.toString(), icon: "Wrench" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_mo: () => setQuickActionForm({ form: newManufacturingOrderForm(t), action: "createManufacturingOrder" }),
                create_bom: () => setQuickActionForm({ form: newBomForm(t), action: "createBom" }),
                create_workcenter: () => setQuickActionForm({ form: newWorkcenterForm(t), action: "createWorkcenter" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "mfg-work-centers") {
              const colors = ["#22c55e", "#6366f1", "#22c55e", "#f59e0b", "#f59e0b"]
              const metrics = workcenters.slice(0, 5).map((wc, i) => ({
                label: String(wc.name ?? `Work Center ${i + 1}`),
                value: Math.round(Number(wc.oee ?? 0)),
                max: 100,
                color: colors[i] ?? "#6366f1",
              }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "mfg-orders-table") {
              const activeOrders = productions
                .filter((p) => {
                  const s = String(p.state ?? "")
                  return s === "Confirmed" || s === "Progress" || s === "InProgress"
                })
                .slice(0, 4)
                .map((p) => {
                  const progress =
                    Number(p.qtyProducing ?? 0) > 0 && Number(p.qtyProduced ?? 0) >= 0
                      ? `${Math.round((Number(p.qtyProduced) / Math.max(1, Number(p.qtyProducing ?? 1))) * 100)}%`
                      : "0%"
                  const dueDateMs = Number(p.datePlannedFinished ?? 0) / 1000
                  const dueStr =
                    dueDateMs > 0
                      ? new Date(dueDateMs).toLocaleDateString("en", { month: "short", day: "numeric" })
                      : "—"
                  return {
                    ref: `MO-${String(p.id).slice(-6)}`,
                    product: `Product ${String(p.productId ?? "?").slice(-4)}`,
                    qty: Math.round(Number(p.qtyProducing ?? 0)),
                    progress,
                    due: dueStr,
                    status: String(p.state ?? "Draft"),
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows: activeOrders } }
            }
            return w
          }),
        })) ??
      moduleConfig.tabs.find((tab) => tab.id === "dashboard")?.sections ??
      []
    )
  }, [productions, workorders, workcenters, t, moduleConfig])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }) as ModuleConfig,
    [moduleConfig, liveSections]
  )

  const data = useMemo(
    () => ({
      orders: productions as unknown as Record<string, unknown>[],
      boms: boms as unknown as Record<string, unknown>[],
      workorders: workorders as unknown as Record<string, unknown>[],
      workcenters: workcenters as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
    }),
    [productions, boms, workorders, workcenters, qualityChecks]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createManufacturingOrder") createManufacturingOrder.mutate(formData as never)
    else if (action === "createBom") createBom.mutate(formData as never)
    else if (action === "createWorkcenter") createWorkcenter.mutate(formData as never)
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
        config={quickActionForm?.form ?? newManufacturingOrderForm(t)}
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
