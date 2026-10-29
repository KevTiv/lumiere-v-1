"use client"

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { CreateManualAccountInvoiceParams } from "@lumiere/query-hooks/hooks/accounting"
import type { CanonicalRecordRef, OperationEffectOutcome } from "@lumiere/query-hooks/hooks/operation-effect"
import { toCreateManualAccountInvoiceParams } from "@lumiere/erp-shared/accounting-create-params"
import { useTranslation } from "@lumiere/i18n"
import { ChevronDown, Eye, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { isCustomField } from "../forms/config/types"
import { useFormConfiguration } from "../forms/hooks/use-form-config"
import { FinanceReviewWorkspace } from "../composed/finance-review-workspace"
import { formatInvoiceMoney, InvoiceDocument } from "./invoice-document"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"
import { parseInvoiceContent, parseInvoiceNotes, type InvoiceDocumentSnapshot, type InvoicePersonalizationProfile } from "@lumiere/erp-shared/invoice-personalization"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { useConfirmDialog } from "../hooks/use-confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/collapsible"

const emptyProfile: InvoicePersonalizationProfile = { logoUrl: "", accent: "teal", email: "", phone: "", website: "", notice: "", terms: "", paymentInstructions: "", footer: "" }
const emptySeller: InvoiceDocumentSnapshot["seller"] = { name: "", address: [], taxId: "", registrationNumber: "", email: "", phone: "", website: "" }
const emptyProfileVersions = { organization: null, company: null }
const contentFields = [
  { key: "notice", label: "Notice", limit: 2000 },
  { key: "terms", label: "Terms", limit: 8000 },
  { key: "paymentInstructions", label: "Payment instructions", limit: 4000 },
  { key: "footer", label: "Footer", limit: 2000 },
] as const
type ContentKey = typeof contentFields[number]["key"]

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
  profile?: InvoicePersonalizationProfile | null
  profileVersionIds?: InvoiceDocumentSnapshot["profileVersionIds"]
  seller?: InvoiceDocumentSnapshot["seller"]
  personalizationState?: ModuleDataState
}

