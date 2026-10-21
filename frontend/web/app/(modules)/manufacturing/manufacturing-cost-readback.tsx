"use client"

import Link from "next/link"
import { EntityView, type EntityViewConfig } from "@lumiere/ui"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { canUseModuleData, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useMrpProductionCosts, useMrpProductivityCosts } from "@lumiere/query-hooks/hooks/manufacturing-costs"
import { manufacturingCostAmount, manufacturingCostLinks, manufacturingCostRecord } from "@/lib/manufacturing-cost-record"

export function ManufacturingCostReadback({ organizationId, companyId, productionId }: { organizationId: bigint; companyId: bigint; productionId: bigint }) {
  const costQuery = useMrpProductionCosts(organizationId)
  const productivityQuery = useMrpProductivityCosts(organizationId)
  const costState = moduleQueryState(costQuery)
  const productivityState = moduleQueryState(productivityQuery)
  let invariantError: string | undefined
  let snapshot: NonNullable<typeof costQuery.data>[number] | undefined
  try { snapshot = manufacturingCostRecord(canUseModuleData(costState) ? costQuery.data ?? [] : [], organizationId, companyId, productionId) }
  catch (error) { invariantError = error instanceof Error ? error.message : String(error) }
  const productivity = canUseModuleData(productivityState) ? (productivityQuery.data ?? []).filter(row => row.organizationId === organizationId && row.companyId === companyId && row.productionId === productionId) : []
  const links = snapshot ? manufacturingCostLinks(snapshot) : undefined
  const amounts = [
    ["materialValue", "Material cost"], ["workcenterValue", "Workcenter cost"], ["totalValue", "Total actual cost"],
    ["inventoryValue", "Output inventory value"], ["varianceValue", "Manufacturing variance"],
  ] as const
  const productivityConfig: EntityViewConfig = {
    id: "manufacturing-productivity-costs", title: "Productivity cost snapshots",
    view: { mode: "table", rowKey: "productivityId", columns: [
      { key: "productivityId", label: "Time record" }, { key: "workorderId", label: "Workorder" }, { key: "workcenterId", label: "Workcenter" },
      { key: "durationMinutes", label: "Minutes", type: "number" }, { key: "hourlyRate", label: "Hourly rate", type: "number" },
      { key: "configured", label: "Rate configured", type: "boolean" }, { key: "value", label: "Cost", type: "number" },
    ], emptyMessage: "No productivity cost snapshots recorded for this order." },
  }
  return (
    <section className="space-y-4 rounded-md border p-4" data-testid="manufacturing-order-costs">
      <h2 className="font-semibold">Actual manufacturing cost</h2>
      <ModuleDataNotice state={costState} />
      {invariantError && <p role="alert">{invariantError}</p>}
      {costState.status === "loading" && <p role="status">Loading manufacturing cost snapshot…</p>}
      {costState.status === "ready" && !snapshot && !invariantError && <p>No close cost snapshot recorded. Costs are finalized when the manufacturing order closes.</p>}
      {snapshot && <>
        <p className="text-sm">Company currency #{String(snapshot.currencyId ?? "Unavailable")}. Recorded costs do not change when rates or valuation configuration change.</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{amounts.map(([key, label]) => <div key={key}><dt className="text-sm text-muted-foreground">{label}</dt><dd data-testid={`manufacturing-cost-${key}`} className="font-medium">{manufacturingCostAmount(snapshot?.[key])}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-3">
          {links?.outputs.map(link => <Link key={link.id} href={link.href} data-testid={`manufacturing-cost-output-${link.id}`} className="text-sm text-primary hover:underline">Output stock move #{link.id}</Link>)}
          {links?.journal ? <Link href={links.journal.href} data-testid={`manufacturing-cost-journal-${links.journal.id}`} className="text-sm text-primary hover:underline">Valuation journal entry #{links.journal.id}</Link> : <span className="text-sm text-muted-foreground">No valuation journal entry recorded.</span>}
        </div>
      </>}
      <ModuleDataNotice state={productivityState} />
      {canUseModuleData(productivityState) && <EntityView config={productivityConfig} data={productivity} isLoading={productivityState.status === "loading"} />}
    </section>
  )
}
