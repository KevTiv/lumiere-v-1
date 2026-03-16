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

const ORG_ID = 1n
const COMPANY_ID = 1n

export default function ManufacturingPage() {
  const { data: productions = [] } = useMrpProductions(COMPANY_ID)
  const { data: boms = [] } = useMrpBoms(COMPANY_ID)
  const { data: workorders = [] } = useMrpWorkorders(COMPANY_ID)
  const { data: workcenters = [] } = useMrpWorkcenters(COMPANY_ID)

  const createManufacturingOrder = useCreateManufacturingOrder(ORG_ID, COMPANY_ID)
  const createBom = useCreateBom(ORG_ID, COMPANY_ID)
  const createWorkcenter = useCreateWorkcenter(ORG_ID, COMPANY_ID)

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
