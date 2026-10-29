"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, CheckCheck, ChevronRight, CircleAlert, FilePlus2, FileText, Landmark, ReceiptText } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Badge } from "@lumiere/ui/components/badge"
import { Button } from "@lumiere/ui/components/button"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import { paymentMinorUnitsText } from "@lumiere/erp-shared/payment-allocation-projection"
import { invoiceRecordHref } from "./invoice-record"
import { AccountantInsights } from "./accountant-insights"
import {
  buildAccountantOverview, overviewDate, overviewDueDate, overviewLabel, overviewMoneyTotals,
  overviewNumber, overviewResidual, overviewTag,
  type AccountantOverviewData, type OverviewCollection, type OverviewQueueKey, type OverviewRow,
} from "./accountant-overview-model"

export interface AccountantOverviewProps {
  data: AccountantOverviewData
  companyName?: string
  onNavigate: (tab: string) => void
  onCreateInvoice?: () => void
  onCreateBill?: () => void
  onCreateJournalEntry?: () => void
  onOpenBankLine: (line: OverviewRow, statement: OverviewRow) => void
  /** Optional fixed clock for previews; normal usage follows the current day. */
  now?: Date
}

export function AccountantOverview({ data, companyName, onNavigate, onCreateInvoice, onCreateBill, onCreateJournalEntry, onOpenBankLine, now }: AccountantOverviewProps) {
  const { t } = useTranslation()
  const tr = (key: string, defaultValue: string) => t(`accounting.overview.${key}`, { defaultValue })
  const model = useMemo(() => buildAccountantOverview(data, now), [data, now])
  const [selectedQueue, setSelectedQueue] = useState<OverviewQueueKey>("overdue")
  const [showAll, setShowAll] = useState(false)
  const queueDefs: Array<{ key: OverviewQueueKey; label: string; hint: string; icon: ReactNode; tab: string }> = [
    { key: "overdue", label: tr("overdue", "Overdue receivables"), hint: tr("overdueHint", "Posted invoices with an outstanding balance"), icon: <CircleAlert />, tab: "invoices" },
    { key: "bills-due", label: tr("billsDue", "Bills due soon"), hint: tr("billsDueHint", "Outstanding vendor bills overdue or due within the next seven days"), icon: <ArrowUpRight />, tab: "bills" },
    { key: "draft-invoices", label: tr("draftInvoices", "Draft customer invoices"), hint: tr("draftInvoicesHint", "Review details before posting"), icon: <FileText />, tab: "invoices" },
    { key: "draft-bills", label: tr("draftBills", "Draft vendor bills"), hint: tr("draftBillsHint", "Check supplier details and line items"), icon: <ReceiptText />, tab: "bills" },
    { key: "bank-lines", label: tr("bankLines", "Unreconciled bank lines"), hint: tr("bankLinesHint", "Match statement activity to your records"), icon: <Landmark />, tab: "bank-statements" },
    { key: "unlinked-payments", label: tr("unallocatedPayments", "Payments with funds to allocate"), hint: tr("unallocatedPaymentsHint", "Remaining funds on posted payments, including partially allocated payments"), icon: <ArrowDownLeft />, tab: "payments" },
    { key: "deadlines", label: tr("deadlines", "Tax deadlines"), hint: tr("deadlinesHint", "Due in the next 30 days or overdue, including organization deadlines"), icon: <CalendarClock />, tab: "tax-deadlines" },
    { key: "periods", label: tr("periods", "Open accounting periods"), hint: tr("periodsHint", "Select a period in the close checklist to check readiness"), icon: <CheckCheck />, tab: "period-close" },
  ]
  const activeDef = queueDefs.find((definition) => definition.key === selectedQueue)!
  const activeQueue = model.queues[selectedQueue]
  const activeRows = selectedQueue === "deadlines" || selectedQueue === "overdue" || selectedQueue === "bills-due"
    ? [...activeQueue.rows].sort((a, b) => (overviewDueDate(a)?.getTime() ?? Infinity) - (overviewDueDate(b)?.getTime() ?? Infinity))
    : activeQueue.rows
  const activityTotal = model.activity.months.reduce((sum, month) => sum + month.invoices + month.bills, 0)
  const activityMax = Math.max(1, ...model.activity.months.flatMap((month) => [month.invoices, month.bills]))
  const activityMonthLabel = (startMs: number, full = false) => new Intl.DateTimeFormat(undefined, {
    month: full ? "long" : "short", ...(full ? { year: "numeric" as const } : {}), timeZone: "UTC",
  }).format(new Date(startMs))

  function stateText(collection: OverviewCollection): string {
    switch (collection.state.status) {
      case "loading": return tr("loading", "Loading…")
      case "denied": return tr("denied", "Access restricted")
      case "partial": return tr("partial", "Complete data unavailable")
      case "error": return tr("error", "Unable to load")
      default: return ""
    }
  }
  function stateNotice(collection: OverviewCollection) {
    if (collection.state.status === "ready") return null
    return <div role={collection.state.status === "error" ? "alert" : "status"} className="space-y-3 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
      <p>{stateText(collection)}</p>
      {"onRetry" in collection.state && collection.state.onRetry && <Button variant="outline" size="sm" onClick={collection.state.onRetry}>{tr("retry", "Retry")}</Button>}
    </div>
  }
  function money(collection: OverviewCollection, empty: string, large = false) {
    if (collection.state.status !== "ready") return <p className="text-sm text-muted-foreground" role="status">{stateText(collection)}</p>
    const totals = overviewMoneyTotals(collection.rows, data.currencies)
    if (!totals.length) return <p className={large ? "text-xl font-medium tracking-tight" : "text-sm text-muted-foreground"}>{empty}</p>
    return <div className="space-y-1">{totals.map((total) => <p key={total.currencyId} className={large ? `${workspaceStyles.metricValue} flex flex-wrap items-baseline gap-x-2 break-words text-xl sm:text-2xl` : "text-sm tabular-nums"}>
      {new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(total.amount)}
      <span className={large ? "text-xs font-normal tracking-normal text-muted-foreground" : "ml-1 text-xs text-muted-foreground"}>{currencyLabel(total)}</span>
    </p>)}</div>
  }
  function currencyLabel(total: { currencyId: string; currencyLabel: string }): string {
    if (!total.currencyId) return tr("currencyUnspecified", "Currency unspecified")
    if (total.currencyLabel === `Currency #${total.currencyId}`) return `${tr("currency", "Currency")} #${total.currencyId}`
    return total.currencyLabel
  }
  function recordAmount(row: OverviewRow, residual = false): string {
    if (row.allocationBalance) {
      const balance = row.allocationBalance
      const currency = data.currencies.rows.find((candidate) => String(candidate.id) === balance.currencyId)
      return `${paymentMinorUnitsText(balance.remainingMinor, balance.decimalPlaces)} ${String(currency?.code ?? currency?.name ?? `${tr("currency", "Currency")} #${balance.currencyId}`)}`
    }
    const totals = overviewMoneyTotals([row], data.currencies, residual ? overviewResidual : (record) => overviewNumber(record.amountTotal ?? record.amount_total ?? record.amount))
    return totals.map((total) => `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total.amount)} ${currencyLabel(total)}`).join(" · ")
  }
  function recordLink(row: OverviewRow, key: OverviewQueueKey): string | undefined {
    if (["overdue", "bills-due", "draft-invoices", "draft-bills"].includes(key)) return invoiceRecordHref({ id: row.id, moveType: row.moveType ?? row.move_type })
    if (key === "unlinked-payments" || key === "deadlines") {
      const tab = key === "deadlines" ? "tax-deadlines" : "payments"
      return `/accounting?tab=${tab}&filter=${encodeURIComponent(`id:${String(row.id)}`)}`
    }
    return undefined
  }
  const summaryCards = [
    { label: tr("receivables", "Accounts receivable"), collection: model.receivables, icon: <ArrowDownLeft />, key: "draft-invoices" as OverviewQueueKey, tab: "invoices", empty: tr("noReceivables", "No open receivables"), hint: tr("receivablesHint", "Outstanding on posted customer invoices") },
    { label: tr("payables", "Accounts payable"), collection: model.payables, icon: <ArrowUpRight />, key: "draft-bills" as OverviewQueueKey, tab: "bills", empty: tr("noPayables", "No open payables"), hint: tr("payablesHint", "Outstanding on posted vendor bills") },
    { label: tr("overdue", "Overdue receivables"), collection: model.overdue, icon: <CircleAlert />, key: "overdue" as OverviewQueueKey, empty: tr("noOverdue", "No overdue invoices"), hint: tr("overdueSummaryHint", "Follow up on unpaid balances") },
    { label: tr("bankLines", "Unreconciled bank lines"), collection: model.unmatched, icon: <Landmark />, key: "bank-lines" as OverviewQueueKey, hint: tr("bankSummaryHint", "Review statement matches") },
  ]

  const queueHref = selectedQueue === "overdue" ? "/accounting?tab=invoices&filter=queue%3Aoverdue"
    : selectedQueue === "draft-invoices" ? "/accounting?tab=invoices&filter=status%3ADraft"
    : selectedQueue === "draft-bills" ? "/accounting?tab=bills&filter=status%3ADraft" : undefined

  return <div className="space-y-6" data-testid="accountant-overview">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{companyName || tr("workspace", "Company workspace")}</p>
        <h2 className={`${workspaceStyles.sectionTitle} text-xl`}>{tr("deskTitle", "Your accounting desk")}</h2>
        <p className={workspaceStyles.pageDescription}>{tr("description", "Keep balances in view and the next task within reach.")}</p>
      </div>
      <div className={workspaceStyles.actions}>
        {onCreateJournalEntry && <Button variant="ghost" onClick={onCreateJournalEntry} data-testid="quick-action-journal_entry"><FileText />{tr("newJournalEntry", "Journal entry")}</Button>}
        {onCreateBill && <Button variant="outline" onClick={onCreateBill} data-testid="quick-action-create_bill"><ReceiptText />{tr("newBill", "New bill")}</Button>}
        {onCreateInvoice && <Button onClick={onCreateInvoice} data-testid="quick-action-create_invoice"><FilePlus2 />{tr("newInvoice", "New invoice")}</Button>}
      </div>
    </div>

    <nav aria-label={t("accounting.insights.sections")} className="flex flex-wrap gap-2 text-sm">
      {[["financial-overview-title", t("accounting.insights.title")], ["accounting-insights-title", t("accounting.insights.insightsTitle")], ["accountant-action-queues", t("accounting.insights.queuesTitle")]].map(([target, label]) => <a key={target} href={`#${target}`} className="inline-flex min-h-11 items-center rounded-md border px-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">{label}</a>)}
    </nav>

    <h2 id="accountant-action-queues" className="scroll-mt-24 text-lg font-semibold tracking-tight">{t("accounting.insights.queuesTitle")}</h2>
    <div className={`${workspaceStyles.surface} grid grid-cols-1 overflow-hidden min-[360px]:grid-cols-2`}>
      {summaryCards.slice(2).map((card, index) => {
        const className = `flex min-w-0 flex-col gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring sm:gap-4 sm:p-5 ${index > 0 ? t("accounting.accountantOverview.borderTMin360pxBorderT0") : ""} ${index > 1 ? t("accounting.accountantOverview.min360pxBorderTXlBorderT0") : ""} ${index % 2 === 1 ? t("accounting.accountantOverview.min360pxBorderL") : ""} ${index === 2 ? "xl:border-l" : ""}`
        const content = <>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><span>{card.label}</span><span className="[&>svg]:size-4">{card.icon}</span></div>
        <div className="flex-1">{card.key === "bank-lines"
          ? <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{card.collection.state.status === "ready" ? card.collection.rows.length : <span className="text-sm font-normal text-muted-foreground">{stateText(card.collection)}</span>}</p>
          : money(card.collection, card.empty!, true)}</div>
        <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{card.hint}</span><ArrowRight className="size-3.5 shrink-0" /></p>
        </>
        return card.tab
          ? <Link key={card.key} href={`/accounting?tab=${card.tab}&filter=queue%3Aopen`} className={className}>{content}</Link>
          : <button key={card.key} type="button" className={className} onClick={() => { setSelectedQueue(card.key); setShowAll(false) }}>{content}</button>
      })}
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-labelledby="accountant-attention-title">
        <div className="border-b px-5 py-4"><h3 id="accountant-attention-title" className="font-semibold">{tr("attention", "Needs attention")}</h3><p className="mt-1 text-xs text-muted-foreground">{tr("attentionHint", "Choose a queue to review its records.")}</p></div>
        <div className="divide-y">{queueDefs.map((definition) => {
          const queue = model.queues[definition.key]
          return <button key={definition.key} type="button" aria-pressed={selectedQueue === definition.key} data-testid={`accountant-queue-${definition.key}`}
            onClick={() => { setSelectedQueue(definition.key); setShowAll(false) }}
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40 aria-pressed:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground [&>svg]:size-4">{definition.icon}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">{definition.label}</span>
            {queue.state.status === "ready" ? <Badge variant={definition.key === "overdue" && queue.rows.length ? "destructive" : "secondary"} className="tabular-nums">{queue.rows.length}</Badge> : <span className="max-w-28 text-right text-xs text-muted-foreground">{stateText(queue)}</span>}
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        })}</div>
      </section>

      <section className="flex min-w-0 flex-col rounded-xl border bg-card" aria-labelledby="accountant-queue-title" aria-live="polite">
        <div className="border-b px-5 py-4"><h3 id="accountant-queue-title" className="font-semibold">{activeDef.label}</h3><p className="mt-1 text-xs text-muted-foreground">{activeDef.hint}</p></div>
        <div className="flex-1 p-5">
          {stateNotice(activeQueue)}
          {activeQueue.state.status === "ready" && (activeRows.length === 0
            ? <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center"><CheckCheck className="size-7 text-muted-foreground" /><p className="text-sm font-medium">{tr("queueClear", "Nothing waiting in this queue")}</p><p className="max-w-xs text-xs text-muted-foreground">{tr("queueClearHint", "New items appear here as your accounting work progresses.")}</p></div>
            : <div className="divide-y">{(showAll ? activeRows : activeRows.slice(0, 6)).map((row) => {
              const href = recordLink(row, selectedQueue)
              const due = overviewDueDate(row)
              const statement = model.statementsById.get(String(row.statementId ?? row.statement_id))
              const body = <><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{overviewLabel(row)}</span><span className="mt-1 block text-xs text-muted-foreground">{due ? `${tr("due", "Due")} ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(due)}` : overviewTag(row.state) || tr("reviewRecord", "Review record")}</span></span><span className="max-w-[45%] break-words text-right text-xs tabular-nums">{recordAmount(row, selectedQueue === "overdue" || selectedQueue === "bills-due")}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" /></>
              const className = "flex w-full items-center gap-3 rounded-md py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              return href ? <Link href={href} key={String(row.id)} className={className}>{body}</Link> : <button type="button" key={String(row.id)} className={className} onClick={() => selectedQueue === "bank-lines" && statement ? onOpenBankLine(row, statement) : onNavigate(activeDef.tab)}>{body}</button>
            })}</div>)}
          {!showAll && activeRows.length > 6 && <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setShowAll(true)}>{tr("showAll", "Show all records")} ({activeRows.length})</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          {selectedQueue === "overdue" && activeQueue.state.status === "ready" ? money(activeQueue, tr("noOutstanding", "No outstanding balance")) : <span className="text-xs text-muted-foreground">{tr("liveWorkspace", "Current company workspace")}</span>}
          {queueHref ? <Link href={queueHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">{tr("openQueue", "Open filtered list")}<ArrowRight className="size-4" /></Link>
            : <Button variant="ghost" size="sm" onClick={() => onNavigate(activeDef.tab)}>{selectedQueue === "bills-due" ? tr("allBills", "All vendor bills") : tr("openWorkspace", "Open workspace")}<ArrowRight /></Button>}
        </div>
      </section>
    </div>

    <AccountantInsights key={`${data.organizationId}:${data.companyId}`} data={data} now={now} />

    <section className={`${workspaceStyles.surface} min-w-0 overflow-hidden`} aria-labelledby="accountant-activity-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div><h3 id="accountant-activity-title" className={workspaceStyles.sectionTitle}>{tr("activityTitle", "Document activity")}</h3><p className={`${workspaceStyles.sectionDescription} mt-1`}>{tr("activityHint", "Posted invoices and vendor bills over the past six months")}</p></div>
        {model.activity.state.status === "ready" && <Badge variant="secondary" className="gap-2 tabular-nums">{tr("activityPosted", "Posted documents")}<span>{activityTotal}</span></Badge>}
      </div>
      <div className="space-y-4 p-5">
        {stateNotice({ rows: [], state: model.activity.state })}
        {model.activity.state.status === "ready" && <>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-chart-1" />{tr("activityInvoices", "Customer invoices")}</span><span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-chart-2" />{tr("activityBills", "Vendor bills")}</span></div>
          {activityTotal === 0 ? <p className="flex min-h-36 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground">{tr("activityEmpty", "No posted documents in this period")}</p> : <div role="img" aria-label={tr("activityAccessible", "Monthly posted document counts. Expand monthly counts below for exact values.")}>
            <div className="grid h-40 grid-cols-6 items-end gap-3 border-b border-dashed px-1 sm:gap-6" aria-hidden="true">
              {model.activity.months.map((month) => <div key={month.startMs} className="flex h-full items-end justify-center gap-1.5 sm:gap-3">
                {[{ count: month.invoices, className: "bg-chart-1" }, { count: month.bills, className: "bg-chart-2" }].map((bar, index) => <div key={index} className="flex h-full w-full max-w-7 flex-col justify-end gap-1">
                  <span className="text-center text-[10px] tabular-nums text-muted-foreground">{bar.count || ""}</span><div className={`rounded-t-sm ${bar.className}`} style={{ height: `${bar.count / activityMax * 82}%` }} />
                </div>)}
              </div>)}
            </div>
            <div className="mt-2 grid grid-cols-6 gap-3 text-center text-[11px] text-muted-foreground sm:gap-6" aria-hidden="true">{model.activity.months.map((month) => <span key={month.startMs}>{activityMonthLabel(month.startMs)}</span>)}</div>
          </div>}
          <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
            <p>{tr("activityPeriodHint", "Calendar months in UTC; the current month includes documents dated through today.")}</p>
            <details className="w-full">
              <summary className="w-fit cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">{tr("activityTable", "View monthly counts")}</summary>
              <table className="mt-3 w-full text-right tabular-nums">
                <caption className="sr-only">{tr("activityTitle", "Document activity")}</caption>
                <thead><tr className="border-b"><th scope="col" className="py-2 text-left font-medium">{tr("activityMonth", "Month")}</th><th scope="col" className="py-2 font-medium">{tr("activityInvoices", "Customer invoices")}</th><th scope="col" className="py-2 font-medium">{tr("activityBills", "Vendor bills")}</th></tr></thead>
                <tbody>{model.activity.months.map((month) => <tr key={month.startMs} className="border-b last:border-0"><th scope="row" className="py-2 text-left font-normal">{activityMonthLabel(month.startMs, true)}</th><td className="py-2">{month.invoices}</td><td className="py-2">{month.bills}</td></tr>)}</tbody>
              </table>
            </details>
          </div>
        </>}
      </div>
    </section>

    <section className="min-w-0 overflow-hidden rounded-xl border bg-card" aria-labelledby="accountant-recent-title">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4"><div><h3 id="accountant-recent-title" className="font-semibold">{tr("recent", "Recent invoices and bills")}</h3><p className="mt-1 text-xs text-muted-foreground">{tr("recentHint", "Open a document to review its details and next action.")}</p></div><FileText className="size-4 shrink-0 text-muted-foreground" /></div>
      <div className="px-5">{stateNotice(model.recent)}{model.recent.state.status === "ready" && (model.recent.rows.length === 0
        ? <p className="py-8 text-center text-sm text-muted-foreground">{tr("noRecent", "Your invoices and bills will appear here.")}</p>
        : <div className="divide-y">{model.recent.rows.map((row) => <Link key={String(row.id)} href={invoiceRecordHref({ id: row.id, moveType: row.moveType ?? row.move_type })!} className="flex items-center gap-3 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
          <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg border sm:flex"><FileText className="size-4 text-muted-foreground" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{overviewLabel(row)}</span><span className="mt-1 block text-xs text-muted-foreground">{overviewDate(row) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(overviewDate(row)!) : "—"}</span></span>
          <span className="max-w-[40%] break-words text-right text-sm tabular-nums">{recordAmount(row)}</span>
          <Badge variant={overviewTag(row.state) === "posted" ? "outline" : "secondary"} className="hidden capitalize sm:inline-flex">{overviewTag(row.state)}</Badge><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
        </Link>)}</div>)}</div>
    </section>
  </div>
}
