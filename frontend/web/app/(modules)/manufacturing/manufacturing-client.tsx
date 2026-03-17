"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { manufacturingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useMrpProductions,
  useMrpBoms,
  useMrpWorkorders,
  useMrpWorkcenters,
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
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  const { data: productions = [] } = useMrpProductions(companyId, initialProductions)
  const { data: boms = [] } = useMrpBoms(companyId, initialBoms)
  const { data: workorders = [] } = useMrpWorkorders(companyId, initialWorkorders)
  const { data: workcenters = [] } = useMrpWorkcenters(companyId, initialWorkcenters)

  const createManufacturingOrder = useCreateManufacturingOrder(orgId, companyId)
  const createBom = useCreateBom(orgId, companyId)
  const createWorkcenter = useCreateWorkcenter(orgId, companyId)

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
      manufacturingModuleConfig.tabs
        .find((t) => t.id === "dashboard")
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
            return w
          }),
        })) ??
      manufacturingModuleConfig.tabs.find((t) => t.id === "dashboard")?.sections ??
      []
    )
  }, [productions, workorders, workcenters])

  const config = useMemo(
    () => ({
      ...manufacturingModuleConfig,
      tabs: manufacturingModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab
      ),
    }),
    [liveSections]
  )

  const data = useMemo(
    () => ({
      orders: productions as unknown as Record<string, unknown>[],
      boms: boms as unknown as Record<string, unknown>[],
      workorders: workorders as unknown as Record<string, unknown>[],
      workcenters: workcenters as unknown as Record<string, unknown>[],
    }),
    [productions, boms, workorders, workcenters]
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
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
