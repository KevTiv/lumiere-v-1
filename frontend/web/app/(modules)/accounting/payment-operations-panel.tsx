"use client"

import { useMemo, useState } from "react"
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
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

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

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === delimiter && !quoted) {
      values.push(value.trim())
      value = ""
    } else {
      value += character
    }
  }
  values.push(value.trim())
  return values
}

function parseStatementDate(value: string): Date | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const european = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  const date = iso
    ? new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`)
    : european
      ? new Date(`${european[3]}-${european[2]}-${european[1]}T00:00:00.000Z`)
      : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseStatementAmount(value: string): number | undefined {
  const compact = value.replaceAll(/\s/g, "")
  const normalized = compact.includes(",") && !compact.includes(".")
    ? compact.replace(",", ".")
    : compact.replaceAll(",", "")
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : undefined
}

function statementImportRows(csvData: string) {
  const lines = csvData.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error("Add a header and at least one statement row")
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ","
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.toLowerCase().replaceAll(/[^a-z0-9]/g, ""))
  const dateIndex = headers.findIndex((header) => header === "date" || header === "transactiondate")
  const amountIndex = headers.findIndex((header) => header === "amount" || header === "transactionamount")
  if (dateIndex < 0 || amountIndex < 0) throw new Error("CSV needs date and amount columns")
  const referenceIndex = headers.findIndex((header) => ["reference", "ref", "transactionid"].includes(header))
  const descriptionIndex = headers.findIndex((header) => ["description", "memo", "narration"].includes(header))
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line, delimiter)
    const date = parseStatementDate(values[dateIndex] ?? "")
    return {
      rowNumber: index + 2,
      date: date ? stbTimestampFromDate(date) : undefined,
      amount: parseStatementAmount(values[amountIndex] ?? ""),
      reference: values[referenceIndex] || undefined,
      description: values[descriptionIndex] || undefined,
    }
  })
}

function importIdempotencyKey(companyId: bigint, journalId: bigint, currencyId: bigint, csvData: string): string {
  let hash = 2_166_136_261
  const source = `${companyId}:${journalId}:${currencyId}:${csvData.replace(/\r\n/g, "\n").trim()}`
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619)
  }
  return `statement-csv-${(hash >>> 0).toString(16)}`
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
}: PaymentOperationsPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: accounts = [], isLoading: accountsLoading } = usePaymentAccounts(organization)
  const { data: transactions = [], isLoading: transactionsLoading } = usePaymentTransactions(organization)
  const { data: reconciliations = [] } = usePaymentReconciliations(organization)
  const { data: reversals = [] } = usePaymentReversals(organization)
  const { data: fees = [] } = usePaymentFees(organization)
  const { data: statementImportWorkspace = { imports: [], lines: [] }, isLoading: statementImportsLoading } = useBankStatementImports(organization, companyId)
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
  const [reversingTransaction, setReversingTransaction] = useState<Row | null>(null)
  const [feeTransaction, setFeeTransaction] = useState<Row | null>(null)
  const [voidingTransaction, setVoidingTransaction] = useState<Row | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const activeAccounts = useMemo(
    () => (accounts as Row[]).filter((account) => optionValue(account.archivedAt) == null && account.active !== false),
    [accounts],
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
  const moveLineOptions = useMemo(
    () => moveLines
      .filter((line) => {
        if (allocatingTransaction == null) return false
        const accountType = enumName(line.accountInternalType).toLowerCase()
        return asId(line.companyId) === companyId
          && asId(line.partnerId) === asId(allocatingTransaction.partnerId)
          && asId(line.currencyId) === asId(allocatingTransaction.currencyId)
          && (accountType === "receivable" || accountType === "payable")
          && numberValue(line.amountResidual ?? line.amountResidualCurrency) > 0
      })
      .map((line) => ({
        value: String(line.id ?? ""),
        label: `${String(line.name ?? line.moveName ?? `Line ${line.id}`)} · ${numberValue(line.amountResidual ?? line.amountResidualCurrency).toLocaleString()}`,
      })),
    [allocatingTransaction, companyId, moveLines],
  )
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
    () => mergeFieldDefaultValues(mergeSelectOptionsForFields(allocateOperationalPaymentForm(t), {
      allocatedMoveLineId: moveLineOptions,
      writeOffAccountId: glAccountOptions,
    }), { writeOffAmount: 0 }),
    [glAccountOptions, moveLineOptions, t],
  )
  const paymentFeeForm = useMemo(
    () => mergeSelectOptionsForFields(newOperationalPaymentFeeForm(t), {
      feeAccountId: glAccountOptions,
      taxAccountId: glAccountOptions,
    }),
    [glAccountOptions, t],
  )
  const statementImportForm = useMemo(
    () => mergeFieldDefaultValues(mergeSelectOptionsForFields(stageBankStatementImportForm(t), {
      journalId: journalOptions,
      currencyId: currencyOptions,
    }), { currencyId: String(defaultCurrencyId), openingBalance: 0 }),
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

  const saveAllocation = async (data: Row) => {
    const transaction = allocatingTransaction
    const transactionId = transaction == null ? null : rowId(transaction)
    try {
      setFormError(null)
      const allocatedMoveLineId = asId(data.allocatedMoveLineId)
      const writeOffAmount = numberValue(data.writeOffAmount)
      const writeOffAccountId = asId(data.writeOffAccountId)
      if (transaction == null || transactionId == null || allocatedMoveLineId == null) throw new Error("Choose the invoice or bill line to allocate")
      if (writeOffAmount > 0 && writeOffAccountId == null) throw new Error("Choose a write-off account")
      await allocateTransaction.mutateAsync({
        companyId,
        paymentTransactionId: transactionId,
        allocatedMoveLineId,
        allocatedAmount: numberValue(data.allocatedAmount),
        currencyId: asId(transaction.currencyId) ?? defaultCurrencyId,
        writeOffAmount,
        writeOffAccountId: writeOffAccountId ?? undefined,
        metadata: undefined,
      })
      setAllocatingTransaction(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to allocate the payment"
      setFormError(message)
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

  const saveStatementImport = async (data: Row) => {
    try {
      setFormError(null)
      const journalId = asId(data.journalId)
      const currencyId = asId(data.currencyId)
      const uploadedFiles = data.csvFile
      const csvFile = uploadedFiles instanceof FileList
        ? uploadedFiles.item(0) ?? undefined
        : Array.isArray(uploadedFiles)
          ? uploadedFiles.find((file): file is File => file instanceof File)
          : undefined
      if (journalId == null || currencyId == null) throw new Error("Choose the statement journal and currency")
      if (csvFile == null) throw new Error("Choose a CSV file to import")
      const csvData = await csvFile.text()
      const rows = statementImportRows(csvData)
      await stageStatementImport.mutateAsync({
        companyId,
        journalId,
        currencyId,
        params: {
          fileName: stringValue(data.fileName) || csvFile.name,
          idempotencyKey: importIdempotencyKey(companyId, journalId, currencyId, csvData),
          openingBalance: numberValue(data.openingBalance),
          rows,
        },
      })
      setStatementImportDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to stage the statement import"
      setFormError(message)
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
          <CardAction><Button size="sm" onClick={() => { setFormError(null); setStatementImportDialogOpen(true) }}><FileUpIcon data-icon="inline-start" />Stage CSV</Button></CardAction>
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
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileUpIcon /></EmptyMedia><EmptyTitle>{statementImportsLoading ? "Loading statement imports" : "No statement imports"}</EmptyTitle><EmptyDescription>Paste a bank CSV to validate every row before it enters reconciliation.</EmptyDescription></EmptyHeader><EmptyContent><Button size="sm" onClick={() => setStatementImportDialogOpen(true)}><FileUpIcon data-icon="inline-start" />Stage CSV</Button></EmptyContent></Empty>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div><CardTitle>Transactions & reconciliation</CardTitle><CardDescription>Record provider events, post them to the ledger, then match them to invoice or bill lines.</CardDescription></div>
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
            return <div key={String(transaction.id)} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="font-medium">{String(optionValue(transaction.externalReference) ?? `Payment ${transaction.id}`)}</p><Badge variant={statusVariant(status)}>{status || "Draft"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{String(account?.name ?? "Payment account")} · {enumName(transaction.direction)} · {numberValue(transaction.settlementAmount).toLocaleString()}</p>{allocations.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{allocations.length} allocation{allocations.length === 1 ? "" : "s"} · {allocations.reduce((sum, allocation) => sum + numberValue(allocation.allocatedAmount), 0).toLocaleString()} matched</p> : null}{transactionFees.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{transactionFees.length} fee{transactionFees.length === 1 ? "" : "s"} · {transactionFees.reduce((sum, fee) => sum + numberValue(fee.amount) + numberValue(fee.taxAmount), 0).toLocaleString()}</p> : null}</div><div className="flex flex-wrap gap-2">{status === "Draft" ? <><Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setFormError(null); setFeeTransaction(transaction) }}><ReceiptTextIcon data-icon="inline-start" />Add fee</Button><Button size="sm" variant="outline" disabled={mutationBusy || id == null} onClick={() => void post(transaction)}><SendIcon data-icon="inline-start" />Post</Button><Button size="sm" variant="outline" disabled={mutationBusy || id == null} onClick={() => setVoidingTransaction(transaction)}><Trash2Icon data-icon="inline-start" />Void</Button></> : null}{status === "Posted" ? <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setFormError(null); setAllocatingTransaction(transaction) }}><ArrowLeftRightIcon data-icon="inline-start" />Allocate</Button> : null}{canReverse ? <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => { setFormError(null); setReversingTransaction(transaction) }}><RotateCcwIcon data-icon="inline-start" />Reverse</Button> : null}</div></div>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSignIcon /></EmptyMedia><EmptyTitle>{transactionsLoading ? "Loading transactions" : "No payment transactions"}</EmptyTitle><EmptyDescription>Record a provider event, post it, and allocate it to an open invoice or bill.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>

      <RuntimeFormModal open={accountDialogOpen} onOpenChange={(open) => !open && setAccountDialogOpen(false)} staticConfig={paymentAccountForm} moduleId="accounting" organizationId={organizationId} isPending={createAccount.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveAccount} />
      <RuntimeFormModal open={transactionDialogOpen} onOpenChange={(open) => !open && setTransactionDialogOpen(false)} staticConfig={paymentTransactionForm} moduleId="accounting" organizationId={organizationId} isPending={createTransaction.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveTransaction} />
      <RuntimeFormModal open={statementImportDialogOpen} onOpenChange={(open) => !open && setStatementImportDialogOpen(false)} staticConfig={statementImportForm} moduleId="accounting" organizationId={organizationId} isPending={stageStatementImport.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveStatementImport} />
      <RuntimeFormModal key={allocatingTransaction ? `allocate-${String(allocatingTransaction.id)}` : "allocate-none"} open={allocatingTransaction != null} onOpenChange={(open) => !open && setAllocatingTransaction(null)} staticConfig={allocationForm} moduleId="accounting" organizationId={organizationId} isPending={allocateTransaction.isPending} closeOnSubmit={false} showSubmitSuccessToast submitError={formError} onSubmit={saveAllocation} />
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
