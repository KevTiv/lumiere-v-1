"use client"

import { useMemo } from "react"
import { ArrowLeftRightIcon, CircleDollarSignIcon, MessageSquareMoreIcon } from "lucide-react"

import {
  usePaymentFees,
  usePaymentReconciliations,
  usePaymentTransactions,
} from "@lumiere/query-hooks/hooks/accounting"
import { useMessageBatches, useOperationalMessages } from "@lumiere/query-hooks/hooks/messages"
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

function numeric(value: unknown): number {
  const result = Number(scalar(value))
  return Number.isFinite(result) ? result : 0
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

function formatTimestamp(value: unknown): string {
  const milliseconds = timestamp(value)
  return milliseconds > 0 ? new Date(milliseconds).toLocaleString() : "—"
}

function statusVariant(status: string) {
  if (["Posted", "Approved", "Sent"].includes(status)) return "default" as const
  if (["Voided", "Reversed", "Rejected", "Failed"].includes(status)) return "destructive" as const
  return "secondary" as const
}

/** Contact-scoped operational records kept separate from the general CRM chatter. */
export function ContactPaymentsAndMessagesPanel({ organizationId, contactId }: { organizationId: number; contactId: bigint }) {
  const organization = BigInt(organizationId)
  const { data: transactions = [] } = usePaymentTransactions(organization)
  const { data: reconciliations = [] } = usePaymentReconciliations(organization)
  const { data: fees = [] } = usePaymentFees(organization)
  const { data: messages = [] } = useOperationalMessages(organization)
  const { data: batches = [] } = useMessageBatches(organization)

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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payments & reconciliation</CardTitle>
            <CardDescription>Provider transactions for this contact, including linked allocations and provider fees.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {transactionRows.length > 0 ? transactionRows.map((transaction) => {
            const id = String(transaction.id)
            const allocations = reconciliationsByTransaction.get(id) ?? []
            const transactionFees = feesByTransaction.get(id) ?? []
            const status = enumName(transaction.status)
            return <div key={id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="flex items-center gap-2"><p className="font-medium">{String(scalar(transaction.externalReference) ?? `Payment ${id}`)}</p><Badge variant={statusVariant(status)}>{status || "Draft"}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">{enumName(transaction.direction)} · {numeric(transaction.settlementAmount).toLocaleString()} · {formatTimestamp(transaction.occurredAt)}</p>
                {allocations.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{allocations.length} reconciliation{allocations.length === 1 ? "" : "s"} · {allocations.reduce((sum, allocation) => sum + numeric(allocation.allocatedAmount), 0).toLocaleString()} allocated</p> : <p className="mt-1 text-xs text-muted-foreground">Not yet reconciled to an invoice or bill line.</p>}
                {transactionFees.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">{transactionFees.length} fee{transactionFees.length === 1 ? "" : "s"} · {transactionFees.reduce((sum, fee) => sum + numeric(fee.amount) + numeric(fee.taxAmount), 0).toLocaleString()}</p> : null}
              </div>
              <Badge variant="outline"><ArrowLeftRightIcon data-icon="inline-start" />{allocations.length} matched</Badge>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSignIcon /></EmptyMedia><EmptyTitle>No payment activity</EmptyTitle><EmptyDescription>Payments recorded for this contact will appear here with their reconciliation status.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Invoice reminders & messages</CardTitle>
            <CardDescription>Operational messages for this contact, with the parent batch’s review status.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {messageRows.length > 0 ? messageRows.map((message) => {
            const batch = batchById.get(String(message.messageBatchId))
            const status = enumName(message.status)
            const batchStatus = batch == null ? "Unknown batch" : enumName(batch.status)
            return <div key={String(message.id)} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><p className="font-medium">{String(scalar(message.renderedSubject) ?? message.subjectModel ?? "Operational message")}</p><Badge variant={statusVariant(status)}>{status || "Queued"}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">{enumName(message.channel)} · batch #{String(message.messageBatchId)} · {batchStatus}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{String(message.renderedBody ?? "")}</p>
              </div>
              <p className="text-xs text-muted-foreground">{formatTimestamp(message.sentAt ?? message.createdAt)}</p>
            </div>
          }) : <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareMoreIcon /></EmptyMedia><EmptyTitle>No operational messages</EmptyTitle><EmptyDescription>Invoice reminders and contact-message batches addressed to this contact will appear here.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>
    </div>
  )
}
