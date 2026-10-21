"use client"

import { useRef, useState } from "react"
import { Button } from "../../../../../packages/ui/src/components/button"
import { ReconciliationWorkbench, type ReconciliationOutcome, type ReconciliationStatusResult } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench"
import type { ReconciliationSource } from "../../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"
import { resolveBankSettlementLifecycleEffect, type BankSettlementCanonicalRows } from "@lumiere/query-hooks/hooks/accounting/bank-settlement-effect"
import type { BankSettlementAttempt, BankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"

type Row = Record<string, unknown>
const common = { organizationId: "7", companyId: "11", currencyId: "1", partnerId: "601" }
function canonicalRows(scenario: "closed" | "posted"): BankSettlementCanonicalRows {
  const posted = scenario === "posted"
  const attempt: BankSettlementAttempt = { attemptId: "synthetic-bank-301-1", generation: "1", paymentId: "150", selectedMoveLineIds: ["501"],
    selectedResiduals: [{ lineId: "501", moveId: "91", residual: 100, residualCurrency: 100 }],
    status: posted ? "settled" : "approval_rejected", allocationApplied: posted, ...(posted ? { paymentMoveId: "160" } : {}) }
  const line = { id: "301", organizationId: "7", statementId: "201", journalId: "5", journalCurrencyId: "1", foreignCurrencyId: null, currencyId: null,
    amount: 100, amountResidual: posted ? 0 : 100, isReconciled: posted, paymentIds: ["150"], moveIds: posted ? ["501"] : [], metadata: { bankSettlement: attempt } }
  return {
    lines: [line], statements: [{ id: "201", ...common, journalId: "5", state: posted ? "Posted" : "Open", name: "Synthetic lifecycle statement" }],
    payments: [{ id: "150", ...common, journalId: "5", amount: 100, paymentType: "Inbound", partnerType: "Customer", state: posted ? "Paid" : "NotPaid", ...(posted ? { moveId: "160" } : {}) }],
    moves: [{ id: "91", ...common, journalId: "6", state: "Posted", moveType: "OutInvoice", amountTotal: 100, amountResidual: posted ? 0 : 100, paymentState: posted ? "Paid" : "NotPaid" },
      ...(posted ? [{ id: "160", ...common, journalId: "5", state: "Posted", moveType: "Entry" }] : [])],
    moveLines: [{ id: "501", ...common, moveId: "91", accountId: "401", parentState: "Posted", accountInternalType: "receivable", balance: 100, debit: 100, credit: 0,
      amountResidual: posted ? 0 : 100, amountResidualCurrency: posted ? 0 : 100, ...(posted ? { matchingNumber: "MATCH-160-91" } : {}) },
      ...(posted ? [
        { id: "601", ...common, moveId: "160", accountId: "401", parentState: "Posted", accountInternalType: "receivable", debit: 0, credit: 100, amountResidual: 0 },
        { id: "602", ...common, moveId: "160", accountId: "402", parentState: "Posted", accountInternalType: "liquidity", debit: 100, credit: 0, amountResidual: 0 },
      ] : [])],
  }
}

/** Controlled canonical rows exercise the same financial proof helper used by the real hook. */
export function BankLifecycleFixture({ source, actorKey, scenario, onLockChange }: { source: ReconciliationSource; actorKey: string; scenario: "closed" | "posted"; onLockChange: (locked: boolean) => void }) {
  const [rows, setRows] = useState(() => canonicalRows(scenario))
  const currentRows = useRef(rows)
  const [dispatches, setDispatches] = useState(0), [checks, setChecks] = useState(0), [mount, setMount] = useState(0)
  const [hideReversal, setHideReversal] = useState(false)
  const original = useRef<BankSettlementRecoveryRequest | null>(null)
  const settleLost = useRef<((result: ReconciliationOutcome) => void) | null>(null)
  const update = (next: BankSettlementCanonicalRows) => { currentRows.current = next; setRows(next) }
  const canonical = (request?: BankSettlementRecoveryRequest): ReconciliationOutcome => {
    const evidence = currentRows.current
    const proof = resolveBankSettlementLifecycleEffect(hideReversal ? { ...evidence, moves: evidence.moves.filter((row) => String(row.id) !== "170") } : evidence,
      { organizationId: "7", companyId: "11", lineId: "301", request })
    return proof ? { status: "lifecycle", attempt: proof.attempt } : { status: "unknown", message: "Synthetic canonical reversal journal proof is unavailable" }
  }
  const approveReversal = () => {
    const request = original.current
    if (!request || request.action !== "reverse") return
    const previous = currentRows.current, saved = (previous.lines[0]!.metadata as { bankSettlement: BankSettlementAttempt }).bankSettlement
    update({ ...previous,
      lines: [{ ...previous.lines[0], isReconciled: false, amountResidual: 100, paymentIds: [], moveIds: [], metadata: { bankSettlement: { ...saved, status: "reversed", reversalMoveId: "170" } } }],
      statements: previous.statements.map((row) => ({ ...row, state: "Open" })),
      payments: previous.payments.map((row) => ({ ...row, state: "Reversed", reversalMoveId: "170" })),
      moves: [...previous.moves.map((row) => row.id === "91" ? { ...row, amountResidual: 100, paymentState: "NotPaid" } : row),
        { id: "170", ...common, journalId: "5", state: "Posted", date: { microsSinceUnixEpoch: request.dateMicros }, metadata: { reverses_payment_move_id: "160", account_payment_id: "150" } }],
      moveLines: [...previous.moveLines.map((row) => row.id === "501" ? { ...row, amountResidual: 100, amountResidualCurrency: 100, matchingNumber: undefined } : row),
        ...previous.moveLines.filter((row) => row.moveId === "160").map((row, index) => ({ ...row, id: String(701 + index), moveId: "170", debit: row.credit, credit: row.debit }))],
    })
  }
  const onRecover = async (request: BankSettlementRecoveryRequest): Promise<ReconciliationOutcome> => {
    if (source.companyId !== "11" || actorKey !== "synthetic-accountant" || source.state.status !== "ready") return { status: "rejected", message: "Original synthetic scope unavailable" }
    setDispatches((count) => count + 1)
    if (original.current && JSON.stringify(original.current) !== JSON.stringify(request)) throw new Error("The original recovery payload changed")
    if (original.current) return canonical(request)
    original.current = request
    const previous = currentRows.current, saved = (previous.lines[0]!.metadata as { bankSettlement: BankSettlementAttempt }).bankSettlement
    const recovery = { recoveryAction: request.action, recoveryKey: request.idempotencyKey, recoveryReason: request.reason }
    if (request.action === "resubmit") {
      const successor: BankSettlementAttempt = { ...saved, ...recovery, attemptId: "synthetic-bank-301-2", generation: "2", paymentId: "151", previousPaymentId: "150", status: "awaiting_approval" }
      update({ ...previous, lines: [{ ...previous.lines[0], paymentIds: ["151"], metadata: { bankSettlement: successor } }],
        payments: [{ ...previous.payments[0], state: "Reversed" }, { ...previous.payments[0], id: "151" }],
      })
      return new Promise((resolve) => { settleLost.current = resolve })
    }
    if (request.action === "reverse") {
      update({ ...previous, lines: [{ ...previous.lines[0], metadata: { bankSettlement: { ...saved, ...recovery, status: "reversal_awaiting_approval", reversalRequestId: "190", reversalDateMicros: request.dateMicros, reversalReason: request.reason } } }] })
      return canonical(request)
    }
    update({ ...previous, lines: [{ ...previous.lines[0], paymentIds: [], metadata: { bankSettlement: { ...saved, ...recovery, status: "abandoned" } } }], payments: [{ ...previous.payments[0], state: "Reversed" }] })
    return canonical(request)
  }
  const onCheck = async (_request: unknown, recovery?: BankSettlementRecoveryRequest): Promise<ReconciliationStatusResult> => {
    if (source.companyId !== "11" || actorKey !== "synthetic-accountant") return "unconfirmed"
    setChecks((count) => count + 1)
    const result = canonical(recovery)
    return result.status === "lifecycle" ? result : "unconfirmed"
  }
  const currentLine = rows.lines[0] as Row
  const currentSource: ReconciliationSource = { ...source, statement: rows.statements[0]!, line: currentLine, bankLines: [currentLine],
    moveLines: source.moveLines, moves: source.moves }
  return <section className="min-w-0 space-y-4" aria-label="Saved bank lifecycle fixture">
    <p className="text-xs text-muted-foreground">Saved synthetic lifecycle rows use the production financial proof helper. No bank reducer is called.</p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => settleLost.current?.({ status: "unknown", message: "Synthetic recovery response lost" })}>Resolve recovery as unknown</Button>
      <Button onClick={() => setMount((value) => value + 1)}>Reload saved bank review</Button>
      <Button disabled={original.current?.action !== "reverse"} onClick={approveReversal}>Approve synthetic reversal</Button>
      <Button onClick={() => setHideReversal((value) => !value)}>{hideReversal ? "Restore reversal journal proof" : "Hide reversal journal proof"}</Button>
    </div>
    <output data-testid="bank-lifecycle-state" className="block break-words text-sm">Recovery dispatches {dispatches}; canonical checks {checks}; reversal proof {hideReversal ? "hidden" : "available"}; bank matched {String(currentLine.isReconciled)}</output>
    <ReconciliationWorkbench key={mount} source={currentSource} actorKey={actorKey} canReconcile={source.companyId === "11" && actorKey === "synthetic-accountant"}
      canRecover={() => source.companyId === "11" && actorKey === "synthetic-accountant"} onConfirm={async () => { throw new Error("This fixture only recovers existing attempts") }}
      onRecover={onRecover} onCheckStatus={onCheck} onOperationLockChange={onLockChange} />
  </section>
}
