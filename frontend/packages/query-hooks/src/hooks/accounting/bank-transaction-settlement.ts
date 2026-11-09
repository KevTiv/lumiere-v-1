"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { unwrapSome } from "@lumiere/erp-shared/form-coercion"
import { paymentMoneyMinor } from "@lumiere/erp-shared/payment-allocation-projection"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { fetchQueryList } from "../../http"
import { dispatchNamedOperation } from "../../operation-dispatch"
import { invalidateStdbQueryResources } from "../stdb"

export interface BankTransactionSettlementRequest {
  organizationId: string
  companyId: string
  statementId: string
  lineId: string
  transactionId: string
  moveLineId: string
  currencyId: string
  decimalPlaces: number
  bankAmount: number
  openAmount: number
  allocatedAmount: number
}

export interface BankTransactionSettlementResult {
  transactionId: string
  paymentId: string
  moveLineId: string
  allocationId: string
  allocatedMinor: bigint
  documentRemainingMinor: bigint
  unappliedCreditMinor: bigint
}

const resources = [
  "bank-statements",
  "bank-statement-lines",
  "payment-transactions",
  "payment-reconciliations",
  "account-payments",
  "account-moves",
  "account-move-lines",
  "sale-orders",
] as const

export function bankTransactionSettlementKey(
  request: BankTransactionSettlementRequest,
) {
  return `bank-transaction:${request.statementId}:${request.lineId}:${request.transactionId}:${request.moveLineId}`
}

const id = (value: unknown) => parseStrictU64(unwrapSome(value))?.toString()
const tag = (value: unknown) =>
  typeof value === "object" && value !== null && "tag" in value
    ? value.tag
    : value
const only = <Row>(rows: readonly Row[], predicate: (row: Row) => boolean) => {
  const found = rows.filter(predicate)
  return found.length === 1 ? found[0] : undefined
}

