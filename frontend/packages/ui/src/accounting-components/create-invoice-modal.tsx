"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CreateManualAccountInvoiceParams } from "@lumiere/query-hooks/hooks/accounting"
import type { CanonicalRecordRef, OperationEffectOutcome } from "@lumiere/query-hooks/hooks/operation-effect"
import { toCreateManualAccountInvoiceParams } from "@lumiere/erp-shared/accounting-create-params"
import { useTranslation } from "@lumiere/i18n"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "../components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"
import { FinanceReviewWorkspace } from "../composed/finance-review-workspace"
import { isCustomField } from "../forms/config/types"
import { useFormConfiguration } from "../forms/hooks/use-form-config"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

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

export interface InvoiceTaxOption extends ManualInvoiceOption {
  rate: number
  priceIncluded?: boolean
}

export interface InvoiceFormLine {
  id: string
  accountId: bigint
  description: string
  quantity: number
  unitPrice: number
  taxId?: bigint
  taxRate: number
  taxPriceIncluded: boolean
  discount: number
  amountUntaxed: number
  amountTax: number
  amountTotal: number
}

export interface InvoiceFormPayload {
  [key: string]: unknown
  type: "invoice-draft"
  idempotencyKey: string
  moveType: "OutInvoice" | "InInvoice"
  date: string
  invoiceDate: string
  invoiceDateDue?: string
  dueDate?: string
  partnerId: bigint
  invoicePartnerDisplayName: string
  journalId: bigint
  currencyId: bigint
  counterpartAccountId: bigint
  lineItems: InvoiceFormLine[]
  amountUntaxed: number
  amountTax: number
  amountTotal: number
  amountResidual: number
  metadata: string
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

interface ReleasedCreateInvoiceModalProps {
  open: boolean
  kind?: "invoice" | "bill"
  companyId: bigint
  companyLabel?: string
  currencyOptions?: readonly ManualInvoiceOption[]
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

function ReleasedCreateInvoiceModal({
  open, kind = "invoice", companyId, companyLabel, currencyOptions = [], onClose, onSave, onCheckStatus, onResolved,
  journalOptions, partnerOptions, counterpartAccountOptions, lineAccountOptions,
  taxOptions = [], productOptions = [], paymentTermOptions = [], organizationId,
  formId = kind === "bill" ? "new-bill" : "new-invoice",
}: ReleasedCreateInvoiceModalProps) {
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
  const money = (value: number) => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value)
  const requiredCustomOk = customFields.every((field) =>
    !field.validation.required || String(customValues[field.fieldId] ?? "").trim() !== "")
  const validInvoiceDate = invoiceDate !== "" && !Number.isNaN(Date.parse(invoiceDate))
  const validDueDate = dueDate === "" || (
    !Number.isNaN(Date.parse(dueDate)) && Date.parse(dueDate) >= Date.parse(invoiceDate)
  )
  const canSave = !locked && !saving && Boolean(journal && partnerId && counterpartAccountId)
    && lineItems.every((line) => line.description.trim() && line.accountId && line.quantity > 0 && line.unitPrice >= 0)
    && validInvoiceDate && validDueDate && requiredCustomOk
  const dirty = partnerId !== "" || invoiceDate !== today || dueDate !== "" || paymentTermId !== ""
    || reference !== "" || paymentReference !== "" || notes !== ""
    || Object.values(customValues).some((value) => value !== "") || lineItems.length !== 1
    || lineItems.some((line) => line.description !== "" || line.quantity !== 1 || line.unitPrice !== 0
      || line.taxId !== "" || line.discount !== 0 || line.productId !== "")
  const navigationDialog = useUnsavedChangesGuard(open && dirty, open && saving)

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
    <DialogContent data-testid="create-invoice-modal" className="flex min-h-0 max-h-[90dvh] w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-[1440px]">
      <DialogHeader><DialogTitle>{t(`accounting.forms.${copyKey}.createTitle`)}</DialogTitle></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <FinanceReviewWorkspace editor={<>
      <fieldset disabled={locked || saving} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.partner`)} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.journal`)} value={journalId} onChange={setJournalId} options={journalOptions} />
          <FieldSelect label={kind === "bill" ? "Payable account" : "Receivable account"} value={counterpartAccountId} onChange={setCounterpartAccountId} options={counterpartOptions} />
          <div className="space-y-2"><Label>{t("financeReview.currency", { defaultValue: "Currency" })}</Label><Input value={currencyOptions.find((option) => option.value === journal?.currencyId)?.label ?? journal?.currencyId ?? ""} readOnly /></div>
          <div className="space-y-2"><Label htmlFor="create-invoice-date">{kind === "bill" ? "Bill date" : "Invoice Date"}</Label><Input id="create-invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="create-invoice-due-date">{t(`accounting.forms.${copyKey}.fields.dueDate`)}</Label><Input id="create-invoice-due-date" type="date" min={invoiceDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
          <FieldSelect label="Payment term (optional)" value={paymentTermId || NONE} onChange={(value) => setPaymentTermId(value === NONE ? "" : value)} options={[{ value: NONE, label: "None" }, ...paymentTermOptions]} />
          <div className="space-y-2"><Label>Reference</Label><Input value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="space-y-2"><Label>Payment reference</Label><Input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div>
        </div>
        {journalOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? "Configure an active purchase journal before recording a bill." : "Configure an active sales journal before creating an invoice."}</ReadinessMessage> : null}
        {partnerOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? "Add an active vendor before recording a bill." : "Add an active customer before creating an invoice."}</ReadinessMessage> : null}
        {counterpartOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? "Configure an active payable account before recording a bill." : "Configure an active receivable account before creating an invoice."}</ReadinessMessage> : null}
        {commercialOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? "Configure an active expense account before recording a bill." : "Configure an active income account before creating an invoice."}</ReadinessMessage> : null}
        {customFields.length ? <div className="grid gap-4 md:grid-cols-2">{customFields.map((field) =>
          <div key={field.fieldId} className="space-y-2"><Label>{field.label}{field.validation.required ? " *" : ""}</Label><Input data-testid={`create-invoice-custom-${field.fieldId}`} value={customValues[field.fieldId] ?? ""} onChange={(event) => setCustomValues((previous) => ({ ...previous, [field.fieldId]: event.target.value }))} /></div>)}</div> : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between"><Label>{t("accounting.forms.newInvoice.lineItems")}</Label><Button type="button" variant="outline" size="sm" onClick={() => setLineItems((previous) => [...previous, newLine(crypto.randomUUID())])}><Plus className="mr-2 h-4 w-4" />{t("accounting.forms.newInvoice.addItem")}</Button></div>
          {lineItems.map((line, index) => <div key={line.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-4">
            <FieldSelect label="Product" value={line.productId || NONE} onChange={(value) => chooseProduct(line, value)} options={[{ value: NONE, label: "No product" }, ...productOptions]} />
            <div className="space-y-2 md:col-span-2"><Label>Description</Label><Input data-testid={index === 0 ? "create-invoice-line-description" : undefined} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></div>
            <FieldSelect label={kind === "bill" ? "Expense account" : "Income account"} value={line.accountId} onChange={(value) => updateLine(line.id, { accountId: value })} options={commercialOptions} />
            <div className="space-y-2"><Label htmlFor={`invoice-line-quantity-${line.id}`}>Qty</Label><Input id={`invoice-line-quantity-${line.id}`} type="number" min={0.000001} step="any" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Unit price</Label><Input data-testid={index === 0 ? "create-invoice-line-unit-price" : undefined} type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} /></div>
            <div className="flex items-end gap-1"><FieldSelect label="Tax" value={line.taxId || NONE} onChange={(value) => updateLine(line.id, { taxId: value === NONE ? "" : value })} options={[{ value: NONE, label: "No tax" }, ...taxOptions]} /><Button type="button" variant="ghost" size="icon" disabled={lineItems.length === 1} onClick={() => setLineItems((previous) => previous.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="space-y-2"><Label>Discount %</Label><Input type="number" min={0} max={100} value={line.discount} onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) })} /></div>
          </div>)}
          <div className="text-right text-sm">Subtotal: {money(subtotal)} · Tax: {money(totalTax)} · <strong>Total: {money(subtotal + totalTax)}</strong></div>
        </div>
        <div className="space-y-2"><Label>{t("accounting.forms.newInvoice.notesOptional")}</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></div>
      </fieldset>
      </>} preview={<>
          <Card data-testid="invoice-document-preview">
            <CardHeader>
              <div><Badge variant="secondary">{t("accounting.authoring.unsavedDraft", { defaultValue: "Unsaved draft" })}</Badge></div>
              <CardTitle>{kind === "bill" ? t("accounting.authoring.bill", { defaultValue: "Bill" }) : t("accounting.authoring.invoice", { defaultValue: "Invoice" })}{reference ? ` · ${reference}` : ""}</CardTitle>
              <CardDescription>{companyLabel || t("accounting.authoring.companyId", { defaultValue: "Company {{id}}", id: String(companyId) })} · {currencyOptions.find((option) => option.value === journal?.currencyId)?.label || t("accounting.authoring.currencyId", { defaultValue: "Currency {{id}}", id: journal?.currencyId ?? "—" })}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-sm text-muted-foreground">{kind === "bill" ? t("accounting.authoring.vendor", { defaultValue: "Vendor" }) : t("accounting.authoring.customer", { defaultValue: "Customer" })}</p><p>{partnerOptions.find((option) => option.value === partnerId)?.label || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">{t("accounting.authoring.documentDate", { defaultValue: "Document date" })}</p><p>{invoiceDate || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">{t("accounting.authoring.dueDate", { defaultValue: "Due date" })}</p><p>{dueDate || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">{t("accounting.authoring.paymentTerms", { defaultValue: "Payment terms" })}</p><p>{paymentTermOptions.find((option) => option.value === paymentTermId)?.label || "—"}</p></div>
              </div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t("accounting.authoring.description", { defaultValue: "Description" })}</TableHead>
                  <TableHead className="text-right">{t("accounting.authoring.quantity", { defaultValue: "Quantity" })}</TableHead>
                  <TableHead className="text-right">{t("accounting.authoring.unitPrice", { defaultValue: "Unit price" })}</TableHead>
                  <TableHead className="text-right">{t("accounting.authoring.tax", { defaultValue: "Tax" })}</TableHead>
                  <TableHead className="text-right">{t("accounting.authoring.total", { defaultValue: "Total" })}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{lineItems.map((line) => {
                  const base = line.quantity * line.unitPrice * (1 - line.discount / 100)
                  const tax = taxAmount(base, taxOptions.find((option) => option.value === line.taxId))
                  return <TableRow key={line.id}>
                    <TableCell>{line.description || "—"}{line.discount ? <p className="text-sm text-muted-foreground">{t("accounting.authoring.discount", { defaultValue: "Discount: {{amount}}%", amount: line.discount })}</p> : null}</TableCell>
                    <TableCell className="text-right">{Number.isFinite(line.quantity) ? money(line.quantity) : "—"}</TableCell>
                    <TableCell className="text-right">{Number.isFinite(line.unitPrice) ? money(line.unitPrice) : "—"}</TableCell>
                    <TableCell className="text-right">{Number.isFinite(tax) ? money(tax) : "—"}</TableCell>
                    <TableCell className="text-right">{Number.isFinite(base + tax) ? money(base + tax) : "—"}</TableCell>
                  </TableRow>
                })}</TableBody>
              </Table>
              <div className="flex flex-col items-end gap-1">
                <p>{t("accounting.authoring.untaxed", { defaultValue: "Untaxed amount" })}: {Number.isFinite(subtotal) ? money(subtotal) : "—"}</p>
                <p>{t("accounting.authoring.tax", { defaultValue: "Tax" })}: {Number.isFinite(totalTax) ? money(totalTax) : "—"}</p>
                <p>{t("accounting.authoring.total", { defaultValue: "Total" })}: {Number.isFinite(subtotal + totalTax) ? money(subtotal + totalTax) : "—"}</p>
              </div>
              {paymentReference ? <p>{t("accounting.authoring.paymentReference", { defaultValue: "Payment reference" })}: {paymentReference}</p> : null}
              {notes ? <p className="whitespace-pre-wrap">{notes}</p> : null}
              <p className="text-sm text-muted-foreground">{t("accounting.authoring.documentPreviewOnly", { defaultValue: "Preview of the current draft. Saving creates a draft, not a posted entry. The server confirms amounts and rounding." })}</p>
            </CardContent>
          </Card>
      </>} />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" onClick={close}>{t("common.cancel")}</Button>{locked
        ? <Button onClick={() => void checkStatus()} disabled={saving}>Check previous action</Button>
        : <Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>Save as Draft</Button>}</DialogFooter>
      {navigationDialog}
    </DialogContent>
  </Dialog>
}

function FieldSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (value: string) => void; options: ManualInvoiceOption[]; testId?: string
}) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger data-testid={testId}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
}

interface LegacyCreateInvoiceModalProps {
  open: boolean
  onClose: () => void
  onSave?: (params: InvoiceFormPayload) => void | Promise<void>
  journalOptions?: ManualInvoiceOption[]
  partnerOptions?: ManualInvoiceOption[]
  accountOptions?: ManualInvoiceOption[]
  counterpartAccountOptions?: ManualInvoiceOption[]
  taxOptions?: InvoiceTaxOption[]
  currencyId?: bigint
  currencyCode?: string
  documentKind?: "invoice" | "bill"
  organizationId?: number
  formId?: string
}

type CreateInvoiceModalProps = ReleasedCreateInvoiceModalProps | LegacyCreateInvoiceModalProps

export function CreateInvoiceModal(props: CreateInvoiceModalProps) {
  if ("companyId" in props) return <ReleasedCreateInvoiceModal {...props} />
  return <LegacyCreateInvoiceModal {...props} />
}

function LegacyCreateInvoiceModal({
  open,
  onClose,
  onSave,
  journalOptions = [],
  partnerOptions = [],
  accountOptions = [],
  counterpartAccountOptions = [],
  taxOptions = [],
  currencyId,
  currencyCode,
  documentKind = "invoice",
}: LegacyCreateInvoiceModalProps) {
  const { t } = useTranslation()
  const today = new Date().toISOString().slice(0, 10)
  const [partnerId, setPartnerId] = useState("")
  const [journalId, setJournalId] = useState("")
  const [counterpartAccountId, setCounterpartAccountId] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState("")
  const [line, setLine] = useState({ description: "", quantity: 1, unitPrice: 0, taxId: "", discount: 0 })
  const [saving, setSaving] = useState(false)
  const idempotencyKey = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    setJournalId((value) => value || journalOptions[0]?.value || "")
    setCounterpartAccountId((value) => value || counterpartAccountOptions[0]?.value || "")
  }, [counterpartAccountOptions, journalOptions, open])

  const tax = taxOptions.find((option) => option.value === line.taxId)
  const entered = line.quantity * line.unitPrice * (1 - line.discount / 100)
  const amountTax = tax == null ? 0 : tax.priceIncluded
    ? entered - entered / (1 + tax.rate / 100)
    : entered * tax.rate / 100
  const amountUntaxed = tax?.priceIncluded ? entered - amountTax : entered
  const amountTotal = tax?.priceIncluded ? entered : entered + amountTax
  const validDate = invoiceDate !== "" && !Number.isNaN(Date.parse(invoiceDate))
  const validDueDate = dueDate === "" || (
    !Number.isNaN(Date.parse(dueDate)) && Date.parse(dueDate) >= Date.parse(invoiceDate)
  )
  const canSave = !saving && typeof onSave === "function" && currencyId != null &&
    partnerId !== "" && journalId !== "" && counterpartAccountId !== "" && accountOptions[0]?.value != null &&
    line.description.trim() !== "" && line.quantity > 0 && line.unitPrice >= 0 && validDate && validDueDate

  const reset = () => {
    setPartnerId("")
    setJournalId("")
    setCounterpartAccountId("")
    setInvoiceDate(today)
    setDueDate("")
    setLine({ description: "", quantity: 1, unitPrice: 0, taxId: "", discount: 0 })
    idempotencyKey.current = null
  }
  const save = async () => {
    if (!canSave || !onSave || currencyId == null) return
    setSaving(true)
    try {
      idempotencyKey.current ??= `create-manual-invoice:${crypto.randomUUID()}`
      const accountId = BigInt(accountOptions[0]!.value)
      const canonicalLine: InvoiceFormLine = {
        id: "1",
        accountId,
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxId: line.taxId ? BigInt(line.taxId) : undefined,
        taxRate: tax?.rate ?? 0,
        taxPriceIncluded: tax?.priceIncluded ?? false,
        discount: line.discount,
        amountUntaxed,
        amountTax,
        amountTotal,
      }
      await onSave({
        type: "invoice-draft",
        idempotencyKey: idempotencyKey.current,
        moveType: documentKind === "bill" ? "InInvoice" : "OutInvoice",
        date: invoiceDate,
        invoiceDate,
        invoiceDateDue: dueDate || undefined,
        dueDate: dueDate || undefined,
        partnerId: BigInt(partnerId),
        invoicePartnerDisplayName: partnerOptions.find((option) => option.value === partnerId)?.label ?? "",
        journalId: BigInt(journalId),
        currencyId,
        counterpartAccountId: BigInt(counterpartAccountId),
        lineItems: [canonicalLine],
        amountUntaxed,
        amountTax,
        amountTotal,
        amountResidual: amountTotal,
        metadata: JSON.stringify({ invoiceDate, dueDate: dueDate || undefined }),
      })
      reset()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
    <DialogContent data-testid="create-invoice-modal" className="max-h-[90vh] max-w-4xl overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{documentKind === "bill" ? "New bill" : "New invoice"}</DialogTitle></DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <FieldSelect label={documentKind === "bill" ? "Vendor" : "Customer"} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
        <FieldSelect label="Journal" value={journalId} onChange={setJournalId} options={journalOptions} />
        <FieldSelect label={documentKind === "bill" ? "Payable account" : "Receivable account"} value={counterpartAccountId} onChange={setCounterpartAccountId} options={counterpartAccountOptions} />
        <div className="space-y-2"><Label htmlFor="legacy-invoice-date">{documentKind === "bill" ? "Bill Date" : "Invoice Date"}</Label><Input id="legacy-invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-invoice-due-date">Due Date</Label><Input id="legacy-invoice-due-date" type="date" min={invoiceDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
      </div>
      <div className="grid gap-3 rounded-md border p-3 md:grid-cols-5">
        <div className="space-y-2 md:col-span-2"><Label htmlFor="legacy-line-description">Description</Label><Input id="legacy-line-description" data-testid="create-invoice-line-description" value={line.description} onChange={(event) => setLine((value) => ({ ...value, description: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-line-quantity">Qty</Label><Input id="legacy-line-quantity" type="number" min={0.000001} step="any" value={line.quantity} onChange={(event) => setLine((value) => ({ ...value, quantity: Number(event.target.value) }))} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-line-price">Unit price</Label><Input id="legacy-line-price" data-testid="create-invoice-line-unit-price" type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => setLine((value) => ({ ...value, unitPrice: Number(event.target.value) }))} /></div>
        <FieldSelect label="Tax" testId="create-invoice-line-tax" value={line.taxId || NONE} onChange={(value) => setLine((current) => ({ ...current, taxId: value === NONE ? "" : value }))} options={[{ value: NONE, label: "No tax" }, ...taxOptions]} />
      </div>
      <div className="text-right text-sm">Subtotal: {formatLegacyAmount(amountUntaxed, currencyCode)} · Tax: {formatLegacyAmount(amountTax, currencyCode)} · <strong>Total: {formatLegacyAmount(amountTotal, currencyCode)}</strong></div>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>{documentKind === "bill" ? "Save bill draft" : t("accounting.forms.newInvoice.saveDraft")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function formatLegacyAmount(value: number, currencyCode?: string): string {
  try {
    return new Intl.NumberFormat(undefined, currencyCode
      ? { style: "currency", currency: currencyCode }
      : { maximumFractionDigits: 2 }).format(value)
  } catch {
    return String(value)
  }
}

function ReadinessMessage({ children }: { children: string }) {
  return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="status">{children}</p>
}
