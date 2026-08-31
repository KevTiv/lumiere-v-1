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
  Send,
  Download,
  Trash2,
  FileText,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { accountingListStatusBadgeClass } from "../lib/theme-colors"
import type { AccountMove } from "../lib/accounting-types"
import {
  microsSinceEpochToDate,
  moveStateIsDraft,
  moveTypeIsInvoiceOrRefund,
} from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"

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
  const state = String(move.state)
  const paymentState = String(move.paymentState)

  if (state === "Cancelled") return "cancelled"
  if (state === "Draft") return "draft"
  if (paymentState === "Paid") return "paid"
  if (paymentState === "InPayment") return "partial"
  if ((move.amountResidual ?? 0) > 0 && move.invoiceDateDue) {
    const due = microsSinceEpochToDate(move.invoiceDateDue)
    if (due != null && due < new Date()) return "overdue"
  }
  if (paymentState === "Partial") return "partial"
  return "sent"
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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)

interface InvoiceListViewProps {
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
}: InvoiceListViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "all">("all")

  const filtered = invoices.filter((inv) => {
    const name = inv.name?.toLowerCase() ?? ""
    const partner = inv.invoicePartnerDisplayName?.toLowerCase() ?? ""
    const matchesSearch = name.includes(searchQuery.toLowerCase()) || partner.includes(searchQuery.toLowerCase())
    const status = getMoveStatus(inv)
    const matchesStatus = statusFilter === "all" || status === statusFilter
    return matchesSearch && matchesStatus
  })

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => getMoveStatus(i) === "paid").length,
    pending: invoices.filter((i) => ["sent", "partial"].includes(getMoveStatus(i))).length,
    overdue: invoices.filter((i) => getMoveStatus(i) === "overdue").length,
    totalAmount: invoices.reduce((s, i) => s + (i.amountTotal ?? 0), 0),
    totalDue: invoices.reduce((s, i) => s + (i.amountResidual ?? 0), 0),
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10"><FileText className="h-5 w-5 text-info" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.invoices.totalInvoices")}</p><p className="text-2xl font-bold">{stats.total}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10"><CheckCircle2 className="h-5 w-5 text-success" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.paid")}</p><p className="text-2xl font-bold">{stats.paid}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10"><Clock className="h-5 w-5 text-warning" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.pending")}</p><p className="text-2xl font-bold">{stats.pending}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.overdue")}</p><p className="text-2xl font-bold">{stats.overdue}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">{t("accounting.invoices.totalInvoiced")}</p><p className="text-2xl font-bold">{formatCurrency(stats.totalAmount)}</p></div>
            <DollarSign className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">{t("accounting.invoices.outstandingBalance")}</p><p className="text-2xl font-bold text-warning">{formatCurrency(stats.totalDue)}</p></div>
            <Clock className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>{t("accounting.invoices.title")}</CardTitle>
            <Button onClick={onCreateInvoice} className="gap-2"><Plus className="h-4 w-4" />{t("accounting.actions.newInvoice")}</Button>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={t("accounting.invoices.searchPlaceholder")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DisplayStatus | "all")}>
              <SelectTrigger className="w-[150px]">
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
        </CardHeader>
        <CardContent>
          <Table>
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
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("accounting.invoices.noResults")}</TableCell></TableRow>
              ) : filtered.map((inv) => {
                const status = getMoveStatus(inv)
                const conf = statusConfig[status]
                return (
                  <TableRow key={String(inv.id)} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelectInvoice?.(inv)}>
                    <TableCell className="font-medium">{inv.name}</TableCell>
                    <TableCell>
                      <p className="font-medium">{inv.invoicePartnerDisplayName ?? `Partner #${inv.partnerId}`}</p>
                    </TableCell>
                    <TableCell>{formatTimestamp(inv.invoiceDate)}</TableCell>
                    <TableCell>{formatTimestamp(inv.invoiceDateDue)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(inv.amountTotal ?? 0)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", (inv.amountResidual ?? 0) > 0 ? "text-warning" : "text-success")}>
                        {formatCurrency(inv.amountResidual ?? 0)}
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
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectInvoice?.(inv) }}>
                            <Eye className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.viewDetails")}
                          </DropdownMenuItem>
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
                          <DropdownMenuItem><Send className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.sendInvoice")}</DropdownMenuItem>
                          <DropdownMenuItem><Download className="h-4 w-4 mr-2" />{t("accounting.invoices.invoiceActions.downloadPDF")}</DropdownMenuItem>
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
        </CardContent>
      </Card>
    </div>
  )
}
