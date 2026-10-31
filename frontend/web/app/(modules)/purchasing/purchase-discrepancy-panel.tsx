"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { mergeModuleStates } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import type { OrderToCashScope } from "@lumiere/query-hooks/hooks/order-to-cash"
import type { PurchaseHandoffProjection } from "@lumiere/query-hooks/hooks/purchase-order-handoffs"
import { CrossRecordLinks } from "../../../components/order-handoff-links"
import { purchaseDiscrepancies, purchaseDiscrepancyHandoffs, type PurchaseDiscrepancy, type PurchaseDiscrepancyRow } from "./purchase-discrepancies"

interface PurchaseDiscrepancyPanelProps {
  scope: OrderToCashScope
  partialQueue: readonly PurchaseDiscrepancyRow[]
  overBilledQueue: readonly PurchaseDiscrepancyRow[]
  orders: readonly PurchaseDiscrepancyRow[]
  lines: readonly PurchaseDiscrepancyRow[]
  pickings: readonly PurchaseHandoffProjection[]
  bills: readonly PurchaseHandoffProjection[]
  states: { partial: ModuleDataState; overBilled: ModuleDataState; orders: ModuleDataState; lines: ModuleDataState;
    receipts: ModuleDataState; bills: ModuleDataState }
}

/** Review only: every action opens an existing owner record and performs no business write. */
export function PurchaseDiscrepancyPanel({ scope, partialQueue, overBilledQueue, orders, lines, pickings, bills, states }: PurchaseDiscrepancyPanelProps) {
  const { t } = useTranslation()
  const partialState = mergeModuleStates([states.partial, states.orders])
  const overBilledState = mergeModuleStates([states.overBilled, states.orders, states.lines])
  const handoffsState = mergeModuleStates([states.receipts, states.bills])
  const result = purchaseDiscrepancies(partialState.status === "ready" ? partialQueue : [],
    overBilledState.status === "ready" ? overBilledQueue : [], states.orders.status === "ready" ? orders : [],
    states.lines.status === "ready" ? lines : [], scope)
  const entry = (item: PurchaseDiscrepancy, kind: "partial" | "over-billed") => <li key={item.id} className="min-w-0 space-y-3 rounded-lg border p-4" data-testid={`purchase-discrepancy-${kind}-${item.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="font-medium break-words">{item.lineHref ? <Link className="underline underline-offset-2" href={item.lineHref}>{item.label}</Link> : item.label}</h4>
      <Link className="text-sm underline underline-offset-2" href={item.orderHref}>{item.orderLabel}</Link>
    </div>
    {kind === "over-billed" ? <dl className="grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-muted-foreground">{t("purchasing.discrepancies.ordered", { defaultValue: "Ordered" })}</dt><dd className="tabular-nums">{item.ordered}</dd></div>
      <div><dt className="text-muted-foreground">{t("purchasing.discrepancies.received", { defaultValue: "Received" })}</dt><dd className="tabular-nums">{item.received}</dd></div>
      <div><dt className="text-muted-foreground">{t("purchasing.discrepancies.billed", { defaultValue: "Billed" })}</dt><dd className="tabular-nums">{item.billed}</dd></div>
    </dl> : null}
    <p className="text-sm text-muted-foreground">{kind === "over-billed"
      ? t("purchasing.discrepancies.reviewBillHint", { defaultValue: "Review the bill and actual goods received. A quantity discrepancy does not authorize an additional receipt." })
      : t("purchasing.discrepancies.partialHint", { defaultValue: "Some ordered goods remain unreceived. Review the order lines and existing receipts before continuing." })}</p>
    <div className="flex flex-wrap gap-3 text-sm">
      <Link className="underline underline-offset-2" href={item.linesHref}>{t("purchasing.discrepancies.reviewLines", { defaultValue: "Review order lines" })}</Link>
      <Link className="underline underline-offset-2" href={item.handoffsHref}>{t("purchasing.discrepancies.reviewHandoffs", { defaultValue: "Review order receipts and vendor bills" })}</Link>
    </div>
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">{t("purchasing.discrepancies.orderRecords", { defaultValue: "Related records for this order" })}</p>
      {handoffsState.status === "loading" ? <p role="status">{t("common.loading")}</p>
        : handoffsState.status !== "ready" ? <ModuleDataNotice state={handoffsState} />
        : <CrossRecordLinks testIdPrefix={`purchase-discrepancy-${kind}-${item.id}-related`} result={purchaseDiscrepancyHandoffs(item.parent, scope, pickings, bills)} />}
    </div>
  </li>
  const section = (kind: "partial" | "over-billed", title: string, state: ModuleDataState, items: PurchaseDiscrepancy[]) => <section className="min-w-0 space-y-3" data-testid={`purchase-discrepancies-${kind}`}>
    <h3 className="text-base font-semibold">{title}</h3>
    {state.status === "loading" ? <p role="status">{t("common.loading")}</p>
      : state.status !== "ready" ? <ModuleDataNotice state={state} />
      : items.length ? <ul className="space-y-3">{items.map((item) => entry(item, kind))}</ul>
      : <p className="text-sm text-muted-foreground">{t("purchasing.discrepancies.empty", { defaultValue: "No verified discrepancies in this queue." })}</p>}
  </section>
  return <div className="space-y-6 p-4" data-testid="purchase-discrepancies">
    <p className="text-sm text-muted-foreground">{t("purchasing.discrepancies.scopeHint", { defaultValue: "Current company only. Open the exact saved record to review or continue through its existing actions." })}</p>
    {result.unresolved > 0 ? <p role="alert" className="text-sm">{t("purchasing.discrepancies.unresolved", { defaultValue: "Some queued records could not be matched to a current authorized order or line. Refresh the source records before reviewing those cases." })}</p> : null}
    {section("over-billed", t("purchasing.discrepancies.overBilled", { defaultValue: "Over-billed lines" }), overBilledState, result.overBilled)}
    {section("partial", t("purchasing.discrepancies.partial", { defaultValue: "Partially received orders" }), partialState, result.partial)}
  </div>
}
