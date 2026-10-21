import { cn } from "@/lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"
import { invoiceBuyerSnapshot, isManagedInvoiceLogoUrl, parseInvoiceContent, parseInvoiceDocumentSnapshot, parseInvoiceNotes, resolveInvoiceContent, type InvoiceDocumentSnapshot, type InvoicePersonalizationProfile } from "@lumiere/erp-shared/invoice-personalization"

/** Issued content never inherits settings published after the document was captured. */
export function readInvoiceDocumentContent(metadata: unknown, organizationId?: number | string | bigint, personalized = true) {
  const snapshot = personalized ? parseInvoiceDocumentSnapshot(metadata, organizationId) : { status: "missing" as const }
  if (snapshot.status === "valid") return { personalization: snapshot.value, notes: snapshot.value.notes, personalizationError: undefined }
  if (snapshot.status === "invalid") return { personalization: null, notes: "", personalizationError: snapshot.error }
  const notes = parseInvoiceNotes(metadata)
  return {
    personalization: null,
    notes: notes.status === "valid" ? notes.value : "",
    personalizationError: notes.status === "invalid" ? notes.error : undefined,
  }
}

/** Draft review follows current trusted defaults while keeping explicit document clears/overrides. */
export function resolveDraftInvoiceDocument(metadata: unknown, profile: InvoicePersonalizationProfile, profileVersionIds: InvoiceDocumentSnapshot["profileVersionIds"], seller: InvoiceDocumentSnapshot["seller"]) {
  const content = parseInvoiceContent(metadata)
  const notes = parseInvoiceNotes(metadata)
  const captured = parseInvoiceDocumentSnapshot(metadata)
  if (content.status === "invalid" || notes.status === "invalid") return { personalization: null, personalizationError: content.status === "invalid" ? content.error : notes.status === "invalid" ? notes.error : undefined }
  if (captured.status === "invalid") return { personalization: null, personalizationError: captured.error }
  const capturedBuyer = captured.status === "valid" ? invoiceBuyerSnapshot(captured.value) : null
  const reviewedBuyer = capturedBuyer?.status === "valid" ? capturedBuyer.value : undefined
  return {
    personalization: { ...(reviewedBuyer ? { schemaVersion: 2 as const, buyer: reviewedBuyer } : { schemaVersion: 1 as const }), profileVersionIds, seller, profile: resolveInvoiceContent(profile, content.status === "valid" ? content.value : undefined), notes: notes.status === "valid" ? notes.value : "" } satisfies InvoiceDocumentSnapshot,
    personalizationError: undefined,
  }
}

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
  /** Server-owned document content for issued records; resolved draft content for previews. */
  personalization?: InvoiceDocumentSnapshot | null
  personalizationError?: string
  draft?: boolean
  className?: string
}

