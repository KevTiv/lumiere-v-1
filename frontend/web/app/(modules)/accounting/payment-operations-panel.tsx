"use client"

import { useMemo, useRef, useState } from "react"
import { ArrowLeftRightIcon, Building2Icon, CircleDollarSignIcon, FileUpIcon, PlusIcon, ReceiptTextIcon, RotateCcwIcon, SendIcon, Trash2Icon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  allocateOperationalPaymentForm,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  newOperationalPaymentAccountForm,
  newOperationalPaymentFeeForm,
  newOperationalPaymentTransactionForm,
  reverseOperationalPaymentForm,
  RuntimeFormModal,
  stageBankStatementImportForm,
} from "@lumiere/ui"
import {
  useApproveBankStatementImport,
  useAllocatePaymentTransaction,
  useCreatePaymentAccount,
  useCreatePaymentFee,
  useCreatePaymentTransaction,
  usePaymentAccounts,
  usePaymentFees,
  usePaymentReconciliations,
  usePaymentReversals,
  usePaymentTransactions,
  usePostPaymentTransaction,
  useReversePaymentTransaction,
  useStageBankStatementImport,
  useVoidPaymentTransaction,
  useBankStatementImports,
} from "@lumiere/query-hooks/hooks/accounting"
import type { PartnerType, PaymentDirection, PaymentFeeBearer, PaymentProviderCode } from "@lumiere/stdb/types"
import { OperationRequestError } from "@lumiere/api-client"
import type { FormConfig, FormField, FormValues } from "@lumiere/ui/lib/form-types"
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { HISTORICAL_ACCOUNTING_IMPORT_SOURCE } from "./historical-payment-import"
import { allocationReadback, allocationSource, paymentId, paymentInputAmount, prepareStatementImport, statementBalanceReview, statementImportReadback, statementReviewMatches, type PaymentLookupRow, type PreparedStatementImport, type WorkflowReadback } from "./payment-workflow-model"
import { PaymentAllocationReview, StatementImportReview, type SubmittedAllocation } from "./payment-workflow-previews"

type Row = Record<string, unknown>

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function idList(value: unknown): bigint[] {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => BigInt(part))
}

function enumName(value: unknown): string {
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value ?? "")
}

function enumValue<T>(tag: string): T {
  return { tag } as T
}

function rowId(row: Row): bigint | null {
  return asId(row.id)
}

function statusVariant(status: string) {
  if (status === "Posted") return "default" as const
  if (status === "Reversed" || status === "Voided") return "destructive" as const
  return "secondary" as const
}

export interface PaymentOperationsPanelProps {
  organizationId: number
  companyId: bigint
  defaultCurrencyId: bigint
  currencyOptions: Array<{ value: string; label: string }>
  journalOptions: Array<{ value: string; label: string }>
  glAccountOptions: Array<{ value: string; label: string }>
  partnerOptions: Array<{ value: string; label: string }>
  moveLines: Row[]
  moves?: readonly PaymentLookupRow[]
  glAccounts?: readonly PaymentLookupRow[]
  lookupDataReady?: boolean
}

