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
  Calculator,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { invoiceStatusBadgeClass } from "../lib/theme-colors"
import type { AccountMove } from "../lib/accounting-types"
import { microsSinceEpochToDate, moveTypeIsInvoiceOrRefund } from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null, long = false): string {
  if (!ts) return "—"
  const ms = Number(ts.microsSinceUnixEpoch) / 1000
  return new Date(ms).toLocaleDateString("en-US", long
    ? { month: "long", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }
  )
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)

function moveStateStr(state: unknown): string {
  if (state != null && typeof state === "object" && "tag" in state) {
    return String((state as { tag: string }).tag)
  }
  return String(state ?? "")
}

interface InvoiceDetailModalProps {
  invoice: AccountMove | null
  open: boolean
  onClose: () => void
  onPostDraft?: () => void
  onRecordPayment?: () => void
  onRecalculateTotals?: () => void
  postDraftPending?: boolean
  recordPaymentPending?: boolean
  recalculateTotalsPending?: boolean
}

export function InvoiceDetailModal({
  invoice,
  open,
  onClose,
  onPostDraft,
  onRecordPayment,
  onRecalculateTotals,
  postDraftPending,
  recordPaymentPending,
  recalculateTotalsPending,
}: InvoiceDetailModalProps) {
  const { t } = useTranslation()

  const getStatusBadge = (move: AccountMove) => {
    const state = moveStateStr(move.state)
    const paymentState = moveStateStr(move.paymentState)
    if (state === "Cancelled") {
      return { label: t("accounting.states.cancelled"), cls: invoiceStatusBadgeClass.cancelled }
    }
    if (state === "Draft") {
      return { label: t("accounting.states.draft"), cls: invoiceStatusBadgeClass.draft }
    }
    if (paymentState === "Paid") {
      return { label: t("accounting.states.paid"), cls: invoiceStatusBadgeClass.paid }
    }
    if (move.amountResidual > 0 && move.invoiceDateDue) {
      const due = microsSinceEpochToDate(move.invoiceDateDue)
      if (due != null && due < new Date()) {
        return { label: t("accounting.states.overdue"), cls: invoiceStatusBadgeClass.overdue }
      }
    }
    if (paymentState === "InPayment") {
      return { label: t("accounting.states.partial"), cls: invoiceStatusBadgeClass.partial }
    }
    return { label: t("accounting.states.sent"), cls: invoiceStatusBadgeClass.sent }
  }

  if (!invoice) return null

  const { label, cls } = getStatusBadge(invoice)
  const stateStr = moveStateStr(invoice.state)
  const isDraft = stateStr === "Draft"
  const isPosted = stateStr === "Posted"
  const canRecordPayment =
    Boolean(onRecordPayment) && isPosted && invoice.amountResidual > 0

  const getDaysUntilDue = () => {
    const due = microsSinceEpochToDate(invoice.invoiceDateDue)
    if (due == null) return null
    return Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  }
  const daysUntilDue = getDaysUntilDue()

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="invoice-detail-modal">
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
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" type="button" disabled>
              <Send className="h-4 w-4" />{t("accounting.invoices.invoiceActions.send")}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" type="button" disabled>
              <Download className="h-4 w-4" />{t("accounting.invoices.invoiceActions.download")}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" type="button" disabled>
              <Printer className="h-4 w-4" />{t("accounting.invoices.invoiceActions.print")}
            </Button>
            {isDraft &&
              moveTypeIsInvoiceOrRefund(invoice.moveType) &&
              onRecalculateTotals && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={recalculateTotalsPending}
                  onClick={() => onRecalculateTotals()}
                >
                  <Calculator className="h-4 w-4" />
                  {t("accounting.invoices.invoiceActions.recalculateTotals")}
                </Button>
              )}
            {isDraft && onPostDraft && (
              <Button
                type="button"
                size="sm"
                className="gap-2"
                data-testid="invoice-detail-post-draft"
                disabled={postDraftPending}
                onClick={() => onPostDraft()}
              >
                {t("accounting.invoices.invoiceActions.postDraft")}
              </Button>
            )}
          </div>
          {canRecordPayment && (
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={recordPaymentPending}
              onClick={() => onRecordPayment?.()}
            >
              <DollarSign className="h-4 w-4" />{t("accounting.invoices.invoiceActions.recordPayment")}
            </Button>
          )}
        </div>

        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-info/10"><DollarSign className="h-5 w-5 text-info" /></div>
                <div><p className="text-sm text-muted-foreground">{t("accounting.invoices.totalAmount")}</p><p className="text-xl font-bold">{formatCurrency(invoice.amountTotal)}</p></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/10"><CheckCircle2 className="h-5 w-5 text-success" /></div>
                <div><p className="text-sm text-muted-foreground">{t("accounting.invoices.amountPaid")}</p><p className="text-xl font-bold text-success">{formatCurrency(invoice.amountTotal - invoice.amountResidual)}</p></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", invoice.amountResidual > 0 ? "bg-warning/10" : "bg-muted")}>
                  <Clock className={cn("h-5 w-5", invoice.amountResidual > 0 ? "text-warning" : "text-muted-foreground")} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("accounting.invoices.balanceDue")}</p>
                  <p className={cn("text-xl font-bold", invoice.amountResidual > 0 ? "text-warning" : "text-muted-foreground")}>
                    {formatCurrency(invoice.amountResidual)}
                  </p>
                </div>
              </div>
            </CardContent></Card>
          </div>

          {/* Partner & Dates */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{t("accounting.invoices.billTo")}</h4>
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
                <Building className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium">{invoice.invoicePartnerDisplayName ?? `Partner #${invoice.partnerId}`}</p>
                  {invoice.ref && <p className="text-sm text-muted-foreground">Ref: {invoice.ref}</p>}
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{t("accounting.invoices.dates")}</h4>
              <div className="space-y-3 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("accounting.invoices.issueDate")}</span>
                  <span className="font-medium">{formatTimestamp(invoice.invoiceDate, true)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("accounting.invoices.dueDate")}</span>
                  <span className="font-medium">{formatTimestamp(invoice.invoiceDateDue, true)}</span>
                </div>
                {invoice.amountResidual > 0 && daysUntilDue !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t("accounting.invoices.daysUntilDue")}</span>
                    <Badge variant={daysUntilDue < 0 ? "destructive" : daysUntilDue <= 7 ? "default" : "secondary"}>
                      {daysUntilDue < 0
                        ? t("accounting.invoices.daysOverdue", { count: Math.abs(daysUntilDue) })
                        : t("accounting.invoices.daysRemaining", { count: daysUntilDue })}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Amounts breakdown */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">{t("accounting.invoices.amounts")}</h4>
            <div className="border rounded-lg">
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground">{t("accounting.invoices.subtotalExclTax")}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(invoice.amountUntaxed)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">{t("accounting.forms.newInvoice.summary.tax")}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(invoice.amountTax)}</TableCell>
                  </TableRow>
                </TableBody>
                <TableFooter>
                  <TableRow className="bg-muted/50">
                    <TableCell className="font-bold">{t("accounting.forms.newInvoice.summary.total")}</TableCell>
                    <TableCell className="text-right font-bold text-lg">{formatCurrency(invoice.amountTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>

          {/* Notes / Narration */}
          {invoice.invoiceOrigin && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{t("accounting.invoices.origin")}</h4>
              <p className="text-sm p-3 rounded-lg bg-muted/50">{invoice.invoiceOrigin}</p>
            </div>
          )}

          {/* Activity */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">{t("accounting.invoices.activity")}</h4>
            <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/50">
              <div className="p-2 rounded-full bg-info/10"><FileText className="h-4 w-4 text-info" /></div>
              <div>
                <p className="font-medium">{t("accounting.invoices.invoiceCreated")}</p>
                <p className="text-sm text-muted-foreground">{t("accounting.invoices.createdOn", { date: formatTimestamp(invoice.createDate) })}</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