/** Document-style summary; generated PDF remains the authoritative printable output. */
export function InvoiceDocument({ title, company, reference, partnerLabel, partner, date, dueDate, currency, lines, subtotal, tax, total, notes, personalization, personalizationError, draft, className }: InvoiceDocumentProps) {
  const money = (amount: number | null | undefined) => formatInvoiceMoney(amount, currency)
  const lineAmount = (line: NonNullable<InvoiceDocumentProps["lines"]>[number]) => {
    // Persisted null means unavailable; only unsaved draft lines omit amount.
    if (line.amount !== undefined) return line.amount
    if (line.quantity == null || line.unitPrice == null || line.discount == null) return null
    return line.quantity * line.unitPrice * (1 - line.discount / 100)
  }
  const profile = personalization?.profile
  const seller = personalization?.seller
  const buyerRead = personalization ? invoiceBuyerSnapshot(personalization) : null
  const buyer = buyerRead?.status === "valid" ? buyerRead.value : null
  const accent = ({ teal: "#14635d", blue: "#2457a6", slate: "#334155", violet: "#6941a5", "": "#334155" } as const)[profile?.accent ?? "slate"]
  const logo = profile?.logoUrl && isManagedInvoiceLogoUrl(profile.logoUrl) ? profile.logoUrl : undefined
  const documentNotes = personalization?.notes ?? notes
  const contentSection = (label: string, content: string | undefined) => content ? <section className="mt-6 min-w-0 border-t border-slate-200 pt-4" aria-label={label}>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</h3>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{content}</p>
  </section> : null
  return <article aria-label="Document preview" data-testid="invoice-document" className={cn(workspaceStyles.document, "min-w-0 p-4 [overflow-wrap:anywhere] sm:p-8", className)} style={{ backgroundColor: "#ffffff", color: "#1e293b", borderColor: "#cbd5e1", borderTopColor: accent, colorScheme: "light" }}>
    {personalizationError ? <p role="alert" className="mb-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{personalizationError}</p> : null}
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
      <div className="min-w-0 grow basis-64">
        {logo ? <img src={logo} alt={seller?.name ? `${seller.name} logo` : "Company logo"} className="mb-4 max-h-20 max-w-full object-contain object-left" /> : null}
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-600">{draft ? "Draft document" : "Accounting document"}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]" style={{ color: accent }}>{title}</h2>
        {seller?.name || company ? <p className="mt-3 font-semibold">{seller?.name || company}</p> : null}
        {seller ? <div className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600" aria-label="Seller details">
          {seller.address.map((line, index) => <p key={index}>{line}</p>)}
          {seller.taxId ? <p>Tax ID: {seller.taxId}</p> : null}
          {seller.registrationNumber ? <p>Registration number: {seller.registrationNumber}</p> : null}
          {seller.email ? <p>Email: {seller.email}</p> : null}
          {seller.phone ? <p>Phone: {seller.phone}</p> : null}
          {seller.website ? <p>Website: {seller.website}</p> : null}
        </div> : null}
      </div>
      <p className="max-w-full font-mono text-sm text-slate-600 [overflow-wrap:anywhere]">{reference || "Reference pending"}</p>
    </header>
    <div className="grid gap-5 py-6 sm:grid-cols-2">
      <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-slate-600">{partnerLabel}</p><p className="mt-2 font-medium [overflow-wrap:anywhere]">{buyer?.name || partner || "Select a partner"}</p>
        {buyer ? <div className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600" aria-label="Captured customer billing details">
          {buyer.address.map((line, index) => <p key={index}>{line}</p>)}
          {buyer.taxId ? <p>Tax ID: {buyer.taxId}</p> : null}
          {buyer.registrationNumber ? <p>Registration number: {buyer.registrationNumber}</p> : null}
          {buyer.email ? <p>Email: {buyer.email}</p> : null}
          {buyer.phone ? <p>Phone: {buyer.phone}</p> : null}
          {draft ? <p className="pt-2">Captured when this draft was created. Posting refreshes billing details from the linked customer.</p> : null}
        </div> : personalization ? <p className="mt-2 text-xs leading-relaxed text-slate-600">{draft ? "Customer billing details are unavailable in this preview." : "Customer billing details were not captured on this document."}</p> : null}
      </div>
      <dl className="min-w-0 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-slate-600">Issue date</dt><dd>{date || "—"}</dd></div><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-slate-600">Due date</dt><dd>{dueDate || "—"}</dd></div></dl>
    </div>
    {profile?.notice ? <section aria-label="Notice" className="mb-6 rounded-md border p-3" style={{ borderColor: accent }}><h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>Notice</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{profile.notice}</p></section> : null}
    {lines ? <div className="min-w-0 overflow-x-auto"><table className="w-full table-fixed text-sm"><thead><tr className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-600"><th className="w-[43%] p-2 font-medium">Description</th><th className="w-[16%] p-2 text-right font-medium">Qty</th><th className="p-2 text-right font-medium">Amount</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id} className="border-b border-slate-200"><td className="p-2 align-top [overflow-wrap:anywhere]">{line.description || "Item description"}{line.discount != null && line.discount > 0 ? <span className="block text-xs text-slate-600">{line.discount}% discount</span> : null}</td><td className="p-2 text-right align-top tabular-nums [overflow-wrap:anywhere]">{line.quantity ?? "—"}</td><td className="p-2 text-right align-top tabular-nums [overflow-wrap:anywhere]">{money(lineAmount(line))}</td></tr>)}</tbody></table></div> : null}
    <dl className="ml-auto mt-6 max-w-sm space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-600">Subtotal</dt><dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{money(subtotal)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-600">Tax</dt><dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{money(tax)}</dd></div><div className="flex justify-between gap-4 border-t border-slate-200 pt-4 text-base font-semibold"><dt>Total</dt><dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{money(total)}</dd></div></dl>
    {contentSection("Notes", documentNotes)}
    {contentSection("Terms", profile?.terms)}
    {contentSection("Payment instructions", profile?.paymentInstructions)}
    {contentSection("Footer", profile?.footer)}
    {draft ? <p className="mt-8 text-xs text-slate-600">Draft preview. Review and confirm totals before posting.</p> : null}
  </article>
}
