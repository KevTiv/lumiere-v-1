"use client"

import { useTranslation } from "@lumiere/i18n"
import { cn } from "../lib/utils"
import type { InvoiceTotals } from "./invoice-math"

export interface InvoicePreviewLine {
  key: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  taxLabel?: string
  total: number
}

export interface InvoicePreviewModel {
  kind: "invoice" | "bill"
  /** Document number; empty while the document is still a draft being composed. */
  number?: string
  statusLabel?: string
  partnerName?: string
  invoiceDate?: string
  dueDate?: string
  reference?: string
  paymentReference?: string
  currencyCode?: string
  lines: InvoicePreviewLine[]
  totals: InvoiceTotals
  /** Amount still unpaid, shown under the total when it differs. */
  amountDue?: number
  notes?: string
}

export function formatInvoiceAmount(value: number, currencyCode?: string): string {
  try {
    return new Intl.NumberFormat(undefined, currencyCode && /^[A-Za-z]{3}$/.test(currencyCode)
      ? { style: "currency", currency: currencyCode.toUpperCase() }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

function formatDate(value?: string): string {
  if (!value) return "—"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed)
}

/**
 * The invoice as a printable sheet. Always light-on-white so a printout matches the screen in
 * dark mode too.
 */
export function InvoicePreview({
  model,
  className,
  printRoot = false,
}: {
  model: InvoicePreviewModel
  className?: string
  /** Marks this sheet as the one the print stylesheet isolates; use `PrintableInvoice` instead. */
  printRoot?: boolean
}) {
  const { t } = useTranslation()
  const money = (value: number) => formatInvoiceAmount(value, model.currencyCode)
  const title = model.kind === "bill" ? t("accounting.authoring.bill", { defaultValue: "Bill" }) : t("accounting.manualInvoice.invoiceTitle", { defaultValue: "Invoice" })
  return (
    <article
      data-testid="invoice-preview"
      data-invoice-print-root={printRoot ? "" : undefined}
      className={cn(
        "mx-auto w-full max-w-3xl rounded-xl border border-border bg-white p-6 text-sm text-neutral-900 shadow-sm sm:p-8",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-neutral-500">{model.number || t("accounting.invoicePreview.draftNumberAssignedOnPosting", { defaultValue: "Draft — number assigned on posting" })}</p>
        </div>
        {model.statusLabel ? (
          <span className="rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium">
            {model.statusLabel}
          </span>
        ) : null}
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            {model.kind === "bill" ? t("accounting.workflowGuide.vendor", { defaultValue: "Vendor" }) : t("accounting.createInvoiceModal.billTo", { defaultValue: "Bill to" })}
          </p>
          <p className="mt-1 font-medium">{model.partnerName || "—"}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-right sm:text-left">
          <dt className="text-neutral-500">{model.kind === "bill" ? t("accounting.createInvoiceModal.billDate", { defaultValue: "Bill date" }) : t("accounting.invoicePreview.issued", { defaultValue: "Issued" })}</dt>
          <dd className="font-medium">{formatDate(model.invoiceDate)}</dd>
          <dt className="text-neutral-500">{t("accounting.overview.due", { defaultValue: "Due" })}</dt>
          <dd className="font-medium">{formatDate(model.dueDate)}</dd>
          {model.reference ? (
            <>
              <dt className="text-neutral-500">{t("accounting.journalEntries.ref", { defaultValue: "Reference" })}</dt>
              <dd className="font-medium">{model.reference}</dd>
            </>
          ) : null}
          {model.paymentReference ? (
            <>
              <dt className="text-neutral-500">{t("accounting.invoicePreview.paymentRef", { defaultValue: "Payment ref." })}</dt>
              <dd className="font-medium">{model.paymentReference}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-2 font-medium">{t("accounting.taxSchedules.columns.description", { defaultValue: "Description" })}</th>
              <th className="px-2 py-2 text-right font-medium">{t("accounting.forms.newInvoice.columns.qty", { defaultValue: "Qty" })}</th>
              <th className="px-2 py-2 text-right font-medium">{t("accounting.invoicePreview.price", { defaultValue: "Price" })}</th>
              <th className="py-2 pl-2 text-right font-medium">{t("accounting.invoices.amount", { defaultValue: "Amount" })}</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-neutral-500">
                  {t("accounting.invoicePreview.noLinesYet", { defaultValue: "No lines yet." })}</td>
              </tr>
            ) : (
              model.lines.map((line) => (
                <tr key={line.key} className="border-b border-neutral-200 align-top">
                  <td className="py-2 pr-2">
                    <span className="font-medium">{line.description || "—"}</span>
                    {line.discount > 0 || line.taxLabel ? (
                      <span className="block text-xs text-neutral-500">
                        {[line.discount > 0 ? `${line.discount}% off` : "", line.taxLabel ?? ""].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
                  <td className="py-2 pl-2 text-right font-medium tabular-nums">{money(line.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1">
        <dt className="text-neutral-500">{t("accounting.forms.newInvoice.summary.subtotal", { defaultValue: "Subtotal" })}</dt>
        <dd className="text-right tabular-nums">{money(model.totals.subtotal)}</dd>
        {model.totals.taxBreakdown.length > 0
          ? model.totals.taxBreakdown.map((entry) => (
              <div key={entry.label} className="contents">
                <dt className="text-neutral-500">{entry.label}</dt>
                <dd className="text-right tabular-nums">{money(entry.amount)}</dd>
              </div>
            ))
          : (
              <>
                <dt className="text-neutral-500">{t("accounting.forms.newInvoice.summary.tax", { defaultValue: "Tax" })}</dt>
                <dd className="text-right tabular-nums">{money(model.totals.tax)}</dd>
              </>
            )}
        <dt className="mt-1 border-t border-neutral-300 pt-2 font-semibold">{t("common.entityView.pivotTotal", { defaultValue: "Total" })}</dt>
        <dd className="mt-1 border-t border-neutral-300 pt-2 text-right text-base font-semibold tabular-nums">
          {money(model.totals.total)}
        </dd>
        {model.amountDue !== undefined && Math.abs(model.amountDue - model.totals.total) > 0.005 ? (
          <>
            <dt className="text-neutral-500">{t("accounting.workflowGuide.amountDue", { defaultValue: "Amount due" })}</dt>
            <dd className="text-right font-medium tabular-nums">{money(model.amountDue)}</dd>
          </>
        ) : null}
      </dl>

      {model.notes?.trim() ? (
        <section className="mt-6 border-t border-neutral-200 pt-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">{t("common.notes", { defaultValue: "Notes" })}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{model.notes}</p>
        </section>
      ) : null}
    </article>
  )
}
