"use client"

import { useMemo } from "react"
import { ArrowLeftRightIcon, CircleDollarSignIcon, MessageSquareMoreIcon } from "lucide-react"

import {
  usePaymentFees,
  usePaymentReconciliations,
  usePaymentTransactions,
} from "@lumiere/query-hooks/hooks/accounting"
import { useMessageBatches, useOperationalMessages } from "@lumiere/query-hooks/hooks/messages"
import { useTranslation } from "@lumiere/i18n"
import { useCurrencyFormat, type CurrencyFormat } from "@lumiere/ui/lib/currency-context"
import { mergeModuleStates, moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

type Row = Record<string, unknown>

function scalar(value: unknown): unknown {
  if (value != null && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  return value
}

function numeric(value: unknown): number | null {
  const raw = scalar(value)
  if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && raw.trim() === "")) return null
  const result = Number(raw)
  return Number.isFinite(result) ? result : null
}

function moneyLabel(value: number | null, code: string | undefined, format: CurrencyFormat, unavailable: string): string {
  return value != null && Number.isFinite(value) && code ? `${format.money(value, code)} (${code})` : unavailable
}

/** Each allocation and fee names its own currency; never add different currencies together. */
function totalsLabel(rows: readonly Row[], keys: readonly string[], format: CurrencyFormat, unavailable: string): string {
  const totals = new Map<string, number>()
  let incomplete = false
  for (const row of rows) {
    const code = format.codeFor(row.currencyId)
    const values = keys.map((key) => numeric(row[key]))
    if (!code || values.some((value) => value == null)) {
      incomplete = true
      continue
    }
    const amount = values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    totals.set(code, (totals.get(code) ?? 0) + amount)
  }
  const labels = [...totals].map(([code, amount]) => moneyLabel(amount, code, format, unavailable))
  if (incomplete) labels.push(unavailable)
  return labels.join(" · ")
}

function enumName(value: unknown): string {
  return value != null && typeof value === "object" && "tag" in value
    ? String((value as { tag: unknown }).tag)
    : String(value ?? "")
}

function timestamp(value: unknown): number {
  const raw = scalar(value)
  if (raw != null && typeof raw === "object" && "microsSinceUnixEpoch" in raw) {
    return Number((raw as { microsSinceUnixEpoch: bigint | number }).microsSinceUnixEpoch) / 1_000
  }
  const number = Number(raw)
  return Number.isFinite(number) ? (number > 1e15 ? number / 1_000 : number) : 0
}

function formatTimestamp(value: unknown, locale: string): string {
  const milliseconds = timestamp(value)
  const date = new Date(milliseconds)
  return milliseconds > 0 && Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : "—"
}

function statusVariant(status: string) {
  if (["Posted", "Approved", "Sent"].includes(status)) return "default" as const
  if (["Voided", "Reversed", "Rejected", "Failed"].includes(status)) return "destructive" as const
  return "secondary" as const
}

