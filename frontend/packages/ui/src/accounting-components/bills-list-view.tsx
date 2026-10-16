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
  CreditCard,
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
  stbEnumTag,
} from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"
import { EmptyStateCard } from "../components/empty-state-card"
import { decideListEmptyState } from "../lib/list-empty-state"
import { useRBAC } from "../lib/rbac-context"
import { accountingCurrencySummaries, accountingDocumentHref, accountingListMoney, accountingListStatus, accountingSummaryValue, matchesAccountingListFilters, type AccountingListDisplayProps } from "./accounting-list-display"
import { AccountingListFilters, AccountingListSummary } from "./accounting-list-summary"

type BillStatus = "draft" | "pending" | "approved" | "partial" | "paid" | "overdue" | "cancelled"

const statusConfig: Record<BillStatus, { labelKey: string; pillClass: string }> = {
  draft: { labelKey: "accounting.states.draft", pillClass: accountingListStatusBadgeClass.draft },
  pending: { labelKey: "accounting.states.pending", pillClass: accountingListStatusBadgeClass.pending },
  approved: { labelKey: "accounting.states.approved", pillClass: accountingListStatusBadgeClass.approved },
  partial: { labelKey: "accounting.states.partial", pillClass: accountingListStatusBadgeClass.partial },
  paid: { labelKey: "accounting.states.paid", pillClass: accountingListStatusBadgeClass.paid },
  overdue: { labelKey: "accounting.states.overdue", pillClass: accountingListStatusBadgeClass.overdue },
  cancelled: { labelKey: "accounting.states.cancelled", pillClass: accountingListStatusBadgeClass.cancelled },
}

function getBillStatus(move: AccountMove): BillStatus {
  return accountingListStatus(move, "bill") as BillStatus
}

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch) / 1000
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

interface BillsListViewProps extends AccountingListDisplayProps {
  bills: AccountMove[]
  onSelectBill?: (bill: AccountMove) => void
  onCreateBill?: () => void
  onPayBill?: (bill: AccountMove) => void
  onRecalculateTotals?: (bill: AccountMove) => void
}

