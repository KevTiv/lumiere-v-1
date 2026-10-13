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
  DropdownMenuSeparator,
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
  Download,
  Trash2,
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
  microsSinceEpochToDate,
  moveStateIsDraft,
  moveTypeIsInvoiceOrRefund,
  stbEnumTag,
} from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"

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
  // Typed account-move reads expose algebraic enums as tagged objects (for
  // example `{ tag: "Draft" }`), while legacy rows may still be strings.
  // Normalize both representations before deriving the badge/filter status.
  const state = stbEnumTag(move.state)
  const paymentState = stbEnumTag(move.paymentState)
  if (state === "Cancelled") return "cancelled"
  if (moveStateIsDraft(move.state)) return "draft"
  if (paymentState === "Paid") return "paid"
  if ((move.amountResidual ?? 0) > 0 && move.invoiceDateDue) {
    const due = microsSinceEpochToDate(move.invoiceDateDue)
    if (due != null && due < new Date()) return "overdue"
  }
  if (paymentState === "InPayment") return "partial"
  return "pending"
}

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch) / 1000
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

interface BillsListViewProps {
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
}: BillsListViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<BillStatus | "all">("all")
  // Set by the stat tiles above the list; "pending" groups pending, approved and partly paid bills.
  const [tileFilter, setTileFilter] = useState<"paid" | "pending" | "overdue" | null>(null)

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
      return matchesSearch && matchesStatus && matchesTile
    })
    // Newest first, matching EntityTable's default (auto-inc ids only increase).
    .sort((a, b) => Number(b.id) - Number(a.id))
  const pager = usePagedRows(filtered, `${searchQuery}|${statusFilter}|${tileFilter}`)

  const stats = {
    total: bills.length,
    paid: bills.filter((b) => getBillStatus(b) === "paid").length,
    pending: bills.filter((b) => ["pending", "approved", "partial"].includes(getBillStatus(b))).length,
    overdue: bills.filter((b) => getBillStatus(b) === "overdue").length,
    totalAmount: bills.reduce((s, b) => s + (b.amountTotal ?? 0), 0),
    totalDue: bills.reduce((s, b) => s + (b.amountResidual ?? 0), 0),
  }

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
          { key: "billed", label: t("accounting.bills.totalBilled"), value: formatCurrency(stats.totalAmount), active: false },
          { key: "owed", label: t("accounting.bills.amountOwed"), value: formatCurrency(stats.totalDue), active: false },
        ]}
      />

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>{t("accounting.bills.title")}</CardTitle>
            <Button onClick={onCreateBill} className="gap-2"><Plus className="h-4 w-4" />{t("accounting.actions.newBill")}</Button>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("accounting.bills.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => {
              setStatusFilter(v as BillStatus | "all")
              setTileFilter(null)
            }}>
              <SelectTrigger className="w-[150px]">
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
        </CardHeader>
        <CardContent>
          <Table>
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
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("accounting.bills.noResults")}</TableCell></TableRow>
              ) : pager.pageRows.map((bill) => {
                const status = getBillStatus(bill)
                const conf = statusConfig[status]
                return (
                  <TableRow
                    key={String(bill.id)}
                    data-testid={`entity-row-${bill.id}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onSelectBill?.(bill)}
                  >
                    <TableCell className="font-medium">{bill.name}</TableCell>
                    <TableCell>
                      <p className="font-medium">{bill.invoicePartnerDisplayName ?? `Partner #${bill.partnerId}`}</p>
                    </TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDate)}</TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDateDue)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(bill.amountTotal ?? 0)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", (bill.amountResidual ?? 0) > 0 ? "text-foreground" : "text-success")}>
                        {formatCurrency(bill.amountResidual ?? 0)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("font-medium", conf.pillClass)}>{t(conf.labelKey as any)}</Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectBill?.(bill) }}>
                            <Eye className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.viewDetails")}
                          </DropdownMenuItem>
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
                          {(bill.amountResidual ?? 0) > 0 && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPayBill?.(bill) }}>
                              <CreditCard className="h-4 w-4 mr-2" />{t("accounting.bills.billActions.payBill")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem><Download className="h-4 w-4 mr-2" />{t("accounting.bills.billActions.download")}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />{t("common.delete")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
