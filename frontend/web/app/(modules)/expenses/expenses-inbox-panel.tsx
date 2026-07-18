"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useApproveExpenseSheet,
  useExpenseCardStatementUnmatched,
  useExpenseSheetsToApprove,
  useExpensesMissingReceipt,
  useMatchExpenseCardStatementLine,
  useRefuseExpenseSheet,
} from "@lumiere/query-hooks/hooks/expenses"
import { Button } from "@lumiere/ui"
import { orgBigInts } from "@/lib/org-scoped"

type InboxQueue = "to-approve" | "missing-receipt" | "unmatched-card"

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? "")
}

function field(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v != null && v !== "") return String(v)
  }
  return "—"
}

/**
 * Bounded-SQL inbox queues: sheets to approve, missing receipts, unmatched cards.
 * Row actions reuse existing approve/refuse/match mutations.
 */
export function ExpensesInboxPanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const [queue, setQueue] = useState<InboxQueue>("to-approve")
  const [status, setStatus] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [matchExpenseId, setMatchExpenseId] = useState<Record<string, string>>({})

  const { data: toApprove = [] } = useExpenseSheetsToApprove(orgId)
  const { data: missingReceipt = [] } = useExpensesMissingReceipt(orgId)
  const { data: unmatchedCards = [] } = useExpenseCardStatementUnmatched(orgId)

  const approveSheet = useApproveExpenseSheet(orgId)
  const refuseSheet = useRefuseExpenseSheet(orgId)
  const matchCard = useMatchExpenseCardStatementLine(orgId)

  const rows = useMemo(() => {
    if (queue === "to-approve") return toApprove as Record<string, unknown>[]
    if (queue === "missing-receipt") return missingReceipt as Record<string, unknown>[]
    return unmatchedCards as Record<string, unknown>[]
  }, [queue, toApprove, missingReceipt, unmatchedCards])

  const run = async (id: string, fn: () => Promise<void>, okMsg: string) => {
    setBusyId(id)
    setStatus(null)
    try {
      await fn()
      setStatus(okMsg)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const queues: { id: InboxQueue; label: string; count: number; testId: string }[] = [
    {
      id: "to-approve",
      label: t("expenses.inbox.toApprove", { defaultValue: "To approve" }),
      count: toApprove.length,
      testId: "expenses-inbox-to-approve",
    },
    {
      id: "missing-receipt",
      label: t("expenses.inbox.missingReceipt", { defaultValue: "Missing receipt" }),
      count: missingReceipt.length,
      testId: "expenses-inbox-missing-receipt",
    },
    {
      id: "unmatched-card",
      label: t("expenses.inbox.unmatchedCard", { defaultValue: "Unmatched cards" }),
      count: unmatchedCards.length,
      testId: "expenses-inbox-unmatched-card",
    },
  ]

  return (
    <div className="space-y-4" data-testid="expenses-inbox-panel">
      <div>
        <h2 className="text-sm font-medium">
          {t("expenses.inbox.title", { defaultValue: "Exception inbox" })}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("expenses.inbox.description", {
            defaultValue: "Server-bounded queues for approval, receipt evidence, and card match.",
          })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {queues.map((q) => (
          <Button
            key={q.id}
            type="button"
            size="sm"
            variant={queue === q.id ? "default" : "outline"}
            data-testid={q.testId}
            onClick={() => setQueue(q.id)}
          >
            {q.label} ({q.count})
          </Button>
        ))}
      </div>

      {status ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-inbox-status">
          {status}
        </p>
      ) : null}

      <div className="space-y-2" data-testid={`expenses-inbox-list-${queue}`}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("expenses.inbox.empty", { defaultValue: "No items in this queue." })}
          </p>
        ) : null}
        {rows.map((row) => {
          const id = rowId(row)
          const busy = busyId === id
          if (queue === "to-approve") {
            return (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                data-testid={`expenses-inbox-row-${id}`}
              >
                <div>
                  <div className="font-medium">{field(row, "name")}</div>
                  <div className="text-muted-foreground">
                    #{id} · {field(row, "totalAmount", "total_amount")} · {field(row, "state")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    data-testid={`expenses-inbox-approve-${id}`}
                    onClick={() =>
                      void run(
                        id,
                        () => approveSheet.mutateAsync(id),
                        t("expenses.inbox.approved", { defaultValue: "Report approved." }),
                      )
                    }
                  >
                    {t("expenses.workflow.approveReport")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    data-testid={`expenses-inbox-refuse-${id}`}
                    onClick={() =>
                      void run(
                        id,
                        () =>
                          refuseSheet.mutateAsync({
                            sheetId: id,
                            params: { reason: "Refused from inbox" },
                          }),
                        t("expenses.inbox.refused", { defaultValue: "Report refused." }),
                      )
                    }
                  >
                    {t("expenses.workflow.refuseReport")}
                  </Button>
                </div>
              </div>
            )
          }
          if (queue === "missing-receipt") {
            return (
              <div
                key={id}
                className="rounded-md border p-3 text-sm"
                data-testid={`expenses-inbox-row-${id}`}
              >
                <div className="font-medium">{field(row, "name")}</div>
                <div className="text-muted-foreground">
                  #{id} · {field(row, "totalAmount", "total_amount")} ·{" "}
                  {t("expenses.inbox.openInExpenses", {
                    defaultValue: "Attach a receipt from the Expenses tab, then re-submit.",
                  })}
                </div>
              </div>
            )
          }
          return (
            <div
              key={id}
              className="flex flex-wrap items-end justify-between gap-2 rounded-md border p-3 text-sm"
              data-testid={`expenses-inbox-row-${id}`}
            >
              <div>
                <div className="font-medium">
                  {field(row, "externalRef", "external_ref")} · {field(row, "amount")}
                </div>
                <div className="text-muted-foreground">
                  #{id} · {field(row, "merchantKey", "merchant_key")} · {field(row, "status")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="rounded-md border bg-background px-2 py-1.5 text-sm w-36"
                  placeholder={t("expenses.ops.expenseId")}
                  value={matchExpenseId[id] ?? ""}
                  onChange={(e) =>
                    setMatchExpenseId((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                  data-testid={`expenses-inbox-match-expense-${id}`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !(matchExpenseId[id] ?? "").trim()}
                  data-testid={`expenses-inbox-match-${id}`}
                  onClick={() =>
                    void run(
                      id,
                      () =>
                        matchCard.mutateAsync({
                          statementLineId: id,
                          expenseId: (matchExpenseId[id] ?? "").trim(),
                        }),
                      t("expenses.ops.matched"),
                    )
                  }
                >
                  {t("expenses.ops.match")}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