export function BillsListView({
  bills,
  onSelectBill,
  onCreateBill,
  onPayBill,
  onRecalculateTotals,
  currencyOptions = [],
  initialFilters = {},
  onInitialFilterClear,
}: BillsListViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<BillStatus | "all">("all")
  // Set by the stat tiles above the list; "pending" groups pending, approved and partly paid bills.
  const [tileFilter, setTileFilter] = useState<"paid" | "pending" | "overdue" | null>(null)
  const { checkPermission } = useRBAC()
  const canCreate = checkPermission("account_move", "create").allowed

  const filtered = bills
    .filter((bill) => {
      const name = bill.name?.toLowerCase() ?? ""
      const partner = bill.invoicePartnerDisplayName?.toLowerCase() ?? ""
      const matchesSearch = name.includes(searchQuery.toLowerCase()) || partner.includes(searchQuery.toLowerCase())
      const status = getBillStatus(bill)
      const matchesStatus = statusFilter === "all" || status === statusFilter
      const matchesTile =
        tileFilter == null ||
        (tileFilter === "pending" ? ["pending", "approved", "partial"].includes(status) : status === tileFilter)
      return matchesSearch && matchesStatus && matchesTile && matchesAccountingListFilters(bill, initialFilters, "bill")
    })
    // Newest first, matching EntityTable's default (auto-inc ids only increase).
    .sort((a, b) => Number(b.id) - Number(a.id))
  const pager = usePagedRows(filtered, `${searchQuery}|${statusFilter}|${tileFilter}|${JSON.stringify(initialFilters)}`)
  const emptyKind = decideListEmptyState({
    totalRows: bills.length,
    visibleRows: filtered.length,
    search: searchQuery,
    filters: { ...initialFilters, status: statusFilter === "all" ? undefined : statusFilter, tile: tileFilter ?? undefined },
  })

  const stats = {
    total: bills.length,
    paid: bills.filter((b) => getBillStatus(b) === "paid").length,
    pending: bills.filter((b) => ["pending", "approved", "partial"].includes(getBillStatus(b))).length,
    overdue: bills.filter((b) => getBillStatus(b) === "overdue").length,
  }
  const currencySummaries = accountingCurrencySummaries(bills, currencyOptions)

  return (
    <div className="space-y-6">
      {/* Stats */}
      <KpiStrip
        tiles={[
          { key: "total", label: t("accounting.bills.totalBills"), value: stats.total, tone: "info", active: false },
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
          { key: "billed", label: t("accounting.bills.totalBilled"), value: accountingSummaryValue(currencySummaries, "total"), active: false },
          { key: "owed", label: t("accounting.bills.amountOwed"), value: accountingSummaryValue(currencySummaries, "residual"), active: false },
        ]}
      />
      <AccountingListSummary groups={currencySummaries} />

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t("accounting.bills.title")}</CardTitle>
            {canCreate && onCreateBill ? <Button onClick={onCreateBill} className="gap-2"><Plus className="h-4 w-4" />{t("accounting.actions.newBill")}</Button> : null}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input aria-label={t("accounting.bills.searchPlaceholder")} placeholder={t("accounting.bills.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => {
              setStatusFilter(v as BillStatus | "all")
              setTileFilter(null)
            }}>
              <SelectTrigger className="w-full sm:w-[160px]" aria-label={t("accounting.journalEntries.state")}>
                <Filter className="h-4 w-4 mr-2" /><SelectValue placeholder={t("accounting.journalEntries.state")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("accounting.invoices.allStatus")}</SelectItem>
                <SelectItem value="draft">{t("accounting.states.draft")}</SelectItem>
                <SelectItem value="pending">{t("accounting.states.pending")}</SelectItem>
                <SelectItem value="approved">{t("accounting.states.approved")}</SelectItem>
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
                <TableHead>{t("accounting.bills.billNumber")}</TableHead>
                <TableHead>{t("accounting.bills.vendor")}</TableHead>
                <TableHead>{t("accounting.bills.billDate")}</TableHead>
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
                        title={t("accounting.bills.emptyState.title", { defaultValue: "No vendor bills yet" })}
                        description={t("accounting.bills.emptyState.description", { defaultValue: "Vendor bills record what you owe suppliers so payables and expenses stay accurate. Add the first one to start tracking it." })}
                        primaryAction={
                          canCreate && onCreateBill
                            ? { label: t("accounting.actions.newBill"), onClick: onCreateBill }
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
                        title={t("accounting.bills.noResults")}
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
              ) : pager.pageRows.map((bill) => {
                const status = getBillStatus(bill)
                const conf = statusConfig[status]
                const canPay = onPayBill && stbEnumTag(bill.state).toLowerCase() === "posted" && (bill.amountResidual ?? 0) > 0
                return (
                  <TableRow
                    key={String(bill.id)}
                    data-testid={`entity-row-${bill.id}`}
                    className={cn("hover:bg-muted/50", onSelectBill && "cursor-pointer")}
                    onClick={() => onSelectBill?.(bill)}
                  >
                    <TableCell className="font-medium"><a href={accountingDocumentHref(bill)} onClick={(event) => event.stopPropagation()} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{bill.name || `#${bill.id}`}</a></TableCell>
                    <TableCell>
                      <p className="font-medium">{bill.invoicePartnerDisplayName ?? `Partner #${bill.partnerId}`}</p>
                    </TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDate)}</TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDateDue)}</TableCell>
                    <TableCell className="font-medium tabular-nums">{accountingListMoney(bill.amountTotal, bill, currencyOptions)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", (bill.amountResidual ?? 0) > 0 ? "text-foreground" : "text-success")}>
                        {accountingListMoney(bill.amountResidual, bill, currencyOptions)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("font-medium", conf.pillClass)}>{t(conf.labelKey as any)}</Badge>
                    </TableCell>
                    <TableCell>
                      {(onSelectBill || onRecalculateTotals && moveStateIsDraft(bill.state) && moveTypeIsInvoiceOrRefund(bill.moveType) || canPay) ? <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${bill.name || bill.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {onSelectBill ? <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectBill(bill) }}>
                            <Eye className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.viewDetails")}
                          </DropdownMenuItem> : null}
                          {onRecalculateTotals &&
                            moveStateIsDraft(bill.state) &&
                            moveTypeIsInvoiceOrRefund(bill.moveType) && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRecalculateTotals(bill)
                                }}
                              >
                                <Calculator className="h-4 w-4 mr-2" />
                                {t("accounting.bills.billActions.recalculateTotals")}
                              </DropdownMenuItem>
                            )}
                          {canPay && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPayBill?.(bill) }}>
                              <CreditCard className="h-4 w-4 mr-2" />{t("accounting.bills.billActions.payBill")}
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
