"use client"

import { useLayoutEffect, useMemo, useState } from "react"
import type { CreateManualAccountInvoiceParams } from "@lumiere/query-hooks/hooks/accounting"
import type { CanonicalRecordRef, OperationEffectOutcome } from "@lumiere/query-hooks/hooks/operation-effect"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { useTranslation } from "@lumiere/i18n"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { isCustomField } from "../forms/config/types"
import { useFormConfiguration } from "../forms/hooks/use-form-config"

export interface ManualInvoiceOption { value: string; label: string }
export interface ManualInvoiceJournalOption extends ManualInvoiceOption { currencyId: string }
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

const formTimestamp = (value: string) => stbTimestampFromDate(new Date(`${value}T00:00:00.000Z`))

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
  organizationId?: number
  formId?: string
}

export function CreateInvoiceModal({
  open, kind = "invoice", companyId, onClose, onSave, onCheckStatus, onResolved,
  journalOptions, partnerOptions, counterpartAccountOptions, lineAccountOptions,
  taxOptions = [], productOptions = [], paymentTermOptions = [], organizationId,
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
  const money = (value: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(value)
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
    return {
      idempotencyKey, companyId,
      moveType: { tag: kind === "bill" ? "InInvoice" : "OutInvoice" },
      journalId: BigInt(journal.value), partnerId: BigInt(partnerId),
      counterpartAccountId: BigInt(counterpartAccountId), currencyId: BigInt(journal.currencyId),
      date: formTimestamp(invoiceDate), invoiceDate: formTimestamp(invoiceDate),
      invoiceDateDue: dueDate ? formTimestamp(dueDate) : undefined,
      invoicePaymentTermId: paymentTermId ? BigInt(paymentTermId) : undefined,
      ref: reference.trim() || undefined, paymentReference: paymentReference.trim() || undefined,
      metadata,
      lines: lineItems.map((line) => ({
        accountId: BigInt(line.accountId), name: line.description.trim(), quantity: line.quantity,
        priceUnit: line.unitPrice, discount: line.discount,
        taxIds: line.taxId ? [BigInt(line.taxId)] : [],
        productId: line.productId ? BigInt(line.productId) : undefined,
      })),
    }
  }

  const reset = () => {
    setPartnerId(""); setCounterpartAccountId(""); setJournalId(""); setInvoiceDate(today)
    setDueDate(""); setPaymentTermId(""); setReference(""); setPaymentReference(""); setNotes("")
    setCustomValues({}); setLineItems([newLine()]); setRequestId(null); setUnknownParams(null); setError(null)
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
  const close = () => { if (!locked) reset(); onClose() }

  return <Dialog open={open} onOpenChange={(next) => !next && close()}>
    <DialogContent data-testid="create-invoice-modal" className="max-h-[90vh] max-w-5xl overflow-y-auto sm:max-w-5xl">
      <DialogHeader><DialogTitle>{t(`accounting.forms.${copyKey}.createTitle`)}</DialogTitle></DialogHeader>
      <fieldset disabled={locked || saving} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.partner`)} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.journal`)} value={journalId} onChange={setJournalId} options={journalOptions} />
          <FieldSelect label={kind === "bill" ? "Payable account" : "Receivable account"} value={counterpartAccountId} onChange={setCounterpartAccountId} options={counterpartOptions} />
          <div className="space-y-2"><Label>Currency ID</Label><Input value={journal?.currencyId ?? ""} readOnly /></div>
          <div className="space-y-2"><Label>{kind === "bill" ? "Bill date" : "Invoice date"}</Label><Input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div>
          <div className="space-y-2"><Label>{t(`accounting.forms.${copyKey}.fields.dueDate`)}</Label><Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
          <FieldSelect label="Payment term (optional)" value={paymentTermId || NONE} onChange={(value) => setPaymentTermId(value === NONE ? "" : value)} options={[{ value: NONE, label: "None" }, ...paymentTermOptions]} />
          <div className="space-y-2"><Label>Reference</Label><Input value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="space-y-2"><Label>Payment reference</Label><Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div>
        </div>
        {customFields.length ? <div className="grid gap-4 md:grid-cols-2">{customFields.map((field) =>
          <div key={field.fieldId} className="space-y-2"><Label>{field.label}{field.validation.required ? " *" : ""}</Label><Input data-testid={`create-invoice-custom-${field.fieldId}`} value={customValues[field.fieldId] ?? ""} onChange={(event) => setCustomValues((previous) => ({ ...previous, [field.fieldId]: event.target.value }))} /></div>)}</div> : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between"><Label>{t("accounting.forms.newInvoice.lineItems")}</Label><Button type="button" variant="outline" size="sm" onClick={() => setLineItems((previous) => [...previous, newLine(crypto.randomUUID())])}><Plus className="mr-2 h-4 w-4" />{t("accounting.forms.newInvoice.addItem")}</Button></div>
          {lineItems.map((line, index) => <div key={line.id} className="grid gap-2 rounded-md border p-3 md:grid-cols-7">
            <FieldSelect label="Product" value={line.productId || NONE} onChange={(value) => chooseProduct(line, value)} options={[{ value: NONE, label: "No product" }, ...productOptions]} />
            <div className="space-y-2 md:col-span-2"><Label>Description</Label><Input data-testid={index === 0 ? "create-invoice-line-description" : undefined} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></div>
            <FieldSelect label={kind === "bill" ? "Expense account" : "Income account"} value={line.accountId} onChange={(value) => updateLine(line.id, { accountId: value })} options={commercialOptions} />
            <div className="space-y-2"><Label>Qty</Label><Input type="number" min={0.000001} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Unit price</Label><Input data-testid={index === 0 ? "create-invoice-line-unit-price" : undefined} type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} /></div>
            <div className="flex items-end gap-1"><FieldSelect label="Tax" value={line.taxId || NONE} onChange={(value) => updateLine(line.id, { taxId: value === NONE ? "" : value })} options={[{ value: NONE, label: "No tax" }, ...taxOptions]} /><Button type="button" variant="ghost" size="icon" disabled={lineItems.length === 1} onClick={() => setLineItems((previous) => previous.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="space-y-2"><Label>Discount %</Label><Input type="number" min={0} max={100} value={line.discount} onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) })} /></div>
          </div>)}
          <div className="text-right text-sm">Subtotal: {money(subtotal)} · Tax: {money(totalTax)} · <strong>Total: {money(subtotal + totalTax)}</strong></div>
        </div>
        <div className="space-y-2"><Label>{t("accounting.forms.newInvoice.notesOptional")}</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></div>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" onClick={close}>{t("common.cancel")}</Button>{locked
        ? <Button onClick={() => void checkStatus()} disabled={saving}>Check previous action</Button>
        : <Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>Save as Draft</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>
}

function FieldSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (value: string) => void; options: ManualInvoiceOption[]; testId?: string
}) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger data-testid={testId}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
}
