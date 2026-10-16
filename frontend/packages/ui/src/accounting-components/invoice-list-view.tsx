"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Plus,
  MoreHorizontal,
  Eye,
  Filter,
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { KpiStrip } from "../components/kpi-strip"
import { toggleKpiKey } from "../lib/kpi-tiles"
import { TablePager, usePagedRows } from "../components/table-pager"
import { accountingListStatusBadgeClass } from "../lib/theme-colors"
import type { AccountMove } from "../lib/accounting-types"
import {
  moveStateIsDraft,
  moveTypeIsInvoiceOrRefund,
} from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"
import { EmptyStateCard } from "../components/empty-state-card"
import { decideListEmptyState } from "../lib/list-empty-state"
import { useRBAC } from "../lib/rbac-context"
import { accountingCurrencySummaries, accountingDocumentHref, accountingListMoney, accountingListStatus, accountingSummaryValue, matchesAccountingListFilters, type AccountingListDisplayProps } from "./accounting-list-display"
import { AccountingListFilters, AccountingListSummary } from "./accounting-list-summary"

// State display mapping
type DisplayStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled"

const statusConfig: Record<DisplayStatus, { labelKey: string; pillClass: string }> = {
  draft: { labelKey: "accounting.states.draft", pillClass: accountingListStatusBadgeClass.draft },
  sent: { labelKey: "accounting.states.sent", pillClass: accountingListStatusBadgeClass.sent },
  partial: { labelKey: "accounting.states.partial", pillClass: accountingListStatusBadgeClass.partial },
  paid: { labelKey: "accounting.states.paid", pillClass: accountingListStatusBadgeClass.paid },
  overdue: { labelKey: "accounting.states.overdue", pillClass: accountingListStatusBadgeClass.overdue },
  cancelled: { labelKey: "accounting.states.cancelled", pillClass: accountingListStatusBadgeClass.cancelled },
}

function getMoveStatus(move: AccountMove): DisplayStatus {
  return accountingListStatus(move, "invoice") as DisplayStatus
}