function ReleasedCreateInvoiceModal({
  open, kind = "invoice", companyId, onClose, onSave, onCheckStatus, onResolved,
  journalOptions, partnerOptions, counterpartAccountOptions, lineAccountOptions,
  taxOptions = [], productOptions = [], paymentTermOptions = [], currencyOptions = [], organizationId,
  formId = kind === "bill" ? "new-bill" : "new-invoice",
  profile, profileVersionIds, seller, personalizationState,
}: ReleasedCreateInvoiceModalProps) {
  const { t } = useTranslation()
  const { confirm: confirmDiscard, dialog: discardDialog } = useConfirmDialog()
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
  const scrollBodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (error && scrollBodyRef.current) scrollBodyRef.current.scrollTop = 0
  }, [error])
  const [saving, setSaving] = useState(false)
  const [draftCompanyId, setDraftCompanyId] = useState(companyId)
  const [formEdited, setFormEdited] = useState(false)
  const [contentOverrides, setContentOverrides] = useState<Partial<Record<ContentKey, string>>>({})
  const sourceProfile = kind === "invoice" ? profile : null
  const sourceSeller = kind === "invoice" ? seller : undefined
  const sourceVersions = kind === "invoice" ? profileVersionIds : undefined
  const sourceSignature = JSON.stringify([sourceProfile ?? emptyProfile, sourceVersions ?? emptyProfileVersions, sourceSeller ?? emptySeller])
  const currentDefaults = () => ({ profile: sourceProfile ?? emptyProfile, versions: sourceVersions ?? emptyProfileVersions, seller: sourceSeller ?? emptySeller, signature: sourceSignature })
  const [documentDefaults, setDocumentDefaults] = useState(currentDefaults)
  const companyMismatch = draftCompanyId !== companyId
  const personalizationReady = kind === "bill" || personalizationState == null || personalizationState.status === "ready"
  const defaultsChanged = personalizationReady && !companyMismatch && documentDefaults.signature !== sourceSignature
  const effectiveProfile = { ...documentDefaults.profile, ...contentOverrides }
  const previewPersonalization: InvoiceDocumentSnapshot = {
    schemaVersion: 1, profileVersionIds: documentDefaults.versions,
    seller: documentDefaults.seller, profile: effectiveProfile, notes,
  }
  const { config: formConfig } = useFormConfiguration({
    moduleId: "accounting", formId, organizationId: organizationId ?? 0, useDefaultIfMissing: true,
  })
  const customFields = useMemo(
    () => (formConfig?.fields ?? []).filter((field) => field.isEnabled && isCustomField(field.fieldId)),
    [formConfig?.fields],
  )
  const locked = unknownParams !== null

  useLayoutEffect(() => {
    if (!open || locked || companyMismatch || saving) return
    setJournalId((previous) => previous && journalOptions.some((option) => option.value === previous)
      ? previous : (journalOptions[0]?.value ?? ""))
  }, [journalOptions, locked, open, companyMismatch, saving])

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
    if (!open || locked || companyMismatch || saving) return
    setCounterpartAccountId((previous) => previous && counterpartOptions.some((option) => option.value === previous)
      ? previous : (counterpartOptions[0]?.value ?? ""))
    setLineItems((previous) => previous.map((line) => ({
      ...line,
      accountId: line.accountId && commercialOptions.some((option) => option.value === line.accountId)
        ? line.accountId : (commercialOptions[0]?.value ?? ""),
    })))
  }, [commercialOptions, counterpartOptions, locked, open, companyMismatch, saving])

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
  const validInvoiceDate = invoiceDate !== "" && !Number.isNaN(Date.parse(invoiceDate))
  const validDueDate = dueDate === "" || (
    !Number.isNaN(Date.parse(dueDate)) && Date.parse(dueDate) >= Date.parse(invoiceDate)
  )
  const canSave = !locked && !saving && !companyMismatch && personalizationReady && !defaultsChanged && Boolean(journal && partnerId && counterpartAccountId)
    && lineItems.every((line) => line.description.trim() && line.accountId && line.quantity > 0 && line.unitPrice >= 0)
    && validInvoiceDate && validDueDate && requiredCustomOk
  const dirty = formEdited || Object.keys(contentOverrides).length > 0 || partnerId !== "" || invoiceDate !== today || dueDate !== "" || paymentTermId !== ""
    || reference !== "" || paymentReference !== "" || notes !== ""
    || Object.values(customValues).some((value) => value !== "") || lineItems.length !== 1
    || lineItems.some((line) => line.description !== "" || line.quantity !== 1 || line.unitPrice !== 0
      || line.taxId !== "" || line.discount !== 0 || line.productId !== "")
  const navigationDialog = useUnsavedChangesGuard(open && dirty, open && saving)

  useLayoutEffect(() => {
    if (locked || saving || dirty) return
    if (draftCompanyId !== companyId) setDraftCompanyId(companyId)
    if (personalizationReady && documentDefaults.signature !== sourceSignature) setDocumentDefaults(currentDefaults())
    // Defaults are captured only while untouched. Refetches never rewrite user edits.
  }, [companyId, draftCompanyId, dirty, locked, saving, personalizationReady, sourceSignature, documentDefaults.signature])

  const buildParams = (): CreateManualAccountInvoiceParams => {
    if (companyMismatch || !personalizationReady || defaultsChanged) throw new Error(t("accounting.createInvoiceModal.reviewTheCurrentCompanyAndInvoiceDefaultsBeforeSaving", { defaultValue: "Review the current company and invoice defaults before saving." }))
    if (!journal) throw new Error(t("accounting.createInvoiceModal.selectAnAccountingJournal", { defaultValue: "Select an accounting journal" }))
    const idempotencyKey = requestId ?? crypto.randomUUID().replaceAll("-", "")
    if (!requestId) setRequestId(idempotencyKey)
    const custom = Object.fromEntries(
      customFields.map((field) => [field.fieldId, customValues[field.fieldId]] as const),
    )
    const metadata = JSON.stringify({
      ...custom,
      notes,
      ...(kind === "invoice" ? { invoiceContent: { schemaVersion: 1, ...contentOverrides } } : {}),
    })
    const contentRead = parseInvoiceContent(metadata)
    const notesRead = parseInvoiceNotes(metadata)
    if (contentRead.status === "invalid") throw new Error(contentRead.error)
    if (notesRead.status === "invalid") throw new Error(notesRead.error)
    const params = toCreateManualAccountInvoiceParams({
      idempotencyKey, companyId: draftCompanyId,
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
    if (!params) throw new Error(t("accounting.createInvoiceModal.completeTheRequiredInvoiceFieldsWithValidValues", { defaultValue: "Complete the required invoice fields with valid values" }))
    return params
  }

  const reset = () => {
    setPartnerId(""); setCounterpartAccountId(""); setJournalId(""); setInvoiceDate(today)
    setDueDate(""); setPaymentTermId(""); setReference(""); setPaymentReference(""); setNotes("")
    setCustomValues({}); setLineItems([newLine()]); setRequestId(null); setUnknownParams(null); setError(null)
    setContentOverrides({}); setFormEdited(false); setDraftCompanyId(companyId); setDocumentDefaults(currentDefaults())
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
        setError(t("accounting.createInvoiceModal.theResultIsNotConfirmedCheckThePreviousActionBefore", { defaultValue: "The result is not confirmed. Check the previous action before trying again." }))
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
      else setError(t("accounting.createInvoiceModal.theInvoiceIsStillUnconfirmedKeepThisFormAndCheck", { defaultValue: "The invoice is still unconfirmed. Keep this form and check again later." }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const close = () => { if (saving) return; if (!locked && !dirty) reset(); onClose() }
  const discard = async () => {
    if (locked || saving) return
    if (await confirmDiscard({ description: t("accounting.createInvoiceModal.discardThisUnsavedInvoiceDraftAndItsDocumentEdits", { defaultValue: "Discard this unsaved invoice draft and its document edits?" }) })) reset()
  }

  return <Dialog open={open} onOpenChange={(next) => !next && close()}>
    <DialogContent data-testid="create-invoice-modal" className="flex h-[min(94dvh,960px)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1480px,calc(100%-3rem))]">
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6"><DialogTitle className="text-xl font-semibold tracking-tight">{t(`accounting.forms.${copyKey}.createTitle`)}</DialogTitle><DialogDescription>{t("accounting.createInvoiceModal.prepareTheDetailsAndReviewTheDocumentBeforeSavingA", { defaultValue: "Prepare the details and review the document before saving a draft." })}</DialogDescription></DialogHeader>
      <div ref={scrollBodyRef} data-testid="create-invoice-scroll-body" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {error ? <p role="alert" className="mb-4 rounded-md border bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
      <FinanceReviewWorkspace previewTabTestId="create-invoice-preview-toggle" editor={
      <div className="min-w-0">
      {companyMismatch ? <p role="alert" className="mb-4 rounded-md border p-3 text-sm">{t("accounting.createInvoiceModal.draftCompanyChanged", { defaultValue: "This draft belongs to company #{{companyId}}. Switch back to continue. Your entries and any previous action are preserved.", companyId: String(draftCompanyId) })}</p> : null}
      {kind === "invoice" ? <ModuleDataNotice state={personalizationState} /> : null}
      {defaultsChanged ? <div role="status" className="mb-4 space-y-2 rounded-md border p-3 text-sm"><p>{t("accounting.createInvoiceModal.companyInvoiceSettingsChangedReviewTheLatestDefaultsBeforeSaving", { defaultValue: "Company invoice settings changed. Review the latest defaults before saving. Your explicit changes and notes will be kept." })}</p><Button variant="outline" disabled={locked || saving} onClick={() => setDocumentDefaults(currentDefaults())}>{t("accounting.createInvoiceModal.applyCurrentInvoiceDefaults", { defaultValue: "Apply current invoice defaults" })}</Button></div> : null}
      <fieldset disabled={locked || saving || companyMismatch || !personalizationReady} className="min-w-0 space-y-6" onChangeCapture={() => setFormEdited(true)}>
        <section className="space-y-4" aria-label={t("accounting.authoring.documentDetails", { defaultValue: "Document details" })}><div><h3 className="font-semibold">{t("accounting.authoring.documentDetails", { defaultValue: "Document details" })}</h3><p className="mt-1 text-xs text-muted-foreground">{t("accounting.authoring.documentDetailsHint", { defaultValue: "Start with the customer or vendor, dates and reference." })}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label={kind === "bill" ? t("accounting.workflowGuide.vendor", { defaultValue: "Vendor" }) : t("accounting.workflowGuide.customer", { defaultValue: "Customer" })} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
          <div className="space-y-2"><Label htmlFor="create-invoice-date">{kind === "bill" ? t("accounting.createInvoiceModal.billDate", { defaultValue: "Bill date" }) : t("accounting.forms.newInvoice.fields.invoiceDate", { defaultValue: "Invoice Date" })}</Label><DatePicker id="create-invoice-date" value={invoiceDate} onChange={(value) => setInvoiceDate(value)} /></div>
          <div className="space-y-2"><Label htmlFor="create-invoice-due-date">{t(`accounting.forms.${copyKey}.fields.dueDate`)}</Label><DatePicker id="create-invoice-due-date" min={invoiceDate} value={dueDate} onChange={(value) => setDueDate(value)} /></div>
          <div className="space-y-2"><Label>{t("accounting.journalEntries.ref", { defaultValue: "Reference" })}</Label><Input aria-label={t("accounting.journalEntries.ref", { defaultValue: "Reference" })} value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="space-y-2"><Label>{t("accounting.overview.currency", { defaultValue: "Currency" })}</Label><Input aria-label={t("accounting.overview.currency", { defaultValue: "Currency" })} value={currencyOption?.label ?? (journal ? t("accounting.createInvoiceModal.currencyValue", { defaultValue: "Currency #{{value1}}", value1: journal.currencyId }) : t("accounting.createInvoiceModal.selectAJournal", { defaultValue: "Select a journal" }))} readOnly /></div>
        </div></section>
        {journalOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? t("accounting.createInvoiceModal.configureAnActivePurchaseJournalBeforeRecordingABill", { defaultValue: "Configure an active purchase journal before recording a bill." }) : t("accounting.createInvoiceModal.configureAnActiveSalesJournalBeforeCreatingAnInvoice", { defaultValue: "Configure an active sales journal before creating an invoice." })}</ReadinessMessage> : null}
        <p className="text-xs text-muted-foreground">{t("accounting.workflowGuide.saveDraftHint", { defaultValue: "Save creates a draft and opens the saved document. Review and post it there when ready; payment and bank matching come afterwards." })}</p>
        {partnerOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? t("accounting.createInvoiceModal.addAnActiveVendorBeforeRecordingABill", { defaultValue: "Add an active vendor before recording a bill." }) : t("accounting.createInvoiceModal.addAnActiveCustomerBeforeCreatingAnInvoice", { defaultValue: "Add an active customer before creating an invoice." })}</ReadinessMessage> : null}
        {counterpartOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? t("accounting.createInvoiceModal.configureAnActivePayableAccountBeforeRecordingABill", { defaultValue: "Configure an active payable account before recording a bill." }) : t("accounting.createInvoiceModal.configureAnActiveReceivableAccountBeforeCreatingAnInvoice", { defaultValue: "Configure an active receivable account before creating an invoice." })}</ReadinessMessage> : null}
        {commercialOptions.length === 0 ? <ReadinessMessage>{kind === "bill" ? t("accounting.createInvoiceModal.configureAnActiveExpenseAccountBeforeRecordingABill", { defaultValue: "Configure an active expense account before recording a bill." }) : t("accounting.createInvoiceModal.configureAnActiveIncomeAccountBeforeCreatingAnInvoice", { defaultValue: "Configure an active income account before creating an invoice." })}</ReadinessMessage> : null}
        {customFields.length ? <div className="grid gap-4 md:grid-cols-2">{customFields.map((field) =>
          <div key={field.fieldId} className="space-y-2"><Label>{field.label}{field.validation.required ? " *" : ""}</Label><Input data-testid={`create-invoice-custom-${field.fieldId}`} value={customValues[field.fieldId] ?? ""} onChange={(event) => setCustomValues((previous) => ({ ...previous, [field.fieldId]: event.target.value }))} /></div>)}</div> : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-t pt-5"><h3 className="font-semibold">{t("accounting.forms.newInvoice.lineItems")}</h3><Button type="button" variant="outline" size="sm" onClick={() => setLineItems((previous) => [...previous, newLine(crypto.randomUUID())])}><Plus className="mr-2 h-4 w-4" />{t("accounting.forms.newInvoice.addItem")}</Button></div>
          {lineItems.map((line, index) => <div key={line.id} className="rounded-lg border bg-muted/15 p-4">
            <div className="mb-4 flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("accounting.createInvoiceModal.lineNumber", { defaultValue: "Item {{number}}", number: index + 1 })}</span><Button type="button" aria-label={t("accounting.createInvoiceModal.removeItemValue", { defaultValue: "Remove item {{value1}}", value1: index + 1 })} variant="ghost" size="icon" disabled={lineItems.length === 1} onClick={() => setLineItems((previous) => previous.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <FieldSelect label={t("accounting.createInvoiceModal.product", { defaultValue: "Product" })} value={line.productId || NONE} onChange={(value) => chooseProduct(line, value)} options={[{ value: NONE, label: t("accounting.createInvoiceModal.noProduct", { defaultValue: "No product" }) }, ...productOptions]} />
            <div className="space-y-2 xl:col-span-2"><Label>{t("accounting.taxSchedules.columns.description", { defaultValue: "Description" })}</Label><Input aria-label={t("accounting.createInvoiceModal.itemValueDescription", { defaultValue: "Item {{value1}} description", value1: index + 1 })} data-testid={index === 0 ? "create-invoice-line-description" : undefined} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor={`invoice-line-quantity-${line.id}`}>{t("accounting.forms.newInvoice.columns.qty", { defaultValue: "Qty" })}</Label><Input id={`invoice-line-quantity-${line.id}`} aria-label={t("accounting.createInvoiceModal.itemValueQuantity", { defaultValue: "Item {{value1}} quantity", value1: index + 1 })} type="number" min={0.000001} step="any" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></div>
            <div className="space-y-2"><Label>{t("accounting.billCorrection.price", { defaultValue: "Unit price" })}</Label><Input aria-label={t("accounting.createInvoiceModal.itemValueUnitPrice", { defaultValue: "Item {{value1}} unit price", value1: index + 1 })} data-testid={index === 0 ? "create-invoice-line-unit-price" : undefined} type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} /></div>
            <FieldSelect label={t("accounting.forms.newInvoice.summary.tax", { defaultValue: "Tax" })} value={line.taxId || NONE} onChange={(value) => updateLine(line.id, { taxId: value === NONE ? "" : value })} options={[{ value: NONE, label: t("accounting.createInvoiceModal.noTax", { defaultValue: "No tax" }) }, ...taxOptions]} />
            <div className="space-y-2"><Label>{t("accounting.createInvoiceModal.discount", { defaultValue: "Discount %" })}</Label><Input aria-label={t("accounting.createInvoiceModal.itemValueDiscountPercent", { defaultValue: "Item {{value1}} discount percent", value1: index + 1 })} type="number" min={0} max={100} value={line.discount} onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) })} /></div>
            <FieldSelect label={kind === "bill" ? t("accounting.createInvoiceModal.expenseAccount", { defaultValue: "Expense account" }) : t("accounting.createInvoiceModal.incomeAccount", { defaultValue: "Income account" })} value={line.accountId} onChange={(value) => updateLine(line.id, { accountId: value })} options={commercialOptions} />
          </div><div className="mt-4 flex justify-between border-t pt-3 text-sm"><span className="text-muted-foreground">{t("accounting.createInvoiceModal.lineAmount", { defaultValue: "Line amount" })}</span><span className="font-medium tabular-nums">{money(line.quantity * line.unitPrice * (1 - line.discount / 100))}</span></div></div>)}
        </div>
        <section className="space-y-4 border-t pt-5" aria-label={t("accounting.authoring.paymentDetails", { defaultValue: "Payment details" })}>
          <h3 className="font-semibold">{t("accounting.authoring.paymentDetails", { defaultValue: "Payment details" })}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label={t("accounting.createInvoiceModal.paymentTermOptional", { defaultValue: "Payment term (optional)" })} value={paymentTermId || NONE} onChange={(value) => setPaymentTermId(value === NONE ? "" : value)} options={[{ value: NONE, label: t("common.none", { defaultValue: "None" }) }, ...paymentTermOptions]} />
          <div className="space-y-2"><Label>{t("accounting.authoring.paymentReference", { defaultValue: "Payment reference" })}</Label><Input aria-label={t("accounting.authoring.paymentReference", { defaultValue: "Payment reference" })} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></div>
          </div>
        </section>
        <section className="space-y-4 border-t pt-5" aria-label={t("accounting.authoring.accountingDetails", { defaultValue: "Accounting details" })}>
          <div><h3 className="font-semibold">{t("accounting.authoring.accountingDetails", { defaultValue: "Accounting details" })}</h3><p className="mt-1 text-xs text-muted-foreground">{t("accounting.authoring.accountingSelectionHint", { defaultValue: "Review the journal and accounts before saving. The journal sets the currency." })}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
          <FieldSelect label={t(`accounting.forms.${copyKey}.fields.journal`)} value={journalId} onChange={(value) => { setFormEdited(true); setJournalId(value) }} options={journalOptions} />
          <FieldSelect label={kind === "bill" ? t("accounting.createInvoiceModal.payableAccount", { defaultValue: "Payable account" }) : t("accounting.creditControl.writeOffForm.fields.receivableAccountId", { defaultValue: "Receivable account" })} value={counterpartAccountId} onChange={(value) => { setFormEdited(true); setCounterpartAccountId(value) }} options={counterpartOptions} />
          </div>
        </section>
        {kind === "invoice" ? <Collapsible className="flex min-w-0 flex-col gap-3 border-t pt-5">
          <CollapsibleTrigger render={<Button variant="ghost" className="h-auto min-h-11 justify-between whitespace-normal px-0 text-left" />} data-testid="create-invoice-content-toggle">
            {t("accounting.authoring.documentContent", { defaultValue: "Document content" })}<ChevronDown data-icon="inline-end" />
          </CollapsibleTrigger>
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2" data-testid="create-invoice-content-summary">
            {contentFields.map(({ key, label }) => <div key={key} className="min-w-0 text-xs">
              <dt className="font-medium">{t(`accounting.invoiceContent.${key}`, { defaultValue: label })} · <span className="text-muted-foreground">{Object.hasOwn(contentOverrides, key)
                ? effectiveProfile[key] === "" ? t("accounting.authoring.contentCleared", { defaultValue: "Cleared for this document" }) : t("accounting.authoring.contentOverride", { defaultValue: "Edited for this document" })
                : t("accounting.authoring.contentInherited", { defaultValue: "Company default" })}</span></dt>
              <dd className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">{effectiveProfile[key] || t("accounting.authoring.contentEmpty", { defaultValue: "No text" })}</dd>
            </div>)}
          </dl>
          <CollapsibleContent className="flex min-w-0 flex-col gap-4">
            <p className="text-xs text-muted-foreground">{t("accounting.authoring.documentContentHint", { defaultValue: "Company defaults prefill this document. Edit a section to override it, or clear it explicitly. Use company default to restore inherited text." })}</p>
            {contentFields.map(({ key, label, limit }) => <div key={key} className="min-w-0 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor={`invoice-content-${key}`}>{t(`accounting.invoiceContent.${key}`, { defaultValue: label })}</Label>{Object.hasOwn(contentOverrides, key) ? <Button variant="ghost" size="sm" onClick={() => setContentOverrides((previous) => { const next = { ...previous }; delete next[key]; return next })}>{t("accounting.createInvoiceModal.useCompanyDefault", { defaultValue: "Use company default" })}</Button> : null}</div><Textarea id={`invoice-content-${key}`} aria-label={t(`accounting.invoiceContent.${key}`, { defaultValue: label })} value={effectiveProfile[key]} maxLength={limit} onChange={(event) => setContentOverrides((previous) => ({ ...previous, [key]: event.target.value }))} rows={key === "terms" ? 4 : 3} /></div>)}
          </CollapsibleContent>
        </Collapsible> : null}
        <section className="space-y-2 border-t pt-5">
          <Label>{t("accounting.forms.newInvoice.notesOptional")}</Label><Textarea aria-label={t("accounting.forms.newInvoice.notesOptional")} value={notes} maxLength={8000} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </section>
      </fieldset>
      </div>
      } preview={
      <div className="min-w-0 rounded-xl bg-muted/40 p-4 sm:p-6"><div className="mb-4 flex items-center gap-2 text-sm font-medium"><Eye className="size-4 text-muted-foreground" />{t("settings.formConfig.tabs.preview", { defaultValue: "Live preview" })}</div><InvoiceDocument title={kind === "bill" ? t("accounting.manualInvoice.billTitle", { defaultValue: "Vendor bill" }) : t("accounting.manualInvoice.invoiceTitle", { defaultValue: "Invoice" })} reference={reference} partnerLabel={kind === "bill" ? t("accounting.workflowGuide.vendor", { defaultValue: "Vendor" }) : t("accounting.createInvoiceModal.billTo", { defaultValue: "Bill to" })} partner={partnerOptions.find((option) => option.value === partnerId)?.label} date={invoiceDate} dueDate={dueDate} currency={currency} lines={lineItems} subtotal={subtotal} tax={totalTax} total={subtotal + totalTax} personalization={kind === "invoice" ? previewPersonalization : undefined} notes={notes} draft /></div>
      } />
      </div>
      <DialogFooter className="m-0 shrink-0 flex-row flex-wrap items-center justify-between gap-3 rounded-none bg-background px-5 sm:justify-between sm:px-6"><div className="mr-auto min-w-0 text-sm"><span className="text-muted-foreground">{t("common.entityView.pivotTotal", { defaultValue: "Total" })}</span><p className="font-semibold tabular-nums [overflow-wrap:anywhere]">{money(subtotal + totalTax)}</p></div>{dirty && !locked ? <Button variant="ghost" onClick={() => void discard()} disabled={saving}>{t("common.formDraft.discard", { defaultValue: "Discard draft" })}</Button> : null}<Button variant="outline" onClick={close} disabled={saving}>{locked ? t("accounting.createInvoiceModal.closeAndKeepDraft", { defaultValue: "Close and keep draft" }) : t("common.cancel")}</Button>{locked
        ? <Button onClick={() => void checkStatus()} disabled={saving}>{t("accounting.createInvoiceModal.checkPreviousAction", { defaultValue: "Check previous action" })}</Button>
        : <Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>{t("accounting.forms.newInvoice.saveDraft", { defaultValue: "Save as Draft" })}</Button>}</DialogFooter>
      {navigationDialog}
      {discardDialog}
    </DialogContent>
  </Dialog>
}

function FieldSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (value: string) => void; options: ManualInvoiceOption[]; testId?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} data-testid={testId}><SelectValue placeholder={t("settings.formConfig.fieldDialog.fieldTypes.Select", { defaultValue: "Select" })} /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
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
      <DialogHeader><DialogTitle>{documentKind === "bill" ? t("accounting.overview.newBill", { defaultValue: "New bill" }) : t("accounting.overview.newInvoice", { defaultValue: "New invoice" })}</DialogTitle></DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <FieldSelect label={documentKind === "bill" ? t("accounting.workflowGuide.vendor", { defaultValue: "Vendor" }) : t("accounting.workflowGuide.customer", { defaultValue: "Customer" })} testId="create-invoice-partner" value={partnerId} onChange={setPartnerId} options={partnerOptions} />
        <FieldSelect label={t("accounting.journalEntries.journal", { defaultValue: "Journal" })} value={journalId} onChange={setJournalId} options={journalOptions} />
        <FieldSelect label={documentKind === "bill" ? t("accounting.createInvoiceModal.payableAccount", { defaultValue: "Payable account" }) : t("accounting.creditControl.writeOffForm.fields.receivableAccountId", { defaultValue: "Receivable account" })} value={counterpartAccountId} onChange={setCounterpartAccountId} options={counterpartAccountOptions} />
        <div className="space-y-2"><Label htmlFor="legacy-invoice-date">{documentKind === "bill" ? t("accounting.bills.billDate", { defaultValue: "Bill Date" }) : t("accounting.forms.newInvoice.fields.invoiceDate", { defaultValue: "Invoice Date" })}</Label><DatePicker id="legacy-invoice-date" value={invoiceDate} onChange={(value) => setInvoiceDate(value)} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-invoice-due-date">{t("accounting.invoices.dueDate", { defaultValue: "Due Date" })}</Label><DatePicker id="legacy-invoice-due-date" min={invoiceDate} value={dueDate} onChange={(value) => setDueDate(value)} /></div>
      </div>
      <div className="grid gap-3 rounded-md border p-3 md:grid-cols-5">
        <div className="space-y-2 md:col-span-2"><Label htmlFor="legacy-line-description">{t("accounting.taxSchedules.columns.description", { defaultValue: "Description" })}</Label><Input id="legacy-line-description" data-testid="create-invoice-line-description" value={line.description} onChange={(event) => setLine((value) => ({ ...value, description: event.target.value }))} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-line-quantity">{t("accounting.forms.newInvoice.columns.qty", { defaultValue: "Qty" })}</Label><Input id="legacy-line-quantity" type="number" min={0.000001} step="any" value={line.quantity} onChange={(event) => setLine((value) => ({ ...value, quantity: Number(event.target.value) }))} /></div>
        <div className="space-y-2"><Label htmlFor="legacy-line-price">{t("accounting.billCorrection.price", { defaultValue: "Unit price" })}</Label><Input id="legacy-line-price" data-testid="create-invoice-line-unit-price" type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => setLine((value) => ({ ...value, unitPrice: Number(event.target.value) }))} /></div>
        <FieldSelect label={t("accounting.forms.newInvoice.summary.tax", { defaultValue: "Tax" })} testId="create-invoice-line-tax" value={line.taxId || NONE} onChange={(value) => setLine((current) => ({ ...current, taxId: value === NONE ? "" : value }))} options={[{ value: NONE, label: t("accounting.createInvoiceModal.noTax", { defaultValue: "No tax" }) }, ...taxOptions]} />
      </div>
      <div className="text-right text-sm">{t("accounting.createInvoiceModal.subtotal", { defaultValue: "Subtotal:" })} {formatLegacyAmount(amountUntaxed, currencyCode)}  {t("accounting.createInvoiceModal.tax", { defaultValue: "· Tax:" })} {formatLegacyAmount(amountTax, currencyCode)} · <strong>{t("accounting.createInvoiceModal.copy.totalValue", { defaultValue: "Total: {{value1}}", value1: formatLegacyAmount(amountTotal, currencyCode) })}</strong></div>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button data-testid="create-invoice-save-draft" onClick={() => void save()} disabled={!canSave}>{documentKind === "bill" ? t("accounting.createInvoiceModal.saveBillDraft", { defaultValue: "Save bill draft" }) : t("accounting.forms.newInvoice.saveDraft")}</Button></DialogFooter>
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
