"use client"

import { useId, useLayoutEffect, useMemo, useState } from "react"
import type { CreateManualAccountInvoiceParams } from "@lumiere/query-hooks/hooks/accounting"
import type { CanonicalRecordRef, OperationEffectOutcome } from "@lumiere/query-hooks/hooks/operation-effect"
import { toCreateManualAccountInvoiceParams } from "@lumiere/erp-shared/accounting-create-params"
import { useTranslation } from "@lumiere/i18n"
import { Eye, FilePenLine, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { isCustomField } from "../forms/config/types"
import { useFormConfiguration } from "../forms/hooks/use-form-config"
import { cn } from "@/lib/utils"
import { formatInvoiceMoney, InvoiceDocument } from "./invoice-document"

export interface ManualInvoiceOption { value: string; label: string }
export interface ManualInvoiceJournalOption extends ManualInvoiceOption { currencyId: string }
export interface ManualInvoiceCurrencyOption extends ManualInvoiceOption { code?: string }
export interface ManualInvoiceAccountOption extends ManualInvoiceOption { allowedJournalIds?: string[] }
export interface ManualInvoiceTaxOption extends ManualInvoiceOption {
  amount: number
  amountType: "Percent" | "Fixed" | "Division"
}
export interface ManualInvoiceProductOption extends ManualInvoiceOption {
  description?: string
  price: number
  accountId?: string
  taxIds: string[]
}

interface LineItem {
  id: string; description: string; quantity: number; unitPrice: number; discount: number
  accountId: string; taxId: string; productId: string
}

const NONE = "__none__"
const newLine = (id = "1"): LineItem => ({
  id, description: "", quantity: 1, unitPrice: 0, discount: 0,
  accountId: "", taxId: "", productId: "",
})

function taxAmount(subtotal: number, tax?: ManualInvoiceTaxOption): number {
  if (!tax) return 0
  if (tax.amountType === "Fixed") return tax.amount
  if (tax.amountType === "Division") return tax.amount < 100 ? subtotal / (1 - tax.amount / 100) - subtotal : 0
  return subtotal * tax.amount / 100
}

interface CreateInvoiceModalProps {
  open: boolean
  kind?: "invoice" | "bill"
  companyId: bigint
  onClose: () => void
  onSave: (params: CreateManualAccountInvoiceParams) => Promise<OperationEffectOutcome<CanonicalRecordRef>>
  onCheckStatus: (params: CreateManualAccountInvoiceParams) => Promise<CanonicalRecordRef | null>
  onResolved?: (ref: CanonicalRecordRef) => void
  journalOptions: ManualInvoiceJournalOption[]
  partnerOptions: ManualInvoiceOption[]
  counterpartAccountOptions: ManualInvoiceAccountOption[]
  lineAccountOptions: ManualInvoiceAccountOption[]
  taxOptions?: ManualInvoiceTaxOption[]
  productOptions?: ManualInvoiceProductOption[]
  paymentTermOptions?: ManualInvoiceOption[]
  currencyOptions?: ManualInvoiceCurrencyOption[]
  organizationId?: number
  formId?: string
}

export function CreateInvoiceModal({
  open, kind = "invoice", companyId, onClose, onSave, onCheckStatus, onResolved,
  journalOptions, partnerOptions, counterpartAccountOptions, lineAccountOptions,
  taxOptions = [], productOptions = [], paymentTermOptions = [], currencyOptions = [], organizationId,
  formId = kind === "bill" ? "new-bill" : "new-invoice",
}: CreateInvoiceModalProps) {
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  const copyKey = kind === "bill" ? "newBill" : "newInvoice"
  const [partnerId, setPartnerId] = useState("")
  const [counterpartAccountId, setCounterpartAccountId] = useState("")
  const [journalId, setJournalId] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState("")
  const [paymentTermId, setPaymentTermId] = useState("")
  const [reference, setReference] = useState("")
  const [paymentReference, setPaymentReference] = useState("")
  const [notes, setNotes] = useState("")
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [lineItems, setLineItems] = useState<LineItem[]>([newLine()])
  const [requestId, setRequestId] = useState<string | null>(null)
  const [unknownParams, setUnknownParams] = useState<CreateManualAccountInvoiceParams | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit")
  const { config: formConfig } = useFormConfiguration({
    moduleId: "accounting", formId, organizationId: organizationId ?? 0, useDefaultIfMissing: true,
  })
  const customFields = useMemo(
    () => (formConfig?.fields ?? []).filter((field) => field.isEnabled && isCustomField(field.fieldId)),
    [formConfig?.fields],
  )
  const locked = unknownParams !== null

  useLayoutEffect(() => {
    if (!open || locked) return
    setJournalId((previous) => previous && journalOptions.some((option) => option.value === previous)
      ? previous : (journalOptions[0]?.value ?? ""))
  }, [journalOptions, locked, open])

  const journal = journalOptions.find((option) => option.value === journalId)
  const counterpartOptions = useMemo(
    () => counterpartAccountOptions.filter((option) =>
      !option.allowedJournalIds?.length || option.allowedJournalIds.includes(journalId)),
    [counterpartAccountOptions, journalId],
  )
  const commercialOptions = useMemo(
    () => lineAccountOptions.filter((option) =>
      !option.allowedJournalIds?.length || option.allowedJournalIds.includes(journalId)),
    [journalId, lineAccountOptions],
  )

  useLayoutEffect(() => {
    if (!open || locked) return
    setCounterpartAccountId((previous) => previous && counterpartOptions.some((option) => option.value === previous)
      ? previous : (counterpartOptions[0]?.value ?? ""))
    setLineItems((previous) => previous.map((line) => ({
      ...line,
      accountId: line.accountId && commercialOptions.some((option) => option.value === line.accountId)
        ? line.accountId : (commercialOptions[0]?.value ?? ""),
    })))
  }, [commercialOptions, counterpartOptions, locked, open])

  const updateLine = (id: string, patch: Partial<LineItem>) =>
    setLineItems((previous) => previous.map((line) => line.id === id ? { ...line, ...patch } : line))
  const chooseProduct = (line: LineItem, value: string) => {
    if (value === NONE) return updateLine(line.id, { productId: "" })
    const product = productOptions.find((option) => option.value === value)
    updateLine(line.id, {
      productId: value,
      description: product?.description || line.description,
      unitPrice: product?.price ?? line.unitPrice,
      accountId: product?.accountId || line.accountId,
      taxId: product?.taxIds[0] || line.taxId,
    })
  }
  const subtotal = lineItems.reduce((sum, line) =>
    sum + line.quantity * line.unitPrice * (1 - line.discount / 100), 0)
  const totalTax = lineItems.reduce((sum, line) => {
    const base = line.quantity * line.unitPrice * (1 - line.discount / 100)
    return sum + taxAmount(base, taxOptions.find((option) => option.value === line.taxId))
  }, 0)
  const currencyOption = currencyOptions.find((option) => option.value === journal?.currencyId)
  const currency = { id: journal?.currencyId, code: currencyOption?.code }
  const money = (value: number) => formatInvoiceMoney(value, currency)
  const requiredCustomOk = customFields.every((field) =>
    !field.validation.required || String(customValues[field.fieldId] ?? "").trim() !== "")
  const canSave = !locked && !saving && Boolean(journal && partnerId && counterpartAccountId)
    && lineItems.every((line) => line.description.trim() && line.accountId && line.quantity > 0 && line.unitPrice >= 0)
    && requiredCustomOk

  const buildParams = (): CreateManualAccountInvoiceParams => {
    if (!journal) throw new Error("Select an accounting journal")
    const idempotencyKey = requestId ?? crypto.randomUUID().replaceAll("-", "")
    if (!requestId) setRequestId(idempotencyKey)
    const custom = Object.fromEntries(
      customFields.map((field) => [field.fieldId, customValues[field.fieldId]] as const),
    )
    const metadata = notes.trim() || Object.values(custom).some((value) => value?.trim())
      ? JSON.stringify({ notes: notes.trim() || undefined, ...custom }) : undefined
    const params = toCreateManualAccountInvoiceParams({
      idempotencyKey, companyId,
      moveType: { tag: kind === "bill" ? "InInvoice" : "OutInvoice" },
      journalId: BigInt(journal.value), partnerId: BigInt(partnerId),
      counterpartAccountId: BigInt(counterpartAccountId), currencyId: BigInt(journal.currencyId),
      date: invoiceDate, invoiceDate,
      invoiceDateDue: dueDate || undefined,
      invoicePaymentTermId: paymentTermId ? BigInt(paymentTermId) : undefined,
      ref: reference.trim() || undefined, paymentReference: paymentReference.trim() || undefined,
      metadata,
      lines: lineItems.map((line) => ({
        accountId: BigInt(line.accountId), name: line.description.trim(), quantity: line.quantity,
        priceUnit: line.unitPrice, discount: line.discount,
        taxIds: line.taxId ? [BigInt(line.taxId)] : [],
        productId: line.productId ? BigInt(line.productId) : undefined,
      })),
    })
    if (!params) throw new Error("Complete the required invoice fields with valid values")
    return params
  }

  const reset = () => {
    setPartnerId(""); setCounterpartAccountId(""); setJournalId(""); setInvoiceDate(today)
    setDueDate(""); setPaymentTermId(""); setReference(""); setPaymentReference(""); setNotes("")
    setCustomValues({}); setLineItems([newLine()]); setRequestId(null); setUnknownParams(null); setError(null); setMobileView("edit")
  }
  const resolve = (ref: CanonicalRecordRef) => { reset(); onResolved?.(ref); onClose() }
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const params = buildParams()
      const outcome = await onSave(params)
      if (outcome.kind === "converged" || outcome.kind === "already-applied") resolve(outcome.ref)
      else if (outcome.kind === "rejected") setError(outcome.error.message)
      else {
        setUnknownParams(params)
        setError("The result is not confirmed. Check the previous action before trying again.")
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const checkStatus = async () => {
    if (!unknownParams) return
    setSaving(true); setError(null)
    try {
      const ref = await onCheckStatus(unknownParams)
      if (ref) resolve(ref)
      else setError("The invoice is still unconfirmed. Keep this form and check again later.")
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const close = () => { if (saving) return; if (!locked) reset(); onClose() }

  return <Dialog open={open} onOpenChange={(next) => !next && close()}>
    <DialogContent data-testid="create-invoice-modal" className="flex h-[min(94dvh,960px)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1480px,calc(100%-3rem))]">
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6"><DialogTitle className="text-xl font-semibold tracking-tight">{t(`accounting.forms.${copyKey}.createTitle`)}</DialogTitle><DialogDescription>Prepare the details and review the document before saving a draft.</DialogDescription></DialogHeader>
      <div className="flex shrink-0 gap-1 border-b p-2 lg:hidden" role="group" aria-label="Invoice workspace view">
        <Button type="button" variant={mobileView === "edit" ? "secondary" : "ghost"} aria-pressed={mobileView === "edit"} onClick={() => setMobileView("edit")}><FilePenLine className="mr-2 size-4" />Edit details</Button>
        <Button type="button" data-testid="create-invoice-preview-toggle" variant={mobileView === "preview" ? "secondary" : "ghost"} aria-pressed={mobileView === "preview"} onClick={() => setMobileView("preview")}><Eye className="mr-2 size-4" />Preview</Button>
      </div>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden">
      <div className={cn("min-w-0 overflow-y-auto px-5 py-6 sm:px-6 lg:block", mobileView === "preview" && "hidden")}>
      <fieldset disabled={locked || saving} className="space-y-6">
        <section className="space-y-4"><div><h3 className="font-semibold">Document details</h3><p className="mt-1 text-xs text-muted-foreground">Partner, journal and payment schedule</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.partner`)} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.journal`)} value={journalId} onChange={setJournalId} options={journalOptions} />
          <FieldSelect label={kind === "bill" ? "Payable account" : "Receivable account"} value={counterpartAccountId} onChange={setCounterpartAccountId} options={counterpartOptions} />
          <div className="space-y-2"><Label>Currency</Label><Input aria-label="Currency" value={currencyOption?.label ?? (journal ? `Currency #${journal.currencyId}` : "Select a journal")} readOnly /></div>
          <div className="space-y-2"><Label>{kind === "bill" ? "Bill date" : "Invoice date"}</Label><Input aria-label={kind === "bill" ? "Bill date" : "Invoice date"} type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div>
          <div className="space-y-2"><Label>{t(`accounting.forms.${copyKey}.fields.dueDate`)}</Label><Input aria-label={t(`accounting.forms.${copyKey}.fields.dueDate`)} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
          <FieldSelect label="Payment term (optional)" value={paymentTermId || NONE} onChange={(value) => setPaymentTermId(value === NONE ? "" : value)} options={[{ value: NONE, label: "None" }, ...paymentTermOptions]} />
          <div className="space-y-2"><Label>Reference</Label><Input aria-label="Reference" value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="space-y-2"><Label>Payment reference</Label><Input aria-label="Payment reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div>
        </div></section>
        {customFields.length ? <div className="grid gap-4 md:grid-cols-2">{customFields.map((field) =>
          <div key={field.fieldId} className="space-y-2"><Label>{field.label}{field.validation.required ? " *" : ""}</Label><Input data-testid={`create-invoice-custom-${field.fieldId}`} value={customValues[field.fieldId] ?? ""} onChange={(event) => setCustomValues((previous) => ({ ...previous, [field.fieldId]: event.target.value }))} /></div>)}</div> : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-t pt-5"><h3 className="font-semibold">{t("accounting.forms.newInvoice.lineItems")}</h3><Button type="button" variant="outline" size="sm" onClick={() => setLineItems((previous) => [...previous, newLine(crypto.randomUUID())])}><Plus className="mr-2 h-4 w-4" />{t("accounting.forms.newInvoice.addItem")}</Button></div>
          {lineItems.map((line, index) => <div key={line.id} className="rounded-lg border bg-muted/15 p-4">
            <div className="mb-4 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Item {index + 1}</span><Button type="button" aria-label={`Remove item ${index + 1}`} variant="ghost" size="icon" disabled={lineItems.length === 1} onClick={() => setLineItems((previous) => previous.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <FieldSelect label="Product" value={line.productId || NONE} onChange={(value) => chooseProduct(line, value)} options={[{ value: NONE, label: "No product" }, ...productOptions]} />
            <div className="space-y-2 xl:col-span-2"><Label>Description</Label><Input aria-label={`Item ${index + 1} description`} data-testid={index === 0 ? "create-invoice-line-description" : undefined} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></div>
            <FieldSelect label={kind === "bill" ? "Expense account" : "Income account"} value={line.accountId} onChange={(value) => updateLine(line.id, { accountId: value })} options={commercialOptions} />
            <div className="space-y-2"><Label>Qty</Label><Input aria-label={`Item ${index + 1} quantity`} type="number" min={0.000001} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Unit price</Label><Input aria-label={`Item ${index + 1} unit price`} data-testid={index === 0 ? "create-invoice-line-unit-price" : undefined} type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} /></div>
            <FieldSelect label="Tax" value={line.taxId || NONE} onChange={(value) => updateLine(line.id, { taxId: value === NONE ? "" : value })} options={[{ value: NONE, label: "No tax" }, ...taxOptions]} />
            <div className="space-y-2"><Label>Discount %</Label><Input aria-label={`Item ${index + 1} discount percent`} type="number" min={0} max={100} value={line.discount} onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) })} /></div>
          </div><div className="mt-4 flex justify-between border-t pt-3 text-sm"><span className="text-muted-foreground">Line amount</span><span className="font-medium tabular-nums">{money(line.quantity * line.unitPrice * (1 - line.discount / 100))}</span></div></div>)}
        </div>
        <div className="space-y-2"><Label>{t("accounting.forms.newInvoice.notesOptional")}</Label><Textarea aria-label={t("accounting.forms.newInvoice.notesOptional")} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></div>
      </fieldset>
      </div>
      <aside className={cn("min-w-0 overflow-y-auto bg-muted/40 p-4 sm:p-6 lg:block lg:border-l", mobileView === "edit" && "hidden")}><div className="mb-4 flex items-center gap-2 text-sm font-medium"><Eye className="size-4 text-muted-foreground" />Live preview</div><InvoiceDocument title={kind === "bill" ? "Vendor bill" : "Invoice"} reference={reference} partnerLabel={kind === "bill" ? "Vendor" : "Bill to"} partner={partnerOptions.find((option) => option.value === partnerId)?.label} date={invoiceDate} dueDate={dueDate} currency={currency} lines={lineItems} subtotal={subtotal} tax={totalTax} total={subtotal + totalTax} notes={notes} draft /></aside>
      </div>
      {error ? <p role="alert" className="shrink-0 border-t bg-destructive/5 px-5 py-3 text-sm text-destructive">{error}</p> : null}
      <DialogFooter className="m-0 shrink-0 flex-row flex-wrap items-center justify-between gap-3 rounded-none bg-background px-5 sm:justify-between sm:px-6"><div className="mr-auto text-sm"><span className="text-muted-foreground">Total</span><p className="font-semibold tabular-nums">{money(subtotal + totalTax)}</p></div><Button variant="outline" onClick={close} disabled={saving}>{locked ? "Close and keep draft" : t("common.cancel")}</Button>{locked
        ? <Button onClick={() => void checkStatus()} disabled={saving}>Check previous action</Button>
        : <Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>Save as Draft</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>
}

function FieldSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (value: string) => void; options: ManualInvoiceOption[]; testId?: string
}) {
  const id = useId()
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} data-testid={testId}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
}
