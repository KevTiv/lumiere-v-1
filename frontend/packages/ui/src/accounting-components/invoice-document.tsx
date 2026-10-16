import { cn } from "@/lib/utils"

export interface InvoiceCurrency {
  id?: string
  code?: string
}

/** Never infer a currency from a tenant-local ID or the browser locale. */
export function formatInvoiceMoney(amount: number | null | undefined, currency: InvoiceCurrency = {}): string {
  if (amount == null || !Number.isFinite(amount)) return "—"
  if (currency.code && /^[A-Z]{3}$/.test(currency.code)) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.code, currencyDisplay: "code" }).format(amount)
  }
  const value = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
  return `${value} · ${currency.id ? `Currency #${currency.id}` : "Currency not available"}`
}

interface InvoiceDocumentProps {
  title: string
  company?: string | null
  reference?: string | null
  partnerLabel: string
  partner?: string | null
  date?: string | null
  dueDate?: string | null
  currency?: InvoiceCurrency
  lines?: { id: string; description: string; quantity: number | null; unitPrice: number | null; discount: number | null; amount?: number | null }[]
  subtotal: number | null
  tax: number | null
  total: number | null
  notes?: string
  draft?: boolean
  className?: string
}

/** Document-style summary; generated PDF remains the authoritative printable output. */
export function InvoiceDocument({ title, company, reference, partnerLabel, partner, date, dueDate, currency, lines, subtotal, tax, total, notes, draft, className }: InvoiceDocumentProps) {
  const money = (amount: number | null | undefined) => formatInvoiceMoney(amount, currency)
  const lineAmount = (line: NonNullable<InvoiceDocumentProps["lines"]>[number]) => {
    // Persisted null means unavailable; only unsaved draft lines omit amount.
    if (line.amount !== undefined) return line.amount
    if (line.quantity == null || line.unitPrice == null || line.discount == null) return null
    return line.quantity * line.unitPrice * (1 - line.discount / 100)
  }
  return <article aria-label="Document preview" className={cn("min-w-0 rounded-lg border bg-card p-5 text-card-foreground shadow-sm sm:p-8", className)}>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
      <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{draft ? "Draft document" : "Accounting document"}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>{company ? <p className="mt-2 text-sm text-muted-foreground">{company}</p> : null}</div>
      <p className="max-w-full break-words font-mono text-sm text-muted-foreground">{reference || "Reference pending"}</p>
    </header>
    <div className="grid gap-5 py-6 sm:grid-cols-2">
      <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{partnerLabel}</p><p className="mt-2 break-words font-medium">{partner || "Select a partner"}</p></div>
      <dl className="space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Issue date</dt><dd>{date || "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Due date</dt><dd>{dueDate || "—"}</dd></div></dl>
    </div>
    {lines ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground"><th className="p-2 font-medium">Description</th><th className="p-2 text-right font-medium">Qty</th><th className="p-2 text-right font-medium">Amount</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b"><td className="min-w-24 break-words p-2">{line.description || "Item description"}{line.discount != null && line.discount > 0 ? <span className="block text-xs text-muted-foreground">{line.discount}% discount</span> : null}</td><td className="p-2 text-right tabular-nums">{line.quantity ?? "—"}</td><td className="p-2 text-right tabular-nums">{money(lineAmount(line))}</td></tr>)}</tbody></table></div> : null}
    <dl className="ml-auto mt-6 max-w-sm space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Subtotal</dt><dd className="text-right tabular-nums">{money(subtotal)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tax</dt><dd className="text-right tabular-nums">{money(tax)}</dd></div><div className="flex justify-between gap-4 border-t pt-4 text-base font-semibold"><dt>Total</dt><dd className="text-right tabular-nums">{money(total)}</dd></div></dl>
    {notes ? <section className="mt-8 border-t pt-5"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{notes}</p></section> : null}
    {draft ? <p className="mt-8 text-xs text-muted-foreground">Draft preview. Review and confirm totals before posting.</p> : null}
  </article>
}
