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
  FileText,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Filter,
  CreditCard,
  Building,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AccountMove } from "../lib/accounting-types"
import { useTranslation } from "@lumiere/i18n"

type BillStatus = "draft" | "pending" | "approved" | "partial" | "paid" | "overdue" | "cancelled"

const statusConfig: Record<BillStatus, { labelKey: string; bgColor: string; color: string }> = {
  draft: { labelKey: "accounting.states.draft", bgColor: "bg-slate-100", color: "text-slate-700" },
  pending: { labelKey: "accounting.states.pending", bgColor: "bg-blue-100", color: "text-blue-700" },
  approved: { labelKey: "accounting.states.approved", bgColor: "bg-indigo-100", color: "text-indigo-700" },
  partial: { labelKey: "accounting.states.partial", bgColor: "bg-purple-100", color: "text-purple-700" },
  paid: { labelKey: "accounting.states.paid", bgColor: "bg-emerald-100", color: "text-emerald-700" },
  overdue: { labelKey: "accounting.states.overdue", bgColor: "bg-red-100", color: "text-red-700" },
  cancelled: { labelKey: "accounting.states.cancelled", bgColor: "bg-gray-100", color: "text-gray-500" },
}

function getBillStatus(move: AccountMove): BillStatus {
  const state = String(move.state)
  const paymentState = String(move.paymentState)
  if (state === "Cancelled") return "cancelled"
  if (state === "Draft") return "draft"
  if (paymentState === "Paid") return "paid"
  if (move.amountResidual > 0 && move.invoiceDateDue) {
    const due = new Date(Number(move.invoiceDateDue.microsSinceUnixEpoch / 1000n))
    if (due < new Date()) return "overdue"
  }
  if (paymentState === "InPayment") return "partial"
  return "pending"
}

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch / 1000n)
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)

interface BillsListViewProps {
  bills: AccountMove[]
  onSelectBill?: (bill: AccountMove) => void
  onCreateBill?: () => void
  onPayBill?: (bill: AccountMove) => void
}

export function BillsListView({ bills, onSelectBill, onCreateBill, onPayBill }: BillsListViewProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<BillStatus | "all">("all")

  const filtered = bills.filter((bill) => {
    const name = bill.name?.toLowerCase() ?? ""
    const partner = bill.invoicePartnerDisplayName?.toLowerCase() ?? ""
    const matchesSearch = name.includes(searchQuery.toLowerCase()) || partner.includes(searchQuery.toLowerCase())
    const status = getBillStatus(bill)
    const matchesStatus = statusFilter === "all" || status === statusFilter
    return matchesSearch && matchesStatus
  })

  const stats = {
    total: bills.length,
    paid: bills.filter((b) => getBillStatus(b) === "paid").length,
    pending: bills.filter((b) => ["pending", "approved", "partial"].includes(getBillStatus(b))).length,
    overdue: bills.filter((b) => getBillStatus(b) === "overdue").length,
    totalAmount: bills.reduce((s, b) => s + b.amountTotal, 0),
    totalDue: bills.reduce((s, b) => s + b.amountResidual, 0),
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><FileText className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.bills.totalBills")}</p><p className="text-2xl font-bold">{stats.total}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.paid")}</p><p className="text-2xl font-bold">{stats.paid}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.pending")}</p><p className="text-2xl font-bold">{stats.pending}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
            <div><p className="text-sm text-muted-foreground">{t("accounting.states.overdue")}</p><p className="text-2xl font-bold">{stats.overdue}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">{t("accounting.bills.totalBilled")}</p><p className="text-2xl font-bold">{formatCurrency(stats.totalAmount)}</p></div>
            <Building className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">{t("accounting.bills.amountOwed")}</p><p className="text-2xl font-bold text-red-600">{formatCurrency(stats.totalDue)}</p></div>
            <DollarSign className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
      </div>

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
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BillStatus | "all")}>
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
              ) : filtered.map((bill) => {
                const status = getBillStatus(bill)
                const conf = statusConfig[status]
                return (
                  <TableRow key={String(bill.id)} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelectBill?.(bill)}>
                    <TableCell className="font-medium">{bill.name}</TableCell>
                    <TableCell>
                      <p className="font-medium">{bill.invoicePartnerDisplayName ?? `Partner #${bill.partnerId}`}</p>
                    </TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDate)}</TableCell>
                    <TableCell>{formatTimestamp(bill.invoiceDateDue)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(bill.amountTotal)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", bill.amountResidual > 0 ? "text-red-600" : "text-emerald-600")}>
                        {formatCurrency(bill.amountResidual)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("font-medium", conf.bgColor, conf.color)}>{t(conf.labelKey as any)}</Badge>
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
                          {bill.amountResidual > 0 && (
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
        </CardContent>
      </Card>
    </div>
  )
}
