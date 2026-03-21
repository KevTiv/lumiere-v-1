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
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AccountMove } from "../lib/accounting-types"

// State display mapping
type DisplayStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "cancelled"

const statusConfig: Record<DisplayStatus, { label: string; bgColor: string; color: string }> = {
  draft:     { label: "Draft",     bgColor: "bg-slate-100",  color: "text-slate-700" },
  sent:      { label: "Sent",      bgColor: "bg-blue-100",   color: "text-blue-700"  },
  partial:   { label: "Partial",   bgColor: "bg-purple-100", color: "text-purple-700"},
  paid:      { label: "Paid",      bgColor: "bg-emerald-100",color: "text-emerald-700"},
  overdue:   { label: "Overdue",   bgColor: "bg-red-100",    color: "text-red-700"   },
  cancelled: { label: "Cancelled", bgColor: "bg-gray-100",   color: "text-gray-500"  },
}

function getMoveStatus(move: AccountMove): DisplayStatus {
  const state = String(move.state)
  const paymentState = String(move.paymentState)

  if (state === "Cancelled") return "cancelled"
  if (state === "Draft") return "draft"
  if (paymentState === "Paid") return "paid"
  if (paymentState === "InPayment") return "partial"
  if (move.amountResidual > 0 && move.invoiceDateDue) {
    const due = new Date(Number(move.invoiceDateDue.microsSinceUnixEpoch / 1000n))
    if (due < new Date()) return "overdue"
  }
  if (paymentState === "Partial") return "partial"
  return "sent"
}

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch / 1000n)
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)

interface InvoiceListViewProps {
  invoices: AccountMove[]
  onSelectInvoice?: (invoice: AccountMove) => void
  onCreateInvoice?: () => void
}

export function InvoiceListView({ invoices, onSelectInvoice, onCreateInvoice }: InvoiceListViewProps) {
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
    totalAmount: invoices.reduce((s, i) => s + i.amountTotal, 0),
    totalDue: invoices.reduce((s, i) => s + i.amountResidual, 0),
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10"><FileText className="h-5 w-5 text-blue-600" /></div>
            <div><p className="text-sm text-muted-foreground">Total Invoices</p><p className="text-2xl font-bold">{stats.total}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
            <div><p className="text-sm text-muted-foreground">Paid</p><p className="text-2xl font-bold">{stats.paid}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10"><Clock className="h-5 w-5 text-amber-600" /></div>
            <div><p className="text-sm text-muted-foreground">Pending</p><p className="text-2xl font-bold">{stats.pending}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
            <div><p className="text-sm text-muted-foreground">Overdue</p><p className="text-2xl font-bold">{stats.overdue}</p></div>
          </div>
        </CardContent></Card>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">Total Invoiced</p><p className="text-2xl font-bold">{formatCurrency(stats.totalAmount)}</p></div>
            <DollarSign className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-muted-foreground">Outstanding Balance</p><p className="text-2xl font-bold text-amber-600">{formatCurrency(stats.totalDue)}</p></div>
            <Clock className="h-8 w-8 text-muted-foreground/30" />
          </div>
        </CardContent></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
            <Button onClick={onCreateInvoice} className="gap-2"><Plus className="h-4 w-4" />New Invoice</Button>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DisplayStatus | "all")}>
              <SelectTrigger className="w-[150px]">
                <Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices found</TableCell></TableRow>
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
                    <TableCell className="font-medium">{formatCurrency(inv.amountTotal)}</TableCell>
                    <TableCell>
                      <span className={cn("font-medium", inv.amountResidual > 0 ? "text-amber-600" : "text-emerald-600")}>
                        {formatCurrency(inv.amountResidual)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("font-medium", conf.bgColor, conf.color)}>{conf.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelectInvoice?.(inv) }}>
                            <Eye className="h-4 w-4 mr-2" />View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem><Send className="h-4 w-4 mr-2" />Send Invoice</DropdownMenuItem>
                          <DropdownMenuItem><Download className="h-4 w-4 mr-2" />Download PDF</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
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