/** Read the financial effects independently of the command's transport response. */
export async function readBankTransactionSettlement(
  request: Pick<
    BankTransactionSettlementRequest,
    | "organizationId"
    | "companyId"
    | "statementId"
    | "lineId"
    | "transactionId"
    | "currencyId"
    | "decimalPlaces"
    | "bankAmount"
  >,
  expected?: BankTransactionSettlementRequest,
): Promise<BankTransactionSettlementResult | null> {
  const scope = `companyId=${encodeURIComponent(request.companyId)}`
  const [
    statements,
    lines,
    transactions,
    allocations,
    payments,
    moves,
    moveLines,
  ] = await Promise.all([
    fetchQueryList(
      `/api/query/bank-statements?${scope}`,
      "Could not read the original bank statement",
    ),
    fetchQueryList(
      `/api/query/bank-statement-lines?${scope}`,
      "Could not read the original bank line",
    ),
    fetchQueryList(
      `/api/query/payment-transactions?${scope}`,
      "Could not read the original posted transaction",
    ),
    fetchQueryList(
      `/api/query/payment-reconciliations?${scope}`,
      "Could not read the original allocation",
    ),
    fetchQueryList(
      `/api/query/account-payments?${scope}`,
      "Could not read the linked payment",
    ),
    fetchQueryList(
      `/api/query/account-moves?${scope}`,
      "Could not read the linked ledger entry",
    ),
    fetchQueryList(
      `/api/query/account-move-lines?${scope}`,
      "Could not read the document and payment balances",
    ),
  ])
  const inScope = (row: { organizationId?: unknown; companyId?: unknown }) =>
    id(row.organizationId) === request.organizationId &&
    id(row.companyId) === request.companyId
  const minor = (value: unknown) =>
    paymentMoneyMinor(value, request.decimalPlaces)
  const bank = minor(request.bankAmount)
  if (bank == null || bank === 0n) return null
  const cash = bank < 0n ? -bank : bank
  const statement = only(
    statements,
    (row) => id(row.id) === request.statementId,
  )
  const line = only(lines, (row) => id(row.id) === request.lineId)
  const transaction = only(
    transactions,
    (row) => id(row.id) === request.transactionId,
  )
  if (
    !statement ||
    !inScope(statement) ||
    id(statement.currencyId) !== request.currencyId ||
    !line ||
    id(line.organizationId) !== request.organizationId ||
    id(line.statementId) !== request.statementId ||
    id(line.journalId) !== id(statement.journalId) ||
    line.isReconciled !== true ||
    minor(line.amount) !== bank ||
    minor(line.amountResidual) !== 0n ||
    !Array.isArray(line.moveIds) ||
    line.moveIds.length !== 1 ||
    !Array.isArray(line.paymentIds) ||
    line.paymentIds.length !== 1 ||
    !transaction ||
    !inScope(transaction) ||
    tag(transaction.status) !== "Posted" ||
    unwrapSome(transaction.sourceEntity) !== "account_bank_statement_line" ||
    id(transaction.sourceEntityId) !== request.lineId ||
    id(transaction.currencyId) !== request.currencyId ||
    minor(transaction.settlementAmount) !== cash ||
    minor(transaction.netAccountAmount) !== cash ||
    tag(transaction.direction) !== (bank > 0n ? "Inbound" : "Outbound")
  )
    return null

  const paymentId = id(line.paymentIds[0])
  const moveLineId = id(line.moveIds[0])
  const ledgerMoveId = id(line.moveId)
  if (
    !paymentId ||
    !moveLineId ||
    !ledgerMoveId ||
    id(transaction.accountPaymentId) !== paymentId
  )
    return null
  const payment = only(payments, (row) => id(row.id) === paymentId)
  const entry = only(moves, (row) => id(row.id) === ledgerMoveId)
  const target = only(moveLines, (row) => id(row.id) === moveLineId)
  const clearing = only(
    moveLines,
    (row) =>
      id(row.moveId) === ledgerMoveId &&
      id(row.accountId) === id(target?.accountId),
  )
  const relations = allocations.filter(
    (row) =>
      inScope(row) && id(row.paymentTransactionId) === request.transactionId,
  )
  const allocation = only(
    relations,
    (row) =>
      row.isReversal === false && id(row.allocatedMoveLineId) === moveLineId,
  )
  const allocationId = id(allocation?.id)
  if (
    !payment ||
    !inScope(payment) ||
    tag(payment.state) !== "Paid" ||
    id(payment.moveId) !== ledgerMoveId ||
    id(payment.journalId) !== id(statement.journalId) ||
    id(payment.currencyId) !== request.currencyId ||
    id(payment.partnerId) !== id(transaction.partnerId) ||
    minor(payment.amount) !== cash ||
    !entry ||
    !inScope(entry) ||
    tag(entry.state) !== "Posted" ||
    id(entry.journalId) !== id(statement.journalId) ||
    !target ||
    !inScope(target) ||
    !clearing ||
    !inScope(clearing) ||
    !allocation ||
    !allocationId ||
    id(allocation.accountPaymentId) !== paymentId ||
    id(allocation.currencyId) !== request.currencyId ||
    minor(allocation.writeOffAmount) !== 0n ||
    relations.some(
      (row) =>
        row.isReversal === true &&
        id(row.reversedReconciliationId) === allocationId,
    )
  )
    return null
  const applied = minor(allocation.allocatedAmount)
  const before = minor(allocation.residualBefore)
  const atCompletion = minor(allocation.residualAfter)
  const remaining = minor(target.amountResidual)
  const credit = minor(clearing.amountResidual)
  if (
    applied == null ||
    before == null ||
    atCompletion == null ||
    remaining == null ||
    credit == null ||
    applied <= 0n ||
    applied !== (cash < before ? cash : before) ||
    before - applied !== atCompletion ||
    credit < 0n ||
    credit > cash - applied
  )
    return null
  if (
    expected &&
    (expected.moveLineId !== moveLineId ||
      minor(expected.allocatedAmount) !== applied ||
      minor(expected.openAmount) !== (bank < 0n ? -before : before))
  )
    return null
  return {
    transactionId: request.transactionId,
    paymentId,
    moveLineId,
    allocationId,
    allocatedMinor: applied,
    documentRemainingMinor: remaining < 0n ? -remaining : remaining,
    unappliedCreditMinor: credit,
  }
}

export function useSettleBankLineWithPaymentTransaction(
  organizationId: number,
) {
  const cache = useQueryClient()
  return useMutation({
    mutationFn: async (request: BankTransactionSettlementRequest) => {
      const ids = [
        request.organizationId,
        request.companyId,
        request.statementId,
        request.lineId,
        request.transactionId,
        request.moveLineId,
        request.currencyId,
      ]
      if (
        request.organizationId !== String(organizationId) ||
        ids.some((value) => {
          const parsed = parseStrictU64(value)
          return (
            parsed == null ||
            parsed <= 0n ||
            parsed > BigInt(Number.MAX_SAFE_INTEGER)
          )
        })
      )
        throw new Error(
          "The reviewed bank settlement scope is no longer available.",
        )
      const params = {
        statementId: BigInt(request.statementId),
        paymentTransactionId: BigInt(request.transactionId),
        moveLineId: BigInt(request.moveLineId),
        currencyId: BigInt(request.currencyId),
        bankAmount: request.bankAmount,
        openAmount: request.openAmount,
        allocatedAmount: request.allocatedAmount,
        idempotencyKey: bankTransactionSettlementKey(request),
      }
      await dispatchNamedOperation(
        "settle_bank_line_with_payment_transaction",
        {
          companyId: BigInt(request.companyId),
          lineId: BigInt(request.lineId),
          params: stdbParamsToJson(
            params,
            "SettleBankLineWithPaymentTransactionParams",
          ),
        },
        "The reviewed bank settlement was not confirmed",
      )
      return readBankTransactionSettlement(request, request)
    },
    onSettled: () =>
      invalidateStdbQueryResources(cache, organizationId, resources),
  })
}

