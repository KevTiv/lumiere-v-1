"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import type { TFunction } from "i18next"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@lumiere/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { Textarea } from "@lumiere/ui/components/textarea"

export interface PurchasingDialogOption {
  value: string
  label: string
  disabled?: boolean
}

export interface CreatePurchaseRfqFormPayload {
  requisitionId: bigint | null
  currencyId: bigint
  notes: string | null
  lines: Array<{
    productId: bigint
    productUom: bigint
    productUomQty: number
    name: string | null
    sequence: number
  }>
  metadata: null
}

export interface AddPurchaseRfqBidFormPayload {
  rfqId: bigint
  partnerId: bigint
  currencyId: bigint
  priceUnit: number
  notes: string | null
}

export interface AwardPurchaseRfqBidFormPayload {
  rfqId: string
  bidId: string
}

export interface CreatePurchaseReturnFormPayload {
  purchaseOrderId: bigint
  partnerId: bigint
  returnReason: string
  lines: Array<{
    purchaseOrderLineId: null
    productId: bigint
    productUom: bigint
    productUomQty: number
    priceUnit: number
    toRefund: boolean
  }>
}

export interface CreateVendorCreditFormPayload {
  /** Workflow actions key purchase returns by their serialized record id. */
  purchaseReturnId: string
  params: {
    journalId: bigint
    expenseAccountId: bigint
    payableAccountId: bigint
  }
}

export type PurchasingOperationDialogRequest =
  | { kind: "create-rfq"; requisitionId?: string }
  | { kind: "add-rfq-bid"; rfqId?: string }
  | { kind: "award-rfq-bid"; rfqId?: string; bidId?: string }
  | { kind: "create-purchase-return"; purchaseOrderId?: string; partnerId?: string }
  | { kind: "create-vendor-credit"; purchaseReturnId?: string }

export interface PurchasingRfqBidDialogOption extends PurchasingDialogOption {
  rfqId: string
}

export interface PurchasingOperationDialogOptions {
  requisitions: PurchasingDialogOption[]
  rfqs: PurchasingDialogOption[]
  rfqBids: PurchasingRfqBidDialogOption[]
  vendors: PurchasingDialogOption[]
  products: PurchasingDialogOption[]
  uoms: PurchasingDialogOption[]
  purchaseOrders: PurchasingDialogOption[]
  purchaseReturns: PurchasingDialogOption[]
  journals: PurchasingDialogOption[]
  expenseAccounts: PurchasingDialogOption[]
  payableAccounts: PurchasingDialogOption[]
}

export interface PurchasingOperationDialogsProps {
  request: PurchasingOperationDialogRequest | null
  defaultCurrencyId: bigint | null
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onCreateRfq: (payload: CreatePurchaseRfqFormPayload) => Promise<unknown>
  onAddRfqBid: (payload: AddPurchaseRfqBidFormPayload) => Promise<unknown>
  onAwardRfqBid: (payload: AwardPurchaseRfqBidFormPayload) => Promise<unknown>
  onCreatePurchaseReturn: (payload: CreatePurchaseReturnFormPayload) => Promise<unknown>
  onCreateVendorCredit: (payload: CreateVendorCreditFormPayload) => Promise<unknown>
}

const NONE_VALUE = "__none__"

function requiredId(value: string, label: string, t: TFunction): bigint {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error(t("purchasing.forms.validation.required", { defaultValue: "{{label}} is required", label }))
  }
  return BigInt(normalized)
}

function requiredIdString(value: string, label: string, t: TFunction): string {
  return requiredId(value, label, t).toString()
}

function optionalId(value: string, t: TFunction): bigint | null {
  return value && value !== NONE_VALUE ? requiredId(value, t("purchasing.forms.fields.selection", { defaultValue: "Selection" }), t) : null
}

