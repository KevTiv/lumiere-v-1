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
  | { kind: "create-purchase-return"; purchaseOrderId?: string; partnerId?: string }
  | { kind: "create-vendor-credit"; purchaseReturnId?: string }

export interface PurchasingOperationDialogOptions {
  requisitions: PurchasingDialogOption[]
  rfqs: PurchasingDialogOption[]
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
  onCreatePurchaseReturn: (payload: CreatePurchaseReturnFormPayload) => Promise<unknown>
  onCreateVendorCredit: (payload: CreateVendorCreditFormPayload) => Promise<unknown>
}

const NONE_VALUE = "__none__"

function requiredId(value: string, label: string): bigint {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error(`${label} is required`)
  }
  return BigInt(normalized)
}

function requiredIdString(value: string, label: string): string {
  return requiredId(value, label).toString()
}

function optionalId(value: string): bigint | null {
  return value && value !== NONE_VALUE ? requiredId(value, "Selection") : null
}

function finiteNumber(value: string, label: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${label} must be ${minimum > 0 ? "greater than zero" : "zero or greater"}`)
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
}

function ChoiceField({
  id,
  label,
  value,
  options,
  onValueChange,
  placeholder,
  optional = false,
}: ChoiceFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {optional ? <SelectItem value={NONE_VALUE}>None</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No choices are available.</p>
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
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
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
      if (currencyId == null || currencyId <= 0n) throw new Error("No active currency is available")
      await onSubmit({
        requisitionId: optionalId(requisitionId),
        currencyId,
        notes: notes.trim() || null,
        lines: [{
          productId: requiredId(productId, "Product"),
          productUom: requiredId(uomId, "Unit of measure"),
          productUomQty: finiteNumber(quantity, "Quantity", Number.MIN_VALUE),
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
    >
      <ChoiceField id="rfq-requisition" label="Requisition" value={requisitionId} options={options.requisitions} onValueChange={setRequisitionId} placeholder="Select a requisition" optional />
      <ChoiceField id="rfq-product" label="Product" value={productId} options={options.products} onValueChange={setProductId} placeholder="Select a product" />
      <ChoiceField id="rfq-uom" label="Unit of measure" value={uomId} options={options.uoms} onValueChange={setUomId} placeholder="Select a unit" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="rfq-quantity">Quantity</Label>
          <Input id="rfq-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rfq-line-name">Line description</Label>
          <Input id="rfq-line-name" value={lineName} onChange={(event) => setLineName(event.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rfq-notes">Notes</Label>
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
      if (currencyId == null || currencyId <= 0n) throw new Error("No active currency is available")
      await onSubmit({
        rfqId: requiredId(rfqId, "RFQ"),
        partnerId: requiredId(partnerId, "Vendor"),
        currencyId,
        priceUnit: finiteNumber(priceUnit, "Unit price", 0),
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
    >
      <ChoiceField id="bid-rfq" label="RFQ" value={rfqId} options={options.rfqs} onValueChange={setRfqId} placeholder="Select an RFQ" />
      <ChoiceField id="bid-vendor" label="Vendor" value={partnerId} options={options.vendors} onValueChange={setPartnerId} placeholder="Select a vendor" />
      <div className="space-y-2">
        <Label htmlFor="bid-price">Unit price</Label>
        <Input id="bid-price" type="number" min="0" step="any" required value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bid-notes">Notes</Label>
        <Textarea id="bid-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
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
      purchaseOrderId: requiredId(purchaseOrderId, "Purchase order"),
      partnerId: requiredId(partnerId, "Vendor"),
      returnReason: reason.trim() || "Purchase return",
      lines: [{
        purchaseOrderLineId: null,
        productId: requiredId(productId, "Product"),
        productUom: requiredId(uomId, "Unit of measure"),
        productUomQty: finiteNumber(quantity, "Quantity", Number.MIN_VALUE),
        priceUnit: finiteNumber(priceUnit, "Unit price", 0),
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
    >
      <ChoiceField id="return-order" label="Purchase order" value={purchaseOrderId} options={options.purchaseOrders} onValueChange={setPurchaseOrderId} placeholder="Select a purchase order" />
      <ChoiceField id="return-vendor" label="Vendor" value={partnerId} options={options.vendors} onValueChange={setPartnerId} placeholder="Select a vendor" />
      <div className="space-y-2">
        <Label htmlFor="return-reason">Return reason</Label>
        <Textarea id="return-reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <ChoiceField id="return-product" label="Product" value={productId} options={options.products} onValueChange={setProductId} placeholder="Select a product" />
      <ChoiceField id="return-uom" label="Unit of measure" value={uomId} options={options.uoms} onValueChange={setUomId} placeholder="Select a unit" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="return-quantity">Quantity</Label>
          <Input id="return-quantity" type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="return-price">Unit price</Label>
          <Input id="return-price" type="number" min="0" step="any" required value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm" htmlFor="return-refund">
        <input id="return-refund" type="checkbox" checked={toRefund} onChange={(event) => setToRefund(event.target.checked)} />
        Create a refundable return line
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
      purchaseReturnId: requiredIdString(purchaseReturnId, "Purchase return"),
      params: {
        journalId: requiredId(journalId, "Journal"),
        expenseAccountId: requiredId(expenseAccountId, "Expense account"),
        payableAccountId: requiredId(payableAccountId, "Payable account"),
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
    >
      <ChoiceField id="credit-return" label="Purchase return" value={purchaseReturnId} options={options.purchaseReturns} onValueChange={setPurchaseReturnId} placeholder="Select a purchase return" />
      <ChoiceField id="credit-journal" label="Journal" value={journalId} options={options.journals} onValueChange={setJournalId} placeholder="Select a journal" />
      <ChoiceField id="credit-expense-account" label="Expense account" value={expenseAccountId} options={options.expenseAccounts} onValueChange={setExpenseAccountId} placeholder="Select an expense account" />
      <ChoiceField id="credit-payable-account" label="Payable account" value={payableAccountId} options={options.payableAccounts} onValueChange={setPayableAccountId} placeholder="Select a payable account" />
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
  onCreatePurchaseReturn,
  onCreateVendorCredit,
}: PurchasingOperationDialogsProps) {
  if (request == null) return null

  switch (request.kind) {
    case "create-rfq":
      return <CreateRfqDialog request={request} currencyId={defaultCurrencyId} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreateRfq} />
    case "add-rfq-bid":
      return <AddRfqBidDialog request={request} currencyId={defaultCurrencyId} options={options} t={t} onDismiss={onDismiss} onSubmit={onAddRfqBid} />
    case "create-purchase-return":
      return <CreatePurchaseReturnDialog request={request} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreatePurchaseReturn} />
    case "create-vendor-credit":
      return <CreateVendorCreditDialog request={request} options={options} t={t} onDismiss={onDismiss} onSubmit={onCreateVendorCredit} />
  }
}