function formatTimestamp(ts?: { microsSinceUnixEpoch?: bigint | number } | number | null): string {
  if (ts == null) return "—"
  const micros =
    typeof ts === "number"
      ? ts
      : Number(ts.microsSinceUnixEpoch ?? 0)
  if (!Number.isFinite(micros) || micros === 0) return "—"
  const ms = micros / 1000
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

interface InvoiceListViewProps extends AccountingListDisplayProps {
  invoices: AccountMove[]
  onSelectInvoice?: (invoice: AccountMove) => void
  onCreateInvoice?: () => void
  onRecalculateTotals?: (invoice: AccountMove) => void
}

export function InvoiceListView({
  invoices,
  onSelectInvoice,
  onCreateInvoice,
  onRecalculateTotals,
  currencyOptions = [],
  initialFilters = {},
  onInitialFilterClear,
}: InvoiceListViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "all">("all")
  // Set by the stat tiles above the list; "pending" groups sent and partly paid invoices.
  const [tileFilter, setTileFilter] = useState<"paid" | "pending" | "overdue" | null>(null)
  const { checkPermission } = useRBAC()
  const canCreate = checkPermission("account_move", "create").allowed

  const filtered = invoices
    .filter((inv) => {
      const name = inv.name?.toLowerCase() ?? ""
      const partner = inv.invoicePartnerDisplayName?.toLowerCase() ?? ""
      const matchesSearch = name.includes(searchQuery.toLowerCase()) || partner.includes(searchQuery.toLowerCase())
      const status = getMoveStatus(inv)
      const matchesStatus = statusFilter === "all" || status === statusFilter
      const matchesTile =
        tileFilter == null || (tileFilter === "pending" ? ["sent", "partial"].includes(status) : status === tileFilter)
      return matchesSearch && matchesStatus && matchesTile && matchesAccountingListFilters(inv, initialFilters, "invoice")
    })
    // Newest first, matching EntityTable's default (auto-inc ids only increase).
    .sort((a, b) => Number(b.id) - Number(a.id))
  const pager = usePagedRows(filtered, `${searchQuery}|${statusFilter}|${tileFilter}|${JSON.stringify(initialFilters)}`)
  const emptyKind = decideListEmptyState({
    totalRows: invoices.length,
    visibleRows: filtered.length,
    search: searchQuery,
    filters: { ...initialFilters, status: statusFilter === "all" ? undefined : statusFilter, tile: tileFilter ?? undefined },
  })

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => getMoveStatus(i) === "paid").length,
    pending: invoices.filter((i) => ["sent", "partial"].includes(getMoveStatus(i))).length,
    overdue: invoices.filter((i) => getMoveStatus(i) === "overdue").length,
  }
  const currencySummaries = accountingCurrencySummaries(invoices, currencyOptions)

  return (
    <div className="space-y-6">
      {/* Stats */}
      <KpiStrip
        tiles={[
          { key: "total", label: t("accounting.invoices.totalInvoices"), value: stats.total, tone: "info", active: false },
          ...(["paid", "pending", "overdue"] as const).map((key) => ({
            key,
            label: { paid: t("accounting.states.paid"), pending: t("accounting.states.pending"), overdue: t("accounting.states.overdue") }[key],
            value: stats[key],
            tone: ({ paid: "success", pending: "warning", overdue: "destructive" } as const)[key],
            active: tileFilter === key,
            onSelect: () => {
              setTileFilter(toggleKpiKey(tileFilter, key) as typeof tileFilter)
              setStatusFilter("all")
            },
          })),
          { key: "invoiced", label: t("accounting.invoices.totalInvoiced"), value: accountingSummaryValue(currencySummaries, "total"), active: false },
          { key: "outstanding", label: t("accounting.invoices.outstandingBalance"), value: accountingSummaryValue(currencySummaries, "residual"), active: false },
        ]}
      />
      <AccountingListSummary groups={currencySummaries} />

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t("accounting.invoices.title")}</CardTitle>
            {canCreate && onCreateInvoice ? <Button onClick={onCreateInvoice} className="gap-2"><Plus className="h-4 w-4" />{t("accounting.actions.newInvoice")}</Button> : null}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input aria-label={t("accounting.invoices.searchPlaceholder")} placeholder={t("accounting.invoices.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => {
              setStatusFilter(v as DisplayStatus | "all")
              setTileFilter(null)
            }}>
              <SelectTrigger className="w-full sm:w-[160px]" aria-label={t("accounting.journalEntries.state")}>
                <Filter className="h-4 w-4 mr-2" /><SelectValue placeholder={t("accounting.journalEntries.state")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("accounting.invoices.allStatus")}</SelectItem>
                <SelectItem value="draft">{t("accounting.states.draft")}</SelectItem>
                <SelectItem value="sent">{t("accounting.states.sent")}</SelectItem>
                <SelectItem value="partial">{t("accounting.states.partial")}</SelectItem>
                <SelectItem value="paid">{t("accounting.states.paid")}</SelectItem>
                <SelectItem value="overdue">{t("accounting.states.overdue")}</SelectItem>
                <SelectItem value="cancelled">{t("accounting.states.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AccountingListFilters initialFilters={initialFilters} onInitialFilterClear={onInitialFilterClear} />
        </CardHeader>
        <CardContent>
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("accounting.invoices.title")}</TableHead>
                <TableHead>{t("accounting.invoices.customer")}</TableHead>
                <TableHead>{t("accounting.invoices.issueDate")}</TableHead>
                <TableHead>{t("accounting.invoices.dueDate")}</TableHead>
                <TableHead>{t("accounting.invoices.amount")}</TableHead>
                <TableHead>{t("accounting.invoices.balanceDue")}</TableHead>
                <TableHead>{t("accounting.journalEntries.state")}</TableHead>
                <TableHead className="w-12.5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    {emptyKind === "first-time" ? (
                      <EmptyStateCard
                        compact
                        data-testid="entity-empty-first-time"
                        title={t("accounting.invoices.emptyState.title", { defaultValue: "No invoices yet" })}
                        description={t("accounting.invoices.emptyState.description", { defaultValue: "Invoices bill your customers and feed receivables and revenue reporting. Create the first one to start getting paid." })}
                        primaryAction={
                          canCreate && onCreateInvoice
                            ? { label: t("accounting.actions.newInvoice"), onClick: onCreateInvoice }
                            : undefined
                        }
                        readOnlyMessage={t("common.entityView.firstTime.readOnly", {
                          defaultValue: "You have read-only access. Ask an administrator to add the first record.",
                        })}
                      />
                    ) : (
                      <EmptyStateCard
                        compact
                        data-testid="entity-empty-no-results"
                        title={t("accounting.invoices.noResults")}
                        primaryAction={{
                          label: t("common.entityView.noResults.clear", { defaultValue: "Clear filters" }),
                          testId: "entity-empty-clear-filters",
                          onClick: () => {
                            setSearchQuery("")
                            setStatusFilter("all")
                            setTileFilter(null)
                            onInitialFilterClear?.("*")
                          },
                        }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ) : pager.pageRows.map((inv) => {
                const status = getMoveStatus(inv)
                const conf = statusConfig[status]
                return (
                  <TableRow
                    key={String(inv.id)}
                    data-testid={`entity-row-${inv.id}`}
                    className={cn("hover:bg-muted/50", onSelectInvoice && "cursor-pointer")}
                    onClick={() => onSelectInvoice?.(inv)}
                  >
                    <TableCell className="font-medium"><a href={accountingDocumentHref(inv)} onClick={(event) => event.stopPropagation()} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{inv.name || `#${inv.id}`}</a></TableCell>
                    <TableCell>
                      <p className="font-medium">{inv.invoicePartnerDisplayName ?? `Partner #${inv.partnerId}`}</p>
                    </TableCell>
                    <TableCell>{formatTimestamp(inv.invoiceDate)}</TableCell>
                    <TableCell>{formatTimestamp(inv.invoiceDateDue)}</TableCell>
                    <TableCell className="font-medium tabular-nums">{accountingListMoney(inv.amountTotal, inv, currencyOptions)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", (inv.amountResidual ?? 0) > 0 ? "text-foreground" : "text-success")}>
                        {accountingListMoney(inv.amountResidual, inv, currencyOptions)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("font-medium", conf.pillClass)}>{t(conf.labelKey as any)}</Badge>
                    </TableCell>
                    <TableCell>
                      {(onSelectInvoice || onRecalculateTotals && moveStateIsDraft(inv.state) && moveTypeIsInvoiceOrRefund(inv.moveType)) ? <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${inv.name || inv.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onSelectInvoice ? <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectInvoice(inv) }}>
                            <Eye className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.viewDetails")}
                          </DropdownMenuItem> : null}
                          {onRecalculateTotals &&
                            moveStateIsDraft(inv.state) &&
                            moveTypeIsInvoiceOrRefund(inv.moveType) && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRecalculateTotals(inv)
                                }}
                              >
                                <Calculator className="h-4 w-4 mr-2" />
                                {t("accounting.invoices.invoiceActions.recalculateTotals")}
                              </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                      </DropdownMenu> : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </CardContent>
      </Card>
    </div>
  )
}
