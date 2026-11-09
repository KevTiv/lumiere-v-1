"use client"

import { useEffect, useRef, useState } from "react"
import { paymentMinorUnitsText } from "@lumiere/erp-shared/payment-allocation-projection"
import type {
  BankTransactionSettlementRequest,
  BankTransactionSettlementResult,
} from "@lumiere/query-hooks/hooks/accounting/bank-statements"
import { Button } from "../components/button"
import type { ReconciliationExceptionCopy } from "./reconciliation-workbench-exception"
import type {
  ReconciliationCandidate,
  ReconciliationContext,
  bankSettlementTransactions,
} from "./reconciliation-workbench-model"

export type BankTransactionSettlementScope = Pick<
  BankTransactionSettlementRequest,
  | "organizationId"
  | "companyId"
  | "statementId"
  | "lineId"
  | "transactionId"
  | "currencyId"
  | "decimalPlaces"
  | "bankAmount"
>
export interface BankTransactionSettlementActions {
  canSettle: boolean
  canRecord: boolean
  ready: boolean
  onConfirm: (
    request: BankTransactionSettlementRequest,
  ) => Promise<BankTransactionSettlementResult | null>
  onCheck: (
    scope: BankTransactionSettlementScope,
    request?: BankTransactionSettlementRequest,
  ) => Promise<BankTransactionSettlementResult | null>
}

interface Props {
  context: ReconciliationContext
  item?: ReconciliationCandidate
  transactions: ReturnType<typeof bankSettlementTransactions>
  actions: BankTransactionSettlementActions
  disabled: boolean
  actorKey: string
  onLockChange: (locked: boolean) => void
  text: ReconciliationExceptionCopy
}

function bankPaymentHref(
  context: ReconciliationContext,
  item?: { id: string; partnerId: string },
  draftId?: string,
) {
  const params = new URLSearchParams({
    tab: "payment-operations",
    bankCompany: context.companyId,
    bankOrganization: context.organizationId,
    bankStatement: context.statementId,
    bankLine: context.lineId,
    ...(item ? { bankPartner: item.partnerId, bankItem: item.id } : {}),
    ...(draftId ? { bankTransaction: draftId } : {}),
  })
  return `/accounting?${params}`
}

