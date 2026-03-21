"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table"
import {
  Send,
  Download,
  Printer,
  DollarSign,
  Building,
  FileText,
  Clock,
  CheckCircle2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { AccountMove } from "../lib/accounting-types"

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null, long = false): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch / 1000n)
  return new Date(ms).toLocaleDateString("en-US", long
    ? { month: "long", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }
  )
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)

function getStatusBadge(move: AccountMove) {
  const state = String(move.state)
  const paymentState = String(move.paymentState)
  if (state === "Cancelled") return { label: "Cancelled", cls: "bg-gray-100 text-gray-500" }
  if (state === "Draft")     return { label: "Draft",     cls: "bg-slate-100 text-slate-700" }
  if (paymentState === "Paid") return { label: "Paid",    cls: "bg-emerald-100 text-emerald-700" }
  if (move.amountResidual > 0 && move.invoiceDateDue) {
    const due = new Date(Number(move.invoiceDateDue.microsSinceUnixEpoch / 1000n))
    if (due < new Date()) return { label: "Overdue", cls: "bg-red-100 text-red-700" }
  }
  if (paymentState === "InPayment") return { label: "Partial", cls: "bg-purple-100 text-purple-700" }
  return { label: "Sent", cls: "bg-blue-100 text-blue-700" }
}

interface InvoiceDetailModalProps {
  invoice: AccountMove | null
  open: boolean
  onClose: () => void
}

export function InvoiceDetailModal({ invoice, open, onClose }: InvoiceDetailModalProps) {
  if (!invoice) return null

  const { label, cls } = getStatusBadge(invoice)

  const getDaysUntilDue = () => {
    if (!invoice.invoiceDateDue) return null
    const due = new Date(Number(invoice.invoiceDateDue.microsSinceUnixEpoch / 1000n))
    return Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }
  const daysUntilDue = getDaysUntilDue()

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl">{invoice.name}</DialogTitle>
              <p className="text-muted-foreground mt-1">{invoice.invoicePartnerDisplayName ?? `Partner #${invoice.partnerId}`}</p>
            </div>
            <Badge className={cn("text-sm", cls)}>{label}</Badge>
          </div>
        </DialogHeader>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pb-4">
          <Button variant="outline" size="sm" className="gap-2"><Send className="h-4 w-4" />Send</Button>
          <Button variant="outline" size="sm" className="gap-2"><Download className="h-4 w-4" />Download</Button>
          <Button variant="outline" size="sm" className="gap-2"><Printer className="h-4 w-4" />Print</Button>
          {invoice.amountResidual > 0 && (
            <Button size="sm" className="gap-2 ml-auto"><DollarSign className="h-4 w-4" />Record Payment</Button>
          )}
        </div>

        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10"><DollarSign className="h-5 w-5 text-blue-600" /></div>
                <div><p className="text-sm text-muted-foreground">Total Amount</p><p className="text-xl font-bold">{formatCurrency(invoice.amountTotal)}</p></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
                <div><p className="text-sm text-muted-foreground">Amount Paid</p><p className="text-xl font-bold text-emerald-600">{formatCurrency(invoice.amountTotal - invoice.amountResidual)}</p></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", invoice.amountResidual > 0 ? "bg-amber-500/10" : "bg-muted")}>
                  <Clock className={cn("h-5 w-5", invoice.amountResidual > 0 ? "text-amber-600" : "text-muted-foreground")} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Balance Due</p>
                  <p className={cn("text-xl font-bold", invoice.amountResidual > 0 ? "text-amber-600" : "text-muted-foreground")}>
                    {formatCurrency(invoice.amountResidual)}
                  </p>
                </div>
              </div>
            </CardContent></Card>
          </div>

          {/* Partner & Dates */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Bill To</h4>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                <Building className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">{invoice.invoicePartnerDisplayName ?? `Partner #${invoice.partnerId}`}</p>
                  {invoice.ref && <p className="text-sm text-muted-foreground">Ref: {invoice.ref}</p>}
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Dates</h4>
              <div className="space-y-3 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Issue Date</span>
                  <span className="font-medium">{formatTimestamp(invoice.invoiceDate, true)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Due Date</span>
                  <span className="font-medium">{formatTimestamp(invoice.invoiceDateDue, true)}</span>
                </div>
                {invoice.amountResidual > 0 && daysUntilDue !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Days Until Due</span>
                    <Badge variant={daysUntilDue < 0 ? "destructive" : daysUntilDue <= 7 ? "default" : "secondary"}>
                      {daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} days overdue` : `${daysUntilDue} days`}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Amounts breakdown */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Amounts</h4>
            <div className="border rounded-lg">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Subtotal (excl. tax)</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(invoice.amountUntaxed)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Tax</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(invoice.amountTax)}</TableCell>
                  </TableRow>
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-muted/50">
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold text-lg">{formatCurrency(invoice.amountTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          {/* Notes / Narration */}
          {invoice.invoiceOrigin && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">Origin</h4>
              <p className="text-sm p-3 rounded-lg bg-muted/50">{invoice.invoiceOrigin}</p>
            </div>
          )}

          {/* Activity */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Activity</h4>
            <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
              <div className="p-2 rounded-full bg-blue-500/10"><FileText className="h-4 w-4 text-blue-600" /></div>
              <div>
                <p className="font-medium">Invoice created</p>
                <p className="text-sm text-muted-foreground">Created on {formatTimestamp(invoice.createDate)}</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