/** Contact-scoped operational records kept separate from the general CRM chatter. */
export function ContactPaymentsAndMessagesPanel({ organizationId, contactId }: { organizationId: number; contactId: bigint }) {
  const { t, i18n } = useTranslation()
  const format = useCurrencyFormat()
  const unavailable = t("crm.paymentHistory.amountUnavailable")
  const organization = BigInt(organizationId)
  const transactionRead = moduleCollection(usePaymentTransactions(organization))
  const reconciliationRead = moduleCollection(usePaymentReconciliations(organization))
  const feeRead = moduleCollection(usePaymentFees(organization))
  const messageRead = moduleCollection(useOperationalMessages(organization))
  const batchRead = moduleCollection(useMessageBatches(organization))
  const paymentState = mergeModuleStates([transactionRead.state, reconciliationRead.state, feeRead.state])
  const messageState = mergeModuleStates([messageRead.state, batchRead.state])
  const transactions = transactionRead.rows
  const reconciliations = reconciliationRead.rows
  const fees = feeRead.rows
  const messages = messageRead.rows
  const batches = batchRead.rows

  const transactionRows = useMemo(
    () => (transactions as Row[])
      .filter((transaction) => String(scalar(transaction.partnerId)) === contactId.toString())
      .toSorted((a, b) => timestamp(b.updatedAt ?? b.createdAt) - timestamp(a.updatedAt ?? a.createdAt)),
    [contactId, transactions],
  )
  const reconciliationsByTransaction = useMemo(() => {
    const grouped = new Map<string, Row[]>()
    for (const reconciliation of reconciliations as Row[]) {
      const key = String(scalar(reconciliation.paymentTransactionId))
      grouped.set(key, [...(grouped.get(key) ?? []), reconciliation])
    }
    return grouped
  }, [reconciliations])
  const feesByTransaction = useMemo(() => {
    const grouped = new Map<string, Row[]>()
    for (const fee of fees as Row[]) {
      const key = String(scalar(fee.paymentTransactionId))
      grouped.set(key, [...(grouped.get(key) ?? []), fee])
    }
    return grouped
  }, [fees])
  const batchById = useMemo(
    () => new Map((batches as Row[]).map((batch) => [String(batch.id), batch])),
    [batches],
  )
  const messageRows = useMemo(
    () => (messages as Row[])
      .filter((message) => String(scalar(message.contactId)) === contactId.toString())
      .toSorted((a, b) => timestamp(b.sentAt ?? b.createdAt) - timestamp(a.sentAt ?? a.createdAt)),
    [contactId, messages],
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card data-testid="contact-payment-history">
        <CardHeader>
          <div>
            <CardTitle>{t("crm.paymentHistory.title")}</CardTitle>
            <CardDescription>{t("crm.paymentHistory.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ModuleDataNotice state={paymentState} />
          {paymentState.status === "loading" ? <p role="status">{t("common.loading")}</p> : null}
          {paymentState.status === "ready" ? transactionRows.length > 0 ? transactionRows.map((transaction) => {
            const id = String(transaction.id)
            const allocations = reconciliationsByTransaction.get(id) ?? []
            const transactionFees = feesByTransaction.get(id) ?? []
            const status = enumName(transaction.status)
            return <div key={id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 font-medium">{String(scalar(transaction.externalReference) ?? t("crm.paymentHistory.payment", { id }))}</p><Badge variant={statusVariant(status)}>{status || t("crm.paymentHistory.statusUnavailable")}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums">{enumName(transaction.direction)} · {moneyLabel(numeric(transaction.settlementAmount), format.codeFor(transaction.currencyId), format, unavailable)} · {formatTimestamp(transaction.occurredAt, i18n.language)}</p>
                {allocations.length > 0 ? <p className="mt-1 text-xs text-muted-foreground tabular-nums">{t("crm.paymentHistory.allocated", { count: allocations.length, amount: totalsLabel(allocations, ["allocatedAmount"], format, unavailable) })}</p> : <p className="mt-1 text-xs text-muted-foreground">{t("crm.paymentHistory.unmatched")}</p>}
                {transactionFees.length > 0 ? <p className="mt-1 text-xs text-muted-foreground tabular-nums">{t("crm.paymentHistory.fees", { count: transactionFees.length, amount: totalsLabel(transactionFees, ["amount", "taxAmount"], format, unavailable) })}</p> : null}
              </div>
              <Badge variant="outline"><ArrowLeftRightIcon data-icon="inline-start" />{t("crm.paymentHistory.matched", { count: allocations.length })}</Badge>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSignIcon /></EmptyMedia><EmptyTitle>{t("crm.paymentHistory.empty")}</EmptyTitle><EmptyDescription>{t("crm.paymentHistory.emptyHint")}</EmptyDescription></EmptyHeader></Empty> : null}
        </CardContent>
      </Card>

      <Card data-testid="contact-message-history">
        <CardHeader>
          <div>
            <CardTitle>{t("crm.paymentHistory.messagesTitle")}</CardTitle>
            <CardDescription>{t("crm.paymentHistory.messagesDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ModuleDataNotice state={messageState} />
          {messageState.status === "loading" ? <p role="status">{t("common.loading")}</p> : null}
          {messageState.status === "ready" ? messageRows.length > 0 ? messageRows.map((message) => {
            const batch = batchById.get(String(message.messageBatchId))
            const status = enumName(message.status)
            const batchStatus = enumName(batch?.status) || t("crm.paymentHistory.approvalUnavailable")
            return <div key={String(message.id)} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 font-medium">{String(scalar(message.renderedSubject) ?? message.subjectModel ?? t("crm.paymentHistory.message"))}</p><Badge variant={statusVariant(status)}>{status || t("crm.paymentHistory.statusUnavailable")}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">{enumName(message.channel)} · {t("crm.paymentHistory.batch", { id: String(message.messageBatchId), status: batchStatus })}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{String(message.renderedBody ?? "")}</p>
              </div>
              <p className="text-xs text-muted-foreground">{formatTimestamp(message.sentAt ?? message.createdAt, i18n.language)}</p>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareMoreIcon /></EmptyMedia><EmptyTitle>{t("crm.paymentHistory.messagesEmpty")}</EmptyTitle><EmptyDescription>{t("crm.paymentHistory.messagesEmptyHint")}</EmptyDescription></EmptyHeader></Empty> : null}
        </CardContent>
      </Card>
    </div>
  )
}