export function PaymentOperationsPanel({
  organizationId,
  companyId,
  defaultCurrencyId,
  currencyOptions,
  journalOptions,
  glAccountOptions,
  partnerOptions,
  moveLines,
  moves = [],
  glAccounts = [],
  lookupDataReady = false,
}: PaymentOperationsPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const accountsRead = usePaymentAccounts(organization)
  const { data: accounts = [], isLoading: accountsLoading } = accountsRead
  const transactionsRead = usePaymentTransactions(organization)
  const { data: transactions = [], isLoading: transactionsLoading } = transactionsRead
  const reconciliationsRead = usePaymentReconciliations(organization)
  const { data: reconciliations = [] } = reconciliationsRead
  const { data: reversals = [] } = usePaymentReversals(organization)
  const { data: fees = [] } = usePaymentFees(organization)
  const statementImportsRead = useBankStatementImports(organization, companyId)
  const { data: statementImportWorkspace = { imports: [], lines: [] }, isLoading: statementImportsLoading } = statementImportsRead
  const createAccount = useCreatePaymentAccount(organization)
  const createTransaction = useCreatePaymentTransaction(organization)
  const postTransaction = usePostPaymentTransaction(organization)
  const allocateTransaction = useAllocatePaymentTransaction(organization)
  const reverseTransaction = useReversePaymentTransaction(organization)
  const createFee = useCreatePaymentFee(organization)
  const voidTransaction = useVoidPaymentTransaction(organization)
  const stageStatementImport = useStageBankStatementImport(organizationId)
  const approveStatementImport = useApproveBankStatementImport(organizationId)

  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false)
  const [statementImportDialogOpen, setStatementImportDialogOpen] = useState(false)
  const [allocatingTransaction, setAllocatingTransaction] = useState<Row | null>(null)
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false)
  const [submittedAllocation, setSubmittedAllocation] = useState<SubmittedAllocation | null>(null)
  const [allocationRequestState, setAllocationRequestState] = useState<"accepted" | "unknown" | null>(null)
  const [statementReview, setStatementReview] = useState<PreparedStatementImport | null>(null)
  const [submittedStatement, setSubmittedStatement] = useState<PreparedStatementImport | null>(null)
  const [statementRequestState, setStatementRequestState] = useState<"accepted" | "unknown" | null>(null)
  const [statementPreparing, setStatementPreparing] = useState(false)
  const statementValues = useRef<FormValues | null>(null)
  const [reversingTransaction, setReversingTransaction] = useState<Row | null>(null)
  const [feeTransaction, setFeeTransaction] = useState<Row | null>(null)
  const [voidingTransaction, setVoidingTransaction] = useState<Row | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const activeAccounts = useMemo(
    () => (accounts as Row[]).filter((account) => paymentId(account.organizationId) === organization && paymentId(account.companyId) === companyId && optionValue(account.archivedAt) == null && account.active !== false),
    [accounts, organization, companyId],
  )
  const accountOptions = useMemo(
    () => activeAccounts.map((account) => ({
      value: String(account.id),
      label: `${String(account.name ?? account.id)} · ${enumName(account.providerCode)}`,
    })),
    [activeAccounts],
  )
  const accountById = useMemo(
    () => new Map(activeAccounts.map((account) => [String(account.id), account])),
    [activeAccounts],
  )
  const allocationData = useMemo(() => allocationSource({
    transactionId: allocatingTransaction?.id, organizationId: organization, companyId,
    ready: lookupDataReady && accountsRead.isSuccess && !accountsRead.isFetching && transactionsRead.isSuccess && !transactionsRead.isFetching && reconciliationsRead.isSuccess && !reconciliationsRead.isFetching,
    transactions, paymentAccounts: accounts, reconciliations, lines: moveLines, moves, glAccounts,
  }), [allocatingTransaction?.id, organization, companyId, lookupDataReady, accountsRead.isSuccess, accountsRead.isFetching, transactionsRead.isSuccess, transactionsRead.isFetching, reconciliationsRead.isSuccess, reconciliationsRead.isFetching, transactions, accounts, reconciliations, moveLines, moves, glAccounts])
  const allocationResult: WorkflowReadback = submittedAllocation && reconciliationsRead.isSuccess && !reconciliationsRead.isFetching
    ? allocationReadback(submittedAllocation.params, reconciliations, organization) : { kind: "pending" }
  const statementResult: WorkflowReadback = submittedStatement && statementImportsRead.isSuccess && !statementImportsRead.isFetching
    ? statementImportReadback(submittedStatement, statementImportWorkspace.imports, statementImportWorkspace.lines) : { kind: "pending" }
  const moveLineOptions = useMemo(() => {
    const items = allocationData.kind === "ready" ? allocationData.items : []
    const options = items.map((item) => ({ value: String(item.line.id), label: `${String(item.move.name ?? item.move.id)} · ${String(item.line.name ?? item.line.id)} · ${item.residual.toLocaleString()}` }))
    if (submittedAllocation && !options.some((option) => option.value === String(submittedAllocation.params.allocatedMoveLineId))) {
      options.push({ value: String(submittedAllocation.params.allocatedMoveLineId), label: String(submittedAllocation.item.line.name ?? submittedAllocation.item.line.id) })
    }
    return options
  }, [allocationData, submittedAllocation])
  const reconciliationsByTransaction = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const reconciliation of reconciliations as Row[]) {
      const key = String(reconciliation.paymentTransactionId ?? "")
      map.set(key, [...(map.get(key) ?? []), reconciliation])
    }
    return map
  }, [reconciliations])
  const reversedTransactionIds = useMemo(
    () => new Set((reversals as Row[]).map((reversal) => String(reversal.originalTransactionId ?? ""))),
    [reversals],
  )
  const feesByTransaction = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const fee of fees as Row[]) {
      const key = String(fee.paymentTransactionId ?? "")
      map.set(key, [...(map.get(key) ?? []), fee])
    }
    return map
  }, [fees])
  const statementImports = statementImportWorkspace.imports as Row[]
  const statementImportLines = statementImportWorkspace.lines as Row[]

  const paymentAccountForm = useMemo(
    () => mergeFieldDefaultValues(mergeSelectOptionsForFields(newOperationalPaymentAccountForm(t), {
      currencyId: currencyOptions,
      accountJournalId: journalOptions,
      feeAccountId: glAccountOptions,
      clearingAccountId: glAccountOptions,
    }), { currencyId: String(defaultCurrencyId) }),
    [currencyOptions, defaultCurrencyId, glAccountOptions, journalOptions, t],
  )
  const paymentTransactionForm = useMemo(
    () => mergeFieldDefaultValues(mergeSelectOptionsForFields(newOperationalPaymentTransactionForm(t), {
      paymentAccountId: accountOptions,
      partnerId: partnerOptions,
      currencyId: currencyOptions,
    }), { currencyId: String(defaultCurrencyId) }),
    [accountOptions, currencyOptions, defaultCurrencyId, partnerOptions, t],
  )
  const allocationForm = useMemo(
    (): FormConfig => {
      const form = mergeFieldDefaultValues(mergeSelectOptionsForFields(allocateOperationalPaymentForm(t), {
        allocatedMoveLineId: moveLineOptions,
        writeOffAccountId: allocationData.kind === "ready" ? allocationData.writeOffAccounts.map((account) => ({ value: String(account.id), label: String(account.name ?? account.id) })) : [],
      }), { writeOffAmount: 0 })
      return { ...form, size: "xl", sections: form.sections.map((section) => ({ ...section, fields: section.fields.flatMap<FormField>((field) => {
        if (field.name === "allocatedMoveLineId" && field.type === "select") return [{ ...field, searchable: true }]
        if (field.name === "writeOffAmount") return [
          { id: "writeOffEnabled", name: "writeOffEnabled", type: "switch" as const, label: t("accounting.workflowTools.enableWriteOff", { defaultValue: "Add a separate write-off" }), defaultValue: false, width: "full" as const },
          { ...field, visibleWhen: { field: "writeOffEnabled", equals: "true" }, validation: { custom: (value: unknown) => (paymentInputAmount(value) ?? 0) > 0 ? null : t("accounting.workflowTools.positiveWriteOff", { defaultValue: "Enter a positive write-off amount, or turn off the write-off." }) } },
        ]
        if (field.name === "writeOffAccountId") return [{ ...field, visibleWhen: { field: "writeOffEnabled", equals: "true" }, required: true }]
        return [field]
      }) })) }
    },
    [allocationData, moveLineOptions, t],
  )
  const paymentFeeForm = useMemo(
    () => mergeSelectOptionsForFields(newOperationalPaymentFeeForm(t), {
      feeAccountId: glAccountOptions,
      taxAccountId: glAccountOptions,
    }),
    [glAccountOptions, t],
  )
  const statementImportForm = useMemo(
    () => ({ ...mergeFieldDefaultValues(mergeSelectOptionsForFields(stageBankStatementImportForm(t), {
      journalId: journalOptions,
      currencyId: currencyOptions,
    }), { currencyId: String(defaultCurrencyId), openingBalance: 0 }), size: "xl" as const,
    submitLabel: t("accounting.workflowTools.stageReviewed", { defaultValue: "Stage reviewed rows" }) }),
    [currencyOptions, defaultCurrencyId, journalOptions, t],
  )

  const saveAccount = async (data: Row) => {
    try {
      setFormError(null)
      const currencyId = asId(data.currencyId)
      const accountJournalId = asId(data.accountJournalId)
      const providerCode = stringValue(data.providerCode) || "Other"
      const providerLabel = stringValue(data.providerLabel)
      if (companyId <= 0n || currencyId == null || accountJournalId == null) throw new Error("Choose a company currency and accounting journal")
      if (providerCode === "Other" && !providerLabel) throw new Error("Enter the provider label")
      await createAccount.mutateAsync({
        companyId,
        providerCode: enumValue<PaymentProviderCode>(providerCode),
        name: stringValue(data.name),
        providerLabel: providerLabel || undefined,
        referenceRaw: stringValue(data.referenceRaw) || undefined,
        currencyId,
        accountJournalId,
        feeAccountId: asId(data.feeAccountId) ?? undefined,
        clearingAccountId: asId(data.clearingAccountId) ?? undefined,
        isPrimary: data.isPrimary === true,
        metadata: undefined,
      })
      setAccountDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to create the payment account"
      setFormError(message)
      throw cause
    }
  }

  const saveTransaction = async (data: Row) => {
    try {
      setFormError(null)
      const paymentAccountId = asId(data.paymentAccountId)
      const partnerId = asId(data.partnerId)
      const currencyId = asId(data.currencyId)
      const occurredAt = new Date(stringValue(data.occurredAt))
      const sourceEntity = stringValue(data.sourceEntity)
      const sourceEntityId = asId(data.sourceEntityId)
      if (companyId <= 0n || paymentAccountId == null || partnerId == null || currencyId == null) throw new Error("Choose a payment account, partner, and currency")
      if (Number.isNaN(occurredAt.getTime())) throw new Error("Enter a valid provider event time")
      if ((sourceEntity !== "") !== (sourceEntityId != null)) {
        throw new Error("Source record type and ID must be supplied together")
      }
      await createTransaction.mutateAsync({
        companyId,
        paymentAccountId,
        direction: enumValue<PaymentDirection>(stringValue(data.direction) || "Inbound"),
        partnerType: enumValue<PartnerType>(stringValue(data.partnerType) || "Customer"),
        partnerId,
        externalReference: stringValue(data.externalReference) || undefined,
        grossExternalAmount: numberValue(data.grossExternalAmount),
        settlementAmount: numberValue(data.settlementAmount),
        netAccountAmount: numberValue(data.netAccountAmount),
        currencyId,
        occurredAt: stbTimestampFromDate(occurredAt),
        sourceEntity: sourceEntity || undefined,
        sourceEntityId: sourceEntityId ?? undefined,
        evidenceDocumentIds: idList(data.evidenceDocumentIds),
        metadata: undefined,
      })
      setTransactionDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to record the payment transaction"
      setFormError(message)
      throw cause
    }
  }

  const openAllocation = (transaction: Row) => {
    setFormError(null)
    if (!submittedAllocation || allocationResult.kind === "confirmed") {
      setAllocatingTransaction(transaction)
      setSubmittedAllocation(null)
      setAllocationRequestState(null)
    }
    setAllocationDialogOpen(true)
  }

  const closeAllocation = (open: boolean) => {
    setAllocationDialogOpen(open)
    if (!open && (!submittedAllocation || allocationResult.kind === "confirmed")) {
      setAllocatingTransaction(null)
      setSubmittedAllocation(null)
      setAllocationRequestState(null)
    }
  }

  const saveAllocation = async (data: FormValues) => {
    if (submittedAllocation) return
    let submitted = false
    try {
      setFormError(null)
      const source = allocationData
      const allocatedMoveLineId = paymentId(data.allocatedMoveLineId)
      const item = source.kind === "ready" ? source.items.find((candidate) => paymentId(candidate.line.id) === allocatedMoveLineId) : null
      const allocatedAmount = paymentInputAmount(data.allocatedAmount)
      const writeOffAmount = data.writeOffEnabled === true ? paymentInputAmount(data.writeOffAmount) : 0
      const writeOffAccountId = data.writeOffEnabled === true ? paymentId(data.writeOffAccountId) : null
      if (source.kind !== "ready" || !item || allocatedMoveLineId == null || allocatedAmount == null || allocatedAmount <= 0) {
        throw new Error(t("accounting.workflowTools.invalidAllocation", { defaultValue: "Choose a current open item and enter a positive allocation amount." }))
      }
      if (writeOffAmount == null || writeOffAmount < 0 || (data.writeOffEnabled === true && (writeOffAmount <= 0 || !source.writeOffAccounts.some((account) => paymentId(account.id) === writeOffAccountId)))) {
        throw new Error(t("accounting.workflowTools.invalidWriteOff", { defaultValue: "Enter a positive write-off and choose an allowed write-off account, or turn off the write-off." }))
      }
      const transactionId = paymentId(source.transaction.id)
      const currencyId = paymentId(source.transaction.currencyId)
      if (!transactionId || !currencyId) throw new Error(t("accounting.workflowTools.unavailableAllocation", { defaultValue: "The authorized payment or open-item data is unavailable. Refresh the data before allocating. Missing balances are not treated as zero." }))
      const request: SubmittedAllocation = { transaction: source.transaction, item, available: source.available, params: {
        idempotencyKey: `allocate-payment:${globalThis.crypto.randomUUID()}`,
        companyId, paymentTransactionId: transactionId, allocatedMoveLineId, allocatedAmount, currencyId,
        writeOffAmount, writeOffAccountId: writeOffAccountId ?? undefined, metadata: undefined,
      } }
      setSubmittedAllocation(request)
      setAllocationRequestState("unknown")
      submitted = true
      await allocateTransaction.mutateAsync(request.params)
      setAllocationRequestState("accepted")
    } catch (cause) {
      if (submitted && cause instanceof OperationRequestError && cause.retry !== "reconcile") {
        setSubmittedAllocation(null)
        setAllocationRequestState(null)
      }
      setFormError(cause instanceof Error ? cause.message : t("accounting.workflowTools.allocationFailed", { defaultValue: "Unable to allocate the payment" }))
      throw cause
    }
  }

  const saveReversal = async (data: Row) => {
    const transactionId = reversingTransaction && rowId(reversingTransaction)
    try {
      setFormError(null)
      if (transactionId == null) throw new Error("The selected transaction has no ID")
      await reverseTransaction.mutateAsync({
        transactionId,
        params: { companyId, reason: stringValue(data.reason) || undefined, metadata: undefined },
      })
      setReversingTransaction(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to reverse the payment"
      setFormError(message)
      throw cause
    }
  }

  const saveFee = async (data: Row) => {
    const transaction = feeTransaction
    const transactionId = transaction == null ? null : rowId(transaction)
    try {
      setFormError(null)
      if (transaction == null || transactionId == null) throw new Error("The selected transaction has no ID")
      const amount = numberValue(data.amount)
      const taxAmount = numberValue(data.taxAmount)
      const paymentAccount = accountById.get(String(transaction.paymentAccountId))
      const feeAccountId = asId(data.feeAccountId) ?? asId(paymentAccount?.feeAccountId)
      const taxAccountId = asId(data.taxAccountId)
      if (amount > 0 && feeAccountId == null) throw new Error("Choose a fee expense account")
      if (taxAmount > 0 && taxAccountId == null) throw new Error("Choose a fee tax account")
      await createFee.mutateAsync({
        companyId,
        paymentTransactionId: transactionId,
        bearer: enumValue<PaymentFeeBearer>(stringValue(data.bearer) || "Company"),
        amount,
        feeAccountId: feeAccountId ?? undefined,
        taxAccountId: taxAccountId ?? undefined,
        taxAmount,
        providerReference: stringValue(data.providerReference) || undefined,
        metadata: undefined,
      })
      setFeeTransaction(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to add the payment fee"
      setFormError(message)
      throw cause
    }
  }

  const voidDraft = async () => {
    const transactionId = voidingTransaction == null ? null : rowId(voidingTransaction)
    if (transactionId == null) return
    try {
      setActionError(null)
      await voidTransaction.mutateAsync(transactionId)
      setVoidingTransaction(null)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to void the payment")
    }
  }

  const reviewStatementImport = async () => {
    if (submittedStatement || statementPreparing) return
    try {
      setFormError(null)
      setStatementPreparing(true)
      const values = statementValues.current
      if (!values) throw new Error(t("accounting.workflowTools.reviewFirst", { defaultValue: "Choose a CSV file and statement setup, then select Review CSV. No rows are sent to the server during this review." }))
      const review = await prepareStatementImport(values, companyId, t("accounting.workflowTools.importSetup", { defaultValue: "Choose a CSV file, journal, currency, and finite opening balance." }))
      if (statementValues.current && statementReviewMatches(review, statementValues.current, companyId)) setStatementReview(review)
    } catch (cause) {
      setStatementReview(null)
      setFormError(cause instanceof Error ? cause.message : t("accounting.workflowTools.reviewFailed", { defaultValue: "Unable to review the CSV" }))
    } finally {
      setStatementPreparing(false)
    }
  }

  const closeStatementImport = (open: boolean) => {
    setStatementImportDialogOpen(open)
    if (!open && (!submittedStatement || statementResult.kind === "confirmed")) {
      setStatementReview(null)
      setSubmittedStatement(null)
      setStatementRequestState(null)
      statementValues.current = null
    }
  }

  const saveStatementImport = async (data: FormValues) => {
    if (submittedStatement) return
    let submitted = false
    try {
      setFormError(null)
      const review = statementReview
      if (!review || !statementReviewMatches(review, data, companyId) || !statementBalanceReview(review).withinEnvelope) {
        throw new Error(t("accounting.workflowTools.reviewAgain", { defaultValue: "Review the current file and setup before staging." }))
      }
      const prior = statementImportReadback(review, statementImportWorkspace.imports, statementImportWorkspace.lines)
      if (prior.kind === "ambiguous" || prior.kind === "conflict") throw new Error(t("accounting.workflowTools.importKeyConflict", { defaultValue: "An import with this file identity has different saved data. Review the saved import before continuing." }))
      setSubmittedStatement(review)
      setStatementRequestState(prior.kind === "confirmed" ? "accepted" : "unknown")
      if (prior.kind === "confirmed") return
      submitted = true
      await stageStatementImport.mutateAsync({ companyId: review.companyId, journalId: review.journalId, currencyId: review.currencyId, params: review.params })
      setStatementRequestState("accepted")
    } catch (cause) {
      if (submitted && cause instanceof OperationRequestError && cause.retry !== "reconcile") {
        setSubmittedStatement(null)
        setStatementRequestState(null)
      }
      setFormError(cause instanceof Error ? cause.message : t("accounting.workflowTools.stageFailed", { defaultValue: "Unable to stage the statement import" }))
      throw cause
    }
  }

  const approveImport = async (statementImport: Row) => {
    const importId = rowId(statementImport)
    if (importId == null) return
    try {
      setActionError(null)
      await approveStatementImport.mutateAsync(importId)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to approve the statement import")
    }
  }

  const post = async (transaction: Row) => {
    const transactionId = rowId(transaction)
    if (transactionId == null) return
    try {
      setActionError(null)
      await postTransaction.mutateAsync(transactionId)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to post the payment")
    }
  }

  const mutationBusy = createAccount.isPending || createTransaction.isPending || postTransaction.isPending || allocateTransaction.isPending || reverseTransaction.isPending || createFee.isPending || voidTransaction.isPending || stageStatementImport.isPending || approveStatementImport.isPending

  return (
    <div className="space-y-4">
      {actionError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p> : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payment accounts</CardTitle>
            <CardDescription>Cash drawers, bank accounts, and mobile-money wallets that post through accounting journals.</CardDescription>
          </div>
          <CardAction><Button size="sm" onClick={() => { setFormError(null); setAccountDialogOpen(true) }}><PlusIcon data-icon="inline-start" />Add account</Button></CardAction>
        </CardHeader>
        <CardContent>
          {activeAccounts.length > 0 ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{activeAccounts.map((account) => (
            <div key={String(account.id)} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{String(account.name ?? account.id)}</p>{account.isPrimary ? <Badge>Primary</Badge> : null}</div>
              <p className="mt-1 text-sm text-muted-foreground">{enumName(account.providerCode)} · {String(optionValue(account.referenceMasked) ?? "No reference")}</p>
            </div>
          ))}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Building2Icon /></EmptyMedia><EmptyTitle>{accountsLoading ? "Loading payment accounts" : "No payment accounts"}</EmptyTitle><EmptyDescription>Create the wallet, cash, or bank account that will receive operational payments.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" onClick={() => setAccountDialogOpen(true)}><PlusIcon data-icon="inline-start" />Add account</Button></EmptyContent></Empty>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Bank statement imports</CardTitle>
            <CardDescription>Stage a CSV for validation first. Approval creates bank-statement lines for the existing manual matching workspace.</CardDescription>
          </div>
          <CardAction><Button size="sm" onClick={() => { setFormError(null); setStatementImportDialogOpen(true) }}><FileUpIcon data-icon="inline-start" />{t("accounting.workflowTools.importCsv", { defaultValue: "Import CSV" })}</Button></CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {statementImports.length > 0 ? statementImports.map((statementImport) => {
            const state = stringValue(statementImport.state).toLowerCase()
            const importLines = statementImportLines.filter((line) => String(line.importId) === String(statementImport.id))
            const failedLines = importLines.filter((line) => stringValue(optionValue(line.validationError))).length
            const invalidRows = numberValue(statementImport.invalidRows)
            const canApprove = state === "staged" && invalidRows === 0
            return <div key={String(statementImport.id)} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><p className="font-medium">{String(optionValue(statementImport.fileName) ?? `Statement import ${statementImport.id}`)}</p><Badge variant={state === "approved" ? "default" : invalidRows > 0 ? "destructive" : "secondary"}>{state || "staged"}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">{numberValue(statementImport.validRows)} valid of {numberValue(statementImport.totalRows)} rows{invalidRows > 0 ? ` · ${invalidRows} need review` : ""}</p>
                  {failedLines > 0 ? <div className="mt-1 text-xs text-destructive"><p>{failedLines} staged row{failedLines === 1 ? " has" : "s have"} a validation error. Correct the CSV and stage it again; the identical retry is safely ignored.</p><ul className="mt-1 list-inside list-disc">{importLines.filter((line) => stringValue(optionValue(line.validationError))).slice(0, 3).map((line) => <li key={String(line.id)}>Row {String(line.rowNumber)}: {stringValue(optionValue(line.validationError))}</li>)}</ul></div> : null}
                  {state === "approved" ? <p className="mt-1 text-xs text-muted-foreground">Ready for matching. Open the Bank Statements workspace to assign candidates or manually reconcile its lines.</p> : null}
                </div>
                {canApprove ? <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => void approveImport(statementImport)}><SendIcon data-icon="inline-start" />Approve to reconcile</Button> : null}
              </div>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileUpIcon /></EmptyMedia><EmptyTitle>{statementImportsLoading ? "Loading statement imports" : "No statement imports"}</EmptyTitle><EmptyDescription>{t("accounting.workflowTools.importEmpty", { defaultValue: "Upload a bank CSV to review its rows and balances before staging." })}</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" onClick={() => setStatementImportDialogOpen(true)}><FileUpIcon data-icon="inline-start" />{t("accounting.workflowTools.importCsv", { defaultValue: "Import CSV" })}</Button></EmptyContent></Empty>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>Transactions & reconciliation</CardTitle><CardDescription>Record provider events, post them to the ledger, then match them to invoice or bill lines. Original-total history imports use the internal transaction ID shown below. Eligible migration payments must use source historical_accounting_import and an operator-supplied positive numeric migration batch reference.</CardDescription></div>
          <CardAction><Button size="sm" disabled={activeAccounts.length === 0} onClick={() => { setFormError(null); setTransactionDialogOpen(true) }}><PlusIcon data-icon="inline-start" />Record payment</Button></CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {(transactions as Row[]).length > 0 ? (transactions as Row[]).map((transaction) => {
            const id = rowId(transaction)
            const status = enumName(transaction.status)
            const allocations = reconciliationsByTransaction.get(String(transaction.id)) ?? []
            const transactionFees = feesByTransaction.get(String(transaction.id)) ?? []
            const account = accountById.get(String(transaction.paymentAccountId))
            const canReverse = status === "Posted" && !reversedTransactionIds.has(String(transaction.id))
            return <div key={String(transaction.id)} data-testid={`payment-operation-${String(transaction.id)}`} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="font-medium">{String(optionValue(transaction.externalReference) ?? `Payment ${transaction.id}`)}</p><Badge variant={statusVariant(status)}>{status || "Draft"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{String(account?.name ?? "Payment account")} · {enumName(transaction.direction)} · {numberValue(transaction.settlementAmount).toLocaleString()}</p><p className="mt-1 select-all font-mono text-xs text-muted-foreground" data-testid={`payment-transaction-id-${String(transaction.id)}`}>Internal transaction ID: {String(transaction.id)}</p>{stringValue(optionValue(transaction.sourceEntity)) === HISTORICAL_ACCOUNTING_IMPORT_SOURCE ? <p className="mt-1 select-all font-mono text-xs text-muted-foreground">Migration batch reference: {String(optionValue(transaction.sourceEntityId) ?? "missing")}</p> : null}{allocations.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{allocations.length} allocation{allocations.length === 1 ? "" : "s"} · {allocations.reduce((sum, allocation) => sum + numberValue(allocation.allocatedAmount), 0).toLocaleString()} matched</p> : null}{transactionFees.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{transactionFees.length} fee{transactionFees.length === 1 ? "" : "s"} · {transactionFees.reduce((sum, fee) => sum + numberValue(fee.amount) + numberValue(fee.taxAmount), 0).toLocaleString()}</p> : null}</div><div className="flex flex-wrap gap-2">{status === "Draft" ? <><Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setFormError(null); setFeeTransaction(transaction) }}><ReceiptTextIcon data-icon="inline-start" />Add fee</Button><Button size="sm" variant="outline" disabled={mutationBusy || id == null} onClick={() => void post(transaction)}><SendIcon data-icon="inline-start" />Post</Button><Button size="sm" variant="outline" disabled={mutationBusy || id == null} onClick={() => setVoidingTransaction(transaction)}><Trash2Icon data-icon="inline-start" />Void</Button></> : null}{status === "Posted" ? <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => openAllocation(transaction)}><ArrowLeftRightIcon data-icon="inline-start" />Allocate</Button> : null}{canReverse ? <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setFormError(null); setReversingTransaction(transaction) }}><RotateCcwIcon data-icon="inline-start" />Reverse</Button> : null}</div></div>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSignIcon /></EmptyMedia><EmptyTitle>{transactionsLoading ? "Loading transactions" : "No payment transactions"}</EmptyTitle><EmptyDescription>Record a provider event, post it, and allocate it to an open invoice or bill.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>

      <RuntimeFormModal open={accountDialogOpen} onOpenChange={(open) => !open && setAccountDialogOpen(false)} staticConfig={paymentAccountForm} moduleId="accounting" organizationId={organizationId} isPending={createAccount.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveAccount} />
      <RuntimeFormModal open={transactionDialogOpen} onOpenChange={(open) => !open && setTransactionDialogOpen(false)} staticConfig={paymentTransactionForm} moduleId="accounting" organizationId={organizationId} isPending={createTransaction.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveTransaction} />
      <RuntimeFormModal
        open={statementImportDialogOpen} onOpenChange={closeStatementImport} staticConfig={statementImportForm}
        moduleId="accounting" organizationId={organizationId} closeOnSubmit={false} submitError={formError}
        isPending={stageStatementImport.isPending || statementPreparing}
        submissionDisabled={!statementReview || !statementBalanceReview(statementReview).withinEnvelope || submittedStatement != null}
        transformConfig={(config) => ({ ...config, sections: config.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, disabled: field.disabled || submittedStatement != null || statementPreparing })) })) })}
        onValuesChange={(values) => { statementValues.current = values; if (!submittedStatement) setStatementReview(null) }}
        formLeadingActions={<Button type="button" variant="outline" disabled={stageStatementImport.isPending || statementPreparing || submittedStatement != null} onClick={() => void reviewStatementImport()}>{t("accounting.workflowTools.reviewCsv", { defaultValue: "Review CSV" })}</Button>}
        renderPreview={(values) => <StatementImportReview review={submittedStatement ?? (statementReview && statementReviewMatches(statementReview, values, companyId) ? statementReview : null)} submitted={submittedStatement != null} result={statementResult} requestState={statementRequestState}
          onCheck={() => { void statementImportsRead.refetch() }} checking={statementImportsRead.isFetching}
          journalLabel={journalOptions.find((option) => option.value === String((submittedStatement ?? statementReview)?.journalId))?.label ?? "—"}
          currencyLabel={currencyOptions.find((option) => option.value === String((submittedStatement ?? statementReview)?.currencyId))?.label ?? "—"} />}
        onSubmit={saveStatementImport}
      />
      <RuntimeFormModal
        key={allocatingTransaction ? `allocate-${String(allocatingTransaction.id)}` : "allocate-none"}
        open={allocationDialogOpen} onOpenChange={closeAllocation} staticConfig={allocationForm}
        moduleId="accounting" organizationId={organizationId} isPending={allocateTransaction.isPending} closeOnSubmit={false}
        submissionDisabled={submittedAllocation != null || allocationData.kind !== "ready" || allocationData.items.length === 0}
        transformConfig={(config) => ({ ...config, sections: config.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({
          ...field,
          ...((field.name === "writeOffAmount" || field.name === "writeOffAccountId") ? { visibleWhen: { field: "writeOffEnabled", equals: "true" } } : {}),
          disabled: field.disabled || submittedAllocation != null,
        })) })) })}
        submitError={formError} onSubmit={saveAllocation}
        renderPreview={(values) => <PaymentAllocationReview values={values} source={allocationData} submitted={submittedAllocation} result={allocationResult} requestState={allocationRequestState}
          onCheck={() => { void reconciliationsRead.refetch() }} checking={reconciliationsRead.isFetching}
          currencyLabel={currencyOptions.find((option) => option.value === String(submittedAllocation?.params.currencyId ?? (allocationData.kind === "ready" ? allocationData.transaction.currencyId : "")))?.label ?? "—"}
          partnerLabel={partnerOptions.find((option) => option.value === String(submittedAllocation?.transaction.partnerId ?? (allocationData.kind === "ready" ? allocationData.transaction.partnerId : "")))?.label ?? "—"} />}
      />
      <RuntimeFormModal key={reversingTransaction ? `reverse-${String(reversingTransaction.id)}` : "reverse-none"} open={reversingTransaction != null} onOpenChange={(open) => !open && setReversingTransaction(null)} staticConfig={reverseOperationalPaymentForm(t)} moduleId="accounting" organizationId={organizationId} isPending={reverseTransaction.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveReversal} />
      <RuntimeFormModal key={feeTransaction ? `fee-${String(feeTransaction.id)}` : "fee-none"} open={feeTransaction != null} onOpenChange={(open) => !open && setFeeTransaction(null)} staticConfig={paymentFeeForm} moduleId="accounting" organizationId={organizationId} isPending={createFee.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveFee} />
      <AlertDialog open={voidingTransaction != null} onOpenChange={(open) => !open && setVoidingTransaction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Void draft payment?</AlertDialogTitle><AlertDialogDescription>This removes the draft from the posting flow. Posted payments must be reversed instead.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={voidTransaction.isPending}>Keep draft</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={voidTransaction.isPending} onClick={() => void voidDraft()}>Void payment</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