function finiteNumber(value: string, label: string, minimum: number, t: TFunction): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(t("purchasing.forms.validation.minimum", { defaultValue: "{{label}} must be {{minimum}}", label, minimum: minimum > 0 ? t("purchasing.forms.validation.greaterThanZero", { defaultValue: "greater than zero" }) : t("purchasing.forms.validation.zeroOrGreater", { defaultValue: "zero or greater" }) }))
  }
  return parsed
}

interface ChoiceFieldProps {
  id: string
  label: string
  value: string
  options: PurchasingDialogOption[]
  onValueChange: (value: string) => void
  placeholder: string
  optional?: boolean
  t: TFunction
}

function ChoiceField({
  id,
  label,
  value,
  options,
  onValueChange,
  placeholder,
  optional = false,
  t,
}: ChoiceFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE_VALUE}>{t("purchasing.forms.common.none", { defaultValue: "None" })}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("purchasing.forms.common.noChoices", { defaultValue: "No choices are available." })}</p>
      ) : null}
    </div>
  )
}

interface OperationDialogProps {
  title: string
  description: string
  submitLabel: string
  pending: boolean
  error: string | null
  onDismiss: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  t: TFunction
}

function OperationDialog({
  title,
  description,
  submitLabel,
  pending,
  error,
  onDismiss,
  onSubmit,
  children,
  t,
}: OperationDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onDismiss())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>
              {t("purchasing.forms.common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("purchasing.forms.common.saving", { defaultValue: "Saving…" }) : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useAsyncSubmit(onDismiss: () => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (submit: () => Promise<unknown>) => {
    setError(null)
    setPending(true)
    try {
      await submit()
      onDismiss()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return { pending, error, run }
}

interface CreateRfqDialogProps {
  request: Extract<PurchasingOperationDialogRequest, { kind: "create-rfq" }>
  currencyId: bigint | null
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onSubmit: (payload: CreatePurchaseRfqFormPayload) => Promise<unknown>
}

function CreateRfqDialog({ request, currencyId, options, t, onDismiss, onSubmit }: CreateRfqDialogProps) {
  const [requisitionId, setRequisitionId] = useState(request.requisitionId ?? NONE_VALUE)
  const [productId, setProductId] = useState("")
  const [uomId, setUomId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [lineName, setLineName] = useState("")
  const [notes, setNotes] = useState("")
  const submission = useAsyncSubmit(onDismiss)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.run(async () => {
      if (currencyId == null || currencyId <= 0n) throw new Error(t("purchasing.forms.validation.noCurrency", { defaultValue: "No active currency is available" }))
      await onSubmit({
        requisitionId: optionalId(requisitionId, t),
        currencyId,
        notes: notes.trim() || null,
        lines: [{
          productId: requiredId(productId, t("purchasing.forms.fields.product", { defaultValue: "Product" }), t),
          productUom: requiredId(uomId, t("purchasing.forms.fields.uom", { defaultValue: "Unit of measure" }), t),
          productUomQty: finiteNumber(quantity, t("purchasing.forms.fields.quantity", { defaultValue: "Quantity" }), Number.MIN_VALUE, t),
          name: lineName.trim() || null,
          sequence: 10,
        }],
        metadata: null,
      })
    })
  }

  return (
    <OperationDialog
      title={t("purchasing.forms.rfq.title", { defaultValue: "Create request for quotation" })}
      description={t("purchasing.forms.rfq.description", { defaultValue: "Create an RFQ with its first requested product line." })}
      submitLabel={t("purchasing.ops.createRfq", { defaultValue: "Create RFQ" })}
      pending={submission.pending}
      error={submission.error}
      onDismiss={onDismiss}
      onSubmit={submit}
      t={t}
    >
      <ChoiceField id="rfq-requisition" label={t("purchasing.forms.fields.requisition", { defaultValue: "Requisition" })} value={requisitionId} options={options.requisitions} onValueChange={setRequisitionId} placeholder={t("purchasing.forms.placeholders.requisition", { defaultValue: "Select a requisition" })} optional t={t} />
      <ChoiceField id="rfq-product" label={t("purchasing.forms.fields.product", { defaultValue: "Product" })} value={productId} options={options.products} onValueChange={setProductId} placeholder={t("purchasing.forms.placeholders.product", { defaultValue: "Select a product" })} t={t} />
      <ChoiceField id="rfq-uom" label={t("purchasing.forms.fields.uom", { defaultValue: "Unit of measure" })} value={uomId} options={options.uoms} onValueChange={setUomId} placeholder={t("purchasing.forms.placeholders.uom", { defaultValue: "Select a unit" })} t={t} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rfq-quantity">{t("purchasing.forms.fields.quantity", { defaultValue: "Quantity" })}</Label>
          <Input id="rfq-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rfq-line-name">{t("purchasing.forms.fields.lineDescription", { defaultValue: "Line description" })}</Label>
          <Input id="rfq-line-name" value={lineName} onChange={(event) => setLineName(event.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rfq-notes">{t("purchasing.forms.fields.notes", { defaultValue: "Notes" })}</Label>
        <Textarea id="rfq-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </OperationDialog>
  )
}

interface AddRfqBidDialogProps {
  request: Extract<PurchasingOperationDialogRequest, { kind: "add-rfq-bid" }>
  currencyId: bigint | null
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onSubmit: (payload: AddPurchaseRfqBidFormPayload) => Promise<unknown>
}

function AddRfqBidDialog({ request, currencyId, options, t, onDismiss, onSubmit }: AddRfqBidDialogProps) {
  const [rfqId, setRfqId] = useState(request.rfqId ?? "")
  const [partnerId, setPartnerId] = useState("")
  const [priceUnit, setPriceUnit] = useState("0")
  const [notes, setNotes] = useState("")
  const submission = useAsyncSubmit(onDismiss)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.run(async () => {
      if (currencyId == null || currencyId <= 0n) throw new Error(t("purchasing.forms.validation.noCurrency", { defaultValue: "No active currency is available" }))
      await onSubmit({
        rfqId: requiredId(rfqId, t("purchasing.forms.fields.rfq", { defaultValue: "RFQ" }), t),
        partnerId: requiredId(partnerId, t("purchasing.forms.fields.vendor", { defaultValue: "Vendor" }), t),
        currencyId,
        priceUnit: finiteNumber(priceUnit, t("purchasing.forms.fields.unitPrice", { defaultValue: "Unit price" }), 0, t),
        notes: notes.trim() || null,
      })
    })
  }

  return (
    <OperationDialog
      title={t("purchasing.forms.rfqBid.title", { defaultValue: "Add RFQ bid" })}
      description={t("purchasing.forms.rfqBid.description", { defaultValue: "Record a vendor's quoted unit price." })}
      submitLabel={t("purchasing.ops.addRfqBid", { defaultValue: "Add RFQ bid" })}
      pending={submission.pending}
      error={submission.error}
      onDismiss={onDismiss}
      onSubmit={submit}
      t={t}
    >
      <ChoiceField id="bid-rfq" label={t("purchasing.forms.fields.rfq", { defaultValue: "RFQ" })} value={rfqId} options={options.rfqs} onValueChange={setRfqId} placeholder={t("purchasing.forms.placeholders.rfq", { defaultValue: "Select an RFQ" })} t={t} />
      <ChoiceField id="bid-vendor" label={t("purchasing.forms.fields.vendor", { defaultValue: "Vendor" })} value={partnerId} options={options.vendors} onValueChange={setPartnerId} placeholder={t("purchasing.forms.placeholders.vendor", { defaultValue: "Select a vendor" })} t={t} />
      <div className="space-y-2">
        <Label htmlFor="bid-price">{t("purchasing.forms.fields.unitPrice", { defaultValue: "Unit price" })}</Label>
        <Input id="bid-price" type="number" min="0" step="any" required value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bid-notes">{t("purchasing.forms.fields.notes", { defaultValue: "Notes" })}</Label>
        <Textarea id="bid-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
    </OperationDialog>
  )
}

interface AwardRfqBidDialogProps {
  request: Extract<PurchasingOperationDialogRequest, { kind: "award-rfq-bid" }>
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onSubmit: (payload: AwardPurchaseRfqBidFormPayload) => Promise<unknown>
}

function AwardRfqBidDialog({ request, options, t, onDismiss, onSubmit }: AwardRfqBidDialogProps) {
  const [rfqId, setRfqId] = useState(request.rfqId ?? "")
  const [bidId, setBidId] = useState(request.bidId ?? "")
  const submission = useAsyncSubmit(onDismiss)
  const bidOptions = options.rfqBids.filter((option) => option.rfqId === rfqId)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.run(() =>
      onSubmit({
        rfqId: requiredIdString(rfqId, t("purchasing.forms.fields.rfq", { defaultValue: "RFQ" }), t),
        bidId: requiredIdString(bidId, t("purchasing.forms.fields.rfqBid", { defaultValue: "RFQ bid" }), t),
      }),
    )
  }

  return (
    <OperationDialog
      title={t("purchasing.forms.rfqAward.title", { defaultValue: "Award RFQ bid" })}
      description={t("purchasing.forms.rfqAward.description", {
        defaultValue: "Select an open RFQ and one of its submitted bids.",
      })}
      submitLabel={t("purchasing.ops.awardRfqBid", { defaultValue: "Award RFQ bid" })}
      pending={submission.pending}
      error={submission.error}
      onDismiss={onDismiss}
      onSubmit={submit}
      t={t}
    >
      <ChoiceField
        id="award-rfq"
        label={t("purchasing.forms.fields.rfq", { defaultValue: "RFQ" })}
        value={rfqId}
        options={options.rfqs}
        onValueChange={(value) => {
          setRfqId(value)
          setBidId("")
        }}
        placeholder={t("purchasing.forms.placeholders.rfq", { defaultValue: "Select an RFQ" })}
        t={t}
      />
      <ChoiceField
        id="award-rfq-bid"
        label={t("purchasing.forms.fields.submittedBid", { defaultValue: "Submitted bid" })}
        value={bidId}
        options={bidOptions}
        onValueChange={setBidId}
        placeholder={rfqId ? t("purchasing.forms.placeholders.submittedBid", { defaultValue: "Select a submitted bid" }) : t("purchasing.forms.placeholders.rfqFirst", { defaultValue: "Select an RFQ first" })}
        t={t}
      />
    </OperationDialog>
  )
}

interface CreatePurchaseReturnDialogProps {
  request: Extract<PurchasingOperationDialogRequest, { kind: "create-purchase-return" }>
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onSubmit: (payload: CreatePurchaseReturnFormPayload) => Promise<unknown>
}

function CreatePurchaseReturnDialog({ request, options, t, onDismiss, onSubmit }: CreatePurchaseReturnDialogProps) {
  const [purchaseOrderId, setPurchaseOrderId] = useState(request.purchaseOrderId ?? "")
  const [partnerId, setPartnerId] = useState(request.partnerId ?? "")
  const [reason, setReason] = useState("")
  const [productId, setProductId] = useState("")
  const [uomId, setUomId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [priceUnit, setPriceUnit] = useState("0")
  const [toRefund, setToRefund] = useState(true)
  const submission = useAsyncSubmit(onDismiss)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.run(() => onSubmit({
      purchaseOrderId: requiredId(purchaseOrderId, t("purchasing.forms.fields.purchaseOrder", { defaultValue: "Purchase order" }), t),
      partnerId: requiredId(partnerId, t("purchasing.forms.fields.vendor", { defaultValue: "Vendor" }), t),
      // This value is persisted as business data and must not vary by UI locale.
      returnReason: reason.trim() || "Purchase return",
      lines: [{
        purchaseOrderLineId: null,
        productId: requiredId(productId, t("purchasing.forms.fields.product", { defaultValue: "Product" }), t),
        productUom: requiredId(uomId, t("purchasing.forms.fields.uom", { defaultValue: "Unit of measure" }), t),
        productUomQty: finiteNumber(quantity, t("purchasing.forms.fields.quantity", { defaultValue: "Quantity" }), Number.MIN_VALUE, t),
        priceUnit: finiteNumber(priceUnit, t("purchasing.forms.fields.unitPrice", { defaultValue: "Unit price" }), 0, t),
        toRefund,
      }],
    }))
  }

  return (
    <OperationDialog
      title={t("purchasing.forms.purchaseReturn.title", { defaultValue: "Create purchase return" })}
      description={t("purchasing.forms.purchaseReturn.description", { defaultValue: "Record the vendor, reason, and product being returned." })}
      submitLabel={t("purchasing.ops.createPurchaseReturn", { defaultValue: "Create purchase return" })}
      pending={submission.pending}
      error={submission.error}
      onDismiss={onDismiss}
      onSubmit={submit}
      t={t}
    >
      <ChoiceField id="return-order" label={t("purchasing.forms.fields.purchaseOrder", { defaultValue: "Purchase order" })} value={purchaseOrderId} options={options.purchaseOrders} onValueChange={setPurchaseOrderId} placeholder={t("purchasing.forms.placeholders.purchaseOrder", { defaultValue: "Select a purchase order" })} t={t} />
      <ChoiceField id="return-vendor" label={t("purchasing.forms.fields.vendor", { defaultValue: "Vendor" })} value={partnerId} options={options.vendors} onValueChange={setPartnerId} placeholder={t("purchasing.forms.placeholders.vendor", { defaultValue: "Select a vendor" })} t={t} />
      <div className="space-y-2">
        <Label htmlFor="return-reason">{t("purchasing.forms.fields.returnReason", { defaultValue: "Return reason" })}</Label>
        <Textarea id="return-reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <ChoiceField id="return-product" label={t("purchasing.forms.fields.product", { defaultValue: "Product" })} value={productId} options={options.products} onValueChange={setProductId} placeholder={t("purchasing.forms.placeholders.product", { defaultValue: "Select a product" })} t={t} />
      <ChoiceField id="return-uom" label={t("purchasing.forms.fields.uom", { defaultValue: "Unit of measure" })} value={uomId} options={options.uoms} onValueChange={setUomId} placeholder={t("purchasing.forms.placeholders.uom", { defaultValue: "Select a unit" })} t={t} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="return-quantity">{t("purchasing.forms.fields.quantity", { defaultValue: "Quantity" })}</Label>
          <Input id="return-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="return-price">{t("purchasing.forms.fields.unitPrice", { defaultValue: "Unit price" })}</Label>
          <Input id="return-price" type="number" min="0" step="any" required value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm" htmlFor="return-refund">
        <input id="return-refund" type="checkbox" checked={toRefund} onChange={(event) => setToRefund(event.target.checked)} />
        {t("purchasing.forms.purchaseReturn.refundableLine", { defaultValue: "Create a refundable return line" })}
      </label>
    </OperationDialog>
  )
}

interface CreateVendorCreditDialogProps {
  request: Extract<PurchasingOperationDialogRequest, { kind: "create-vendor-credit" }>
  options: PurchasingOperationDialogOptions
  t: TFunction
  onDismiss: () => void
  onSubmit: (payload: CreateVendorCreditFormPayload) => Promise<unknown>
}

function CreateVendorCreditDialog({ request, options, t, onDismiss, onSubmit }: CreateVendorCreditDialogProps) {
  const [purchaseReturnId, setPurchaseReturnId] = useState(request.purchaseReturnId ?? "")
  const [journalId, setJournalId] = useState("")
  const [expenseAccountId, setExpenseAccountId] = useState("")
  const [payableAccountId, setPayableAccountId] = useState("")
  const submission = useAsyncSubmit(onDismiss)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submission.run(() => onSubmit({
      purchaseReturnId: requiredIdString(purchaseReturnId, t("purchasing.forms.fields.purchaseReturn", { defaultValue: "Purchase return" }), t),
      params: {
        journalId: requiredId(journalId, t("purchasing.forms.fields.journal", { defaultValue: "Journal" }), t),
        expenseAccountId: requiredId(expenseAccountId, t("purchasing.forms.fields.expenseAccount", { defaultValue: "Expense account" }), t),
        payableAccountId: requiredId(payableAccountId, t("purchasing.forms.fields.payableAccount", { defaultValue: "Payable account" }), t),
      },
    }))
  }

  return (
    <OperationDialog
      title={t("purchasing.forms.vendorCredit.title", { defaultValue: "Create vendor credit" })}
      description={t("purchasing.forms.vendorCredit.description", { defaultValue: "Choose the journal and ledger accounts for this return credit." })}
      submitLabel={t("purchasing.ops.createVendorCredit", { defaultValue: "Create vendor credit" })}
      pending={submission.pending}
      error={submission.error}
      onDismiss={onDismiss}
      onSubmit={submit}
      t={t}
    >
      <ChoiceField id="credit-return" label={t("purchasing.forms.fields.purchaseReturn", { defaultValue: "Purchase return" })} value={purchaseReturnId} options={options.purchaseReturns} onValueChange={setPurchaseReturnId} placeholder={t("purchasing.forms.placeholders.purchaseReturn", { defaultValue: "Select a purchase return" })} t={t} />
      <ChoiceField id="credit-journal" label={t("purchasing.forms.fields.journal", { defaultValue: "Journal" })} value={journalId} options={options.journals} onValueChange={setJournalId} placeholder={t("purchasing.forms.placeholders.journal", { defaultValue: "Select a journal" })} t={t} />
      <ChoiceField id="credit-expense-account" label={t("purchasing.forms.fields.expenseAccount", { defaultValue: "Expense account" })} value={expenseAccountId} options={options.expenseAccounts} onValueChange={setExpenseAccountId} placeholder={t("purchasing.forms.placeholders.expenseAccount", { defaultValue: "Select an expense account" })} t={t} />
      <ChoiceField id="credit-payable-account" label={t("purchasing.forms.fields.payableAccount", { defaultValue: "Payable account" })} value={payableAccountId} options={options.payableAccounts} onValueChange={setPayableAccountId} placeholder={t("purchasing.forms.placeholders.payableAccount", { defaultValue: "Select a payable account" })} t={t} />
    </OperationDialog>
  )
}

export function PurchasingOperationDialogs({
  request,
  defaultCurrencyId,
  options,
  t,
  onDismiss,
  onCreateRfq,
  onAddRfqBid,
  onAwardRfqBid,
  onCreatePurchaseReturn,
  onCreateVendorCredit,
}: PurchasingOperationDialogsProps) {
  if (request == null) return null

  switch (request.kind) {
    case "create-rfq":
      return <CreateRfqDialog request={request} currencyId={defaultCurrencyId} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreateRfq} />
    case "add-rfq-bid":
      return <AddRfqBidDialog request={request} currencyId={defaultCurrencyId} options={options} t={t} onDismiss={onDismiss} onSubmit={onAddRfqBid} />
    case "award-rfq-bid":
      return <AwardRfqBidDialog request={request} options={options} t={t} onDismiss={onDismiss} onSubmit={onAwardRfqBid} />
    case "create-purchase-return":
      return <CreatePurchaseReturnDialog request={request} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreatePurchaseReturn} />
    case "create-vendor-credit":
      return <CreateVendorCreditDialog request={request} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreateVendorCredit} />
  }
}