/** Observe the guarded correction without replaying the reverse command. */
export async function readBankTransactionReversal(request: {
  organizationId: string
  companyId: string
  statementId: string
  lineId: string
  transactionId: string
}): Promise<{ reversalId: string; correctingMoveId: string } | null> {
  const scope = `companyId=${encodeURIComponent(request.companyId)}`
  const [lines, statements, transactions, reversals, payments, moves] =
    await Promise.all([
      fetchQueryList(
        `/api/query/bank-statement-lines?${scope}`,
        "Could not read the original bank line",
      ),
      fetchQueryList(
        `/api/query/bank-statements?${scope}`,
        "Could not read the original statement",
      ),
      fetchQueryList(
        `/api/query/payment-transactions?${scope}`,
        "Could not read the original payment transaction",
      ),
      fetchQueryList(
        `/api/query/payment-reversals?${scope}`,
        "Could not read the reversal record",
      ),
      fetchQueryList(
        `/api/query/account-payments?${scope}`,
        "Could not read the reversed and correcting payments",
      ),
      fetchQueryList(
        `/api/query/account-moves?${scope}`,
        "Could not read the compensating journal entry",
      ),
    ])
  const inScope = (row: { organizationId?: unknown; companyId?: unknown }) =>
    id(row.organizationId) === request.organizationId &&
    id(row.companyId) === request.companyId
  const line = only(lines, (row) => id(row.id) === request.lineId)
  const statement = only(
    statements,
    (row) => id(row.id) === request.statementId && inScope(row),
  )
  const original = only(
    transactions,
    (row) => id(row.id) === request.transactionId && inScope(row),
  )
  const reversal = only(
    reversals,
    (row) =>
      id(row.originalTransactionId) === request.transactionId && inScope(row),
  )
  const reversalId = id(reversal?.id)
  const originalPaymentId = id(original?.accountPaymentId)
  if (
    !line ||
    !statement ||
    id(line.organizationId) !== request.organizationId ||
    id(line.statementId) !== request.statementId ||
    line.isReconciled !== false ||
    !Array.isArray(line.paymentIds) ||
    line.paymentIds.length !== 0 ||
    line.amountResidual !== line.amount ||
    !original ||
    tag(original.status) !== "Reversed" ||
    unwrapSome(original.sourceEntity) !== "account_bank_statement_line" ||
    id(original.sourceEntityId) !== request.lineId ||
    !reversal ||
    !reversalId ||
    !originalPaymentId ||
    id(reversal.originalAccountPaymentId) !== originalPaymentId
  )
    return null
  const correcting = only(
    transactions,
    (row) =>
      id(row.id) === id(reversal.correctingTransactionId) && inScope(row),
  )
  const originalPayment = only(
    payments,
    (row) => id(row.id) === originalPaymentId && inScope(row),
  )
  const correctingPayment = only(
    payments,
    (row) =>
      id(row.id) === id(reversal.correctingAccountPaymentId) && inScope(row),
  )
  const correctingMoveId = id(correctingPayment?.moveId)
  const entry = only(
    moves,
    (row) => id(row.id) === correctingMoveId && inScope(row),
  )
  if (
    !correcting ||
    tag(correcting.status) !== "Posted" ||
    unwrapSome(correcting.sourceEntity) !== "reversal" ||
    id(correcting.sourceEntityId) !== request.transactionId ||
    id(correcting.accountPaymentId) !== id(correctingPayment?.id) ||
    !originalPayment ||
    tag(originalPayment.state) !== "Reversed" ||
    !correctingPayment ||
    tag(correctingPayment.state) !== "Paid" ||
    !correctingMoveId ||
    id(originalPayment.reversalMoveId) !== correctingMoveId ||
    !entry ||
    tag(entry.state) !== "Posted" ||
    id(entry.journalId) !== id(statement.journalId)
  )
    return null
  return { reversalId, correctingMoveId }
}