export function ReconciliationTransactionSettlement({
  context,
  item,
  transactions,
  actions,
  disabled,
  actorKey,
  onLockChange,
  text,
}: Props) {
  const posted = transactions.filter((row) => row.status === "Posted")
  const transaction = posted.length === 1 ? posted[0] : undefined
  const draft = transactions.find((row) => row.status === "Draft")
  const scope: BankTransactionSettlementScope | undefined = transaction
    ? {
        organizationId: context.organizationId,
        companyId: context.companyId,
        statementId: context.statementId,
        lineId: context.lineId,
        transactionId: transaction.id,
        currencyId: context.currencyId,
        decimalPlaces: context.decimalPlaces,
        bankAmount: context.amount,
      }
    : undefined
  const request =
    scope && item
      ? {
          ...scope,
          moveLineId: item.id,
          openAmount: item.amount,
          allocatedAmount: Math.min(
            Math.abs(item.amount),
            Math.abs(scope.bankAmount),
          ),
        }
      : undefined
  const signature = request
    ? JSON.stringify([actorKey, request, transaction?.reference])
    : ""
  const [reviewed, setReviewed] = useState("")
  const [state, setState] = useState<
    | { status: "idle" | "checking" | "unknown" }
    | { status: "confirmed"; result: BankTransactionSettlementResult }
  >({ status: "idle" })
  const busy = useRef(false)
  const captured = useRef<BankTransactionSettlementRequest | undefined>(
    undefined,
  )
  const activeActor = useRef(actorKey)
  activeActor.current = actorKey
  useEffect(() => () => onLockChange(false), [onLockChange])

  const execute = async (confirm: boolean) => {
    if (
      busy.current ||
      disabled ||
      !scope ||
      (confirm && (!request || !actions.canSettle || reviewed !== signature))
    )
      return
    if (confirm) captured.current = request
    busy.current = true
    setState({ status: "checking" })
    onLockChange(true)
    try {
      const result =
        confirm && request
          ? await actions.onConfirm(request)
          : await actions.onCheck(scope, captured.current)
      setState(
        result && activeActor.current === actorKey
          ? { status: "confirmed", result }
          : { status: "unknown" },
      )
    } catch {
      setState({ status: "unknown" })
    } finally {
      busy.current = false
      onLockChange(false)
    }
  }
  const code = context.currencyCode ?? `#${context.currencyId}`
  const format = (value: bigint) =>
    `${paymentMinorUnitsText(value, context.decimalPlaces)} ${code}`
  const amount = (value: number) =>
    format(BigInt(Math.round(value * 10 ** context.decimalPlaces)))

  if (!actions.ready)
    return (
      <p role="status" className="text-sm">
        {text(
          "postedUnavailable",
          "Posted transaction details are unavailable. Refresh the source before settling.",
        )}
      </p>
    )
  if (!transaction || !scope) {
    if (!item || !actions.canSettle) return null
    if (posted.length > 1)
      return (
        <p role="status" className="text-sm">
          {text(
            "ambiguousTransactions",
            "Several posted transactions claim this bank line. Review their references in Payment Operations.",
          )}
        </p>
      )
    return (
      <div className="space-y-2 border-t pt-3 text-sm">
        <p>
          {text(
            "postedNeeded",
            "A posted transaction tied to this bank line is required. Record or review it in Payment Operations, then return here to match it.",
          )}
        </p>
        {actions.canRecord || draft ? (
          <a
            className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
            href={bankPaymentHref(context, item, draft?.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {draft
              ? text("reviewBankDraft", "Review the payment draft")
              : text(
                  "prepareBankPayment",
                  "Prepare payment from this bank line",
                )}
          </a>
        ) : null}
      </div>
    )
  }
  return (
    <section
      className="space-y-3 border-t pt-3 text-sm"
      aria-label={text(
        "postedReview",
        "Review posted transaction for bank matching",
      )}
    >
      <p className="font-medium">
        {text("postedReference", "Posted transaction #{{id}} · {{reference}}", {
          id: transaction.id,
          reference: transaction.reference,
        })}
      </p>
      {state.status === "confirmed" ? (
        <div role="status" className="space-y-1">
          <p className="font-medium">
            {text("transactionMatched", "Bank line matched")}
          </p>
          <p>
            {text(
              "allocationVerified",
              "Allocation #{{id}} applied {{amount}} to journal item #{{itemId}}.",
              {
                id: state.result.allocationId,
                amount: format(state.result.allocatedMinor),
                itemId: state.result.moveLineId,
              },
            )}
          </p>
          <p>
            {text("remainingBalance", "Current document balance {{amount}}", {
              amount: format(state.result.documentRemainingMinor),
            })}
          </p>
          <p>
            {text(
              "unappliedCredit",
              "Current unapplied payment credit {{amount}}",
              { amount: format(state.result.unappliedCreditMinor) },
            )}
          </p>
          {transaction.partnerId ? (
            <a
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
              href={bankPaymentHref(
                context,
                {
                  id: state.result.moveLineId,
                  partnerId: transaction.partnerId,
                },
                transaction.id,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text("reviewMatchedTransaction", "Open payment transaction")}
            </a>
          ) : null}
        </div>
      ) : null}
      {state.status === "checking" ? (
        <p role="status">
          {text(
            "checkingTransaction",
            "Checking the bank match and posted balances…",
          )}
        </p>
      ) : null}
      {state.status === "unknown" ? (
        <p role="alert">
          {text(
            "transactionUnconfirmed",
            "The bank match and allocation could not be verified. Check this exact transaction before taking another action.",
          )}
        </p>
      ) : null}
      {!item || state.status === "unknown" || state.status === "confirmed" ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled || state.status === "checking"}
          onClick={() => void execute(false)}
        >
          {text("checkTransaction", "Check the saved bank match")}
        </Button>
      ) : null}
      {state.status === "unknown" &&
      request &&
      actions.canSettle &&
      reviewed === signature ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={disabled}
          onClick={() => void execute(true)}
        >
          {text("retryTransaction", "Retry the reviewed bank match")}
        </Button>
      ) : null}
      {request && actions.canSettle && state.status === "idle" ? (
        <>
          <p>
            {text(
              "applyReview",
              "Apply {{amount}} from this posted transaction and match the bank line. The document balance will be {{remaining}}. Unapplied payment credit will be {{credit}}.",
              {
                amount: amount(request.allocatedAmount),
                remaining: amount(
                  Math.abs(request.openAmount) - request.allocatedAmount,
                ),
                credit: amount(
                  Math.abs(request.bankAmount) - request.allocatedAmount,
                ),
              },
            )}
          </p>
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-primary"
              disabled={disabled}
              checked={reviewed === signature}
              onChange={(event) =>
                setReviewed(event.target.checked ? signature : "")
              }
            />
            <span>
              {text(
                "authorizeTransaction",
                "I reviewed the bank line, posted transaction, journal item and amounts.",
              )}
            </span>
          </label>
          <Button
            type="button"
            className="min-h-11 h-auto whitespace-normal"
            disabled={disabled || reviewed !== signature}
            onClick={() => void execute(true)}
          >
            {text("confirmTransaction", "Apply payment and match bank line")}
          </Button>
        </>
      ) : null}
    </section>
  )
}
