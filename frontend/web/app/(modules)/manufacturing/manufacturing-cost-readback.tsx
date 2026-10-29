"use client"
import { useTranslation } from "@lumiere/i18n"


import Link from "next/link"
import { EntityView, type EntityViewConfig } from "@lumiere/ui"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { canUseModuleData, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useMrpProductionCosts, useMrpProductivityCosts } from "@lumiere/query-hooks/hooks/manufacturing-costs"
import { manufacturingCostAmount, manufacturingCostLinks, manufacturingCostRecord } from "@/lib/manufacturing-cost-record"

export function ManufacturingCostReadback({ organizationId, companyId, productionId }: { organizationId: bigint; companyId: bigint; productionId: bigint }) {
  const { t } = useTranslation()
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
    ["materialValue", t("manufacturing.costReadback.materialValue")], ["workcenterValue", t("manufacturing.costReadback.workcenterValue")], ["totalValue", t("manufacturing.costReadback.totalValue")],
    ["inventoryValue", t("manufacturing.costReadback.inventoryValue")], ["varianceValue", t("manufacturing.costReadback.varianceValue")],
  ] as const
  const productivityConfig: EntityViewConfig = {
    id: "manufacturing-productivity-costs", title: t("manufacturing.manufacturingCostReadback.productivityCostSnapshots"),
    view: { mode: "table", rowKey: "productivityId", columns: [
      { key: "productivityId", label: t("manufacturing.manufacturingCostReadback.timeRecord") }, { key: "workorderId", label: t("manufacturing.manufacturingCostReadback.workorder") }, { key: "workcenterId", label: t("manufacturing.manufacturingCostReadback.workcenter") },
      { key: "durationMinutes", label: t("demo.dashboards.sales.countdown.minutes"), type: "number" }, { key: "hourlyRate", label: t("manufacturing.manufacturingCostReadback.hourlyRate"), type: "number" },
      { key: "configured", label: t("manufacturing.manufacturingCostReadback.rateConfigured"), type: "boolean" }, { key: "value", label: t("inventory.products.columns.standardPrice"), type: "number" },
    ], emptyMessage: t("manufacturing.manufacturingCostReadback.noProductivityCostSnapshotsRecordedForThisOrder") },
  }
  return (
    <section className="space-y-4 rounded-md border p-4" data-testid="manufacturing-order-costs">
      <h2 className="font-semibold">{t("manufacturing.manufacturingCostReadback.actualManufacturingCost")}</h2>
      <ModuleDataNotice state={costState} />
      {invariantError && <p role="alert">{invariantError}</p>}
      {costState.status === "loading" && <p role="status">{t("manufacturing.manufacturingCostReadback.loadingManufacturingCostSnapshot")}</p>}
      {costState.status === "ready" && !snapshot && !invariantError && <p>{t("manufacturing.manufacturingCostReadback.noCloseCostSnapshotRecordedCostsAreFinalizedWhenTheManufacturing")}</p>}
      {snapshot && <>
        <p className="text-sm">{t("manufacturing.manufacturingCostReadback.companyCurrency")}{String(snapshot.currencyId ?? t("accounting.worklists.unavailable"))}{t("manufacturing.manufacturingCostReadback.recordedCostsDoNotChangeWhenRatesOrValuationConfigurationChange")}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{amounts.map(([key, label]) => <div key={key}><dt className="text-sm text-muted-foreground">{label}</dt><dd data-testid={`manufacturing-cost-${key}`} className="font-medium">{manufacturingCostAmount(snapshot?.[key])}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-3">
          {links?.outputs.map(link => <Link key={link.id} href={link.href} data-testid={`manufacturing-cost-output-${link.id}`} className="text-sm text-primary hover:underline">{t("manufacturing.manufacturingCostReadback.outputStockMove")}{link.id}</Link>)}
          {links?.journal ? <Link href={links.journal.href} data-testid={`manufacturing-cost-journal-${links.journal.id}`} className="text-sm text-primary hover:underline">{t("manufacturing.manufacturingCostReadback.valuationJournalEntry")}{links.journal.id}</Link> : <span className="text-sm text-muted-foreground">{t("manufacturing.manufacturingCostReadback.noValuationJournalEntryRecorded")}</span>}
        </div>
      </>}
      <ModuleDataNotice state={productivityState} />
      {canUseModuleData(productivityState) && <EntityView config={productivityConfig} data={productivity} isLoading={productivityState.status === "loading"} />}
    </section>
  )
}
