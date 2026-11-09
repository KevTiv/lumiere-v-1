"use client"

import { useState } from "react"
import { Button } from "../components/button"
import type {
  ReconciliationContext,
  ReconciliationDocumentItem,
  ReconciliationIssue,
} from "./reconciliation-workbench-model"

export type ReconciliationExceptionCopy = (
  key: string,
  defaultValue: string,
  values?: Record<string, string>,
) => string

interface ExceptionReviewProps {
  context: ReconciliationContext
  bankAmount: string
  difference?: string
  items?: readonly (ReconciliationDocumentItem & { openAmount?: string })[]
  foreignCurrencies?: readonly string[]
  issue: ReconciliationIssue | "foreign_bank_line"
  canApplyExistingPayment?: boolean
  operationalSettlement?: boolean
  canReviewFx?: boolean
  text: ReconciliationExceptionCopy
}

export function ReconciliationExceptionReview({
  context,
  bankAmount,
  difference,
  items = [],
  foreignCurrencies = [],
  issue,
  canApplyExistingPayment,
  operationalSettlement = false,
  canReviewFx = false,
  text,
}: ExceptionReviewProps) {
  const [copyState, setCopyState] = useState<"copied" | "unavailable" | null>(
    null,
  )

  switch (issue) {
    case "stale_selection":
      return (
        <p role="alert" className="text-sm text-destructive">
          {text(
            "staleSelection",
            "A selected item is no longer eligible. Clear the selection and review the current records.",
          )}
        </p>
      )
    case "mixed_partners":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {text(
            "mixedPartners",
            "This selection contains more than one partner. Select records for the partner on this bank transaction.",
          )}
        </p>
      )
    case "mixed_accounts":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {text(
            "mixedAccounts",
            "This selection spans more than one receivable or payable account. An exact settlement requires a single account.",
          )}
        </p>
      )
    case "incomplete_document":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {text(
            "incompleteDocument",
            "A selected document has other open journal items. Include all its open items before reviewing the amount difference.",
          )}
        </p>
      )
    case "unavailable_amount":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {text(
            "unavailableAmount",
            "The total cannot be represented at this currency’s precision. Share the bank line and item amounts with an authorized accountant for review.",
          )}
        </p>
      )
  }

  const isForeign =
    issue === "foreign_bank_line" || issue === "foreign_document"
  const isShort = issue === "short_payment"
  const singleDocument =
    items.length > 0 && items.every((item) => item.moveId === items[0]?.moveId)
      ? items[0]
      : undefined
  const paymentDocument =
    isShort && canApplyExistingPayment && !operationalSettlement
      ? singleDocument
      : undefined
  const heading = isForeign
    ? text("foreignHeading", "FX review required")
    : isShort
      ? text("shortHeading", "Bank amount is below the selected balance")
      : text("excessHeading", "Bank amount exceeds the selected balance")
  const bankReference = text(
    "bankReference",
    "{{statement}} (#{{statementId}}) · Bank line #{{lineId}} · Company #{{companyId}}",
    {
      statement: context.statementLabel,
      statementId: context.statementId,
      lineId: context.lineId,
      companyId: context.companyId,
    },
  )
  const bankDetail = [context.lineLabel, context.dateLabel, bankAmount]
    .filter(Boolean)
    .join(" · ")
  const currencyDetail =
    foreignCurrencies.length > 0
      ? text(
          "foreignCurrencyDetail",
          "Other currencies on this bank line: {{currencies}}",
          { currencies: foreignCurrencies.join(", ") },
        )
      : null
  const itemRefs = items.map((item) => {
    const reference = text(
      "documentItemRef",
      "{{document}} (#{{documentId}}) · Item #{{itemId}}",
      {
        document: item.documentLabel,
        documentId: item.moveId,
        itemId: item.id,
      },
    )
    return item.openAmount ? `${reference} · ${item.openAmount}` : reference
  })
  const differenceDetail =
    !isForeign && difference
      ? text("differenceDetail", "Difference to review: {{amount}}", {
          amount: difference,
        })
      : null
  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          heading,
          bankReference,
          bankDetail,
          currencyDetail,
          differenceDetail,
          ...itemRefs,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      setCopyState("copied")
    } catch {
      setCopyState("unavailable")
    }
  }

  return (
    <section
      aria-label={heading}
      className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3 [overflow-wrap:anywhere]"
    >
      <h5 className="font-semibold">{heading}</h5>
      {isForeign ? (
        <p className="text-sm">
          {text(
            "foreignNext",
            "Exact settlement requires the company currency. Give these references to an authorized accountant to verify the transaction currency, settlement rate, and any realized FX difference. This bank line stays unmatched while they review it.",
          )}
        </p>
      ) : null}
      {operationalSettlement ? (
        <p className="text-sm">
          {text(
            "postedPath",
            "Use the posted transaction tied to this bank line to review the allocation and any remaining balance.",
          )}
        </p>
      ) : null}
      {isShort && !operationalSettlement ? (
        <div className="space-y-2 text-sm">
          <p>
            {paymentDocument
              ? text(
                  "partialNext",
                  "If this is a partial payment and the matching payment is already posted, open the document and choose Apply existing payment. Verify its reference and amount before applying it. The bank line stays unmatched.",
                )
              : singleDocument
                ? text(
                    "partialRestricted",
                    "If this is a partial payment, ask an authorized accountant to verify and apply the existing posted payment to the document. The bank line stays unmatched.",
                  )
                : text(
                    "partialMultiple",
                    "If this is a partial payment, ask an authorized accountant to verify how the posted payment should be split across these documents. The bank line stays unmatched.",
                  )}
          </p>
          <p>
            {text(
              "writeOffNext",
              "If the remaining balance is an approved write-off, use the separate write-off in Payment Operations when there is a matching posted transaction. Give the accountant these references to verify the transaction and write-off account. That allocation leaves the bank line unmatched.",
            )}
          </p>
        </div>
      ) : null}
      {issue === "excess_payment" && !operationalSettlement ? (
        <p className="text-sm">
          {text(
            "excessNext",
            "Check whether another open document belongs to this payment. If the excess is genuine, give these details to an authorized accountant to review unapplied payment credit. This bank line stays unmatched.",
          )}
        </p>
      ) : null}
      <div className="select-text space-y-1 border-t pt-2 text-sm text-muted-foreground">
        <p>{bankReference}</p>
        <p className="tabular-nums">{bankDetail}</p>
        {currencyDetail ? <p>{currencyDetail}</p> : null}
        {differenceDetail ? (
          <p className="tabular-nums">{differenceDetail}</p>
        ) : null}
        {itemRefs.length ? (
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {itemRefs.map((reference, index) => (
              <li key={items[index]?.id}>{reference}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isForeign && canReviewFx ? (
          <a
            href={`/accounting?${new URLSearchParams({
              tab: "fx-revaluation",
              bankOrganization: context.organizationId,
              bankCompany: context.companyId,
              bankStatement: context.statementId,
              bankLine: context.lineId,
            })}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text("openFxReview", "Open FX review")}
          </a>
        ) : null}
        {paymentDocument ? (
          <a
            href={paymentDocument.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text("openDocument", "Open {{document}} in a new tab", {
              document: paymentDocument.documentLabel,
            })}
          </a>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="min-h-11 h-auto whitespace-normal text-start"
          onClick={() => void copyDetails()}
        >
          {text("copyDetails", "Copy review details")}
        </Button>
      </div>
      {copyState ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copyState === "copied"
            ? text("copied", "Review details copied.")
            : text(
                "copyUnavailable",
                "Clipboard is unavailable. Select and copy the review details above.",
              )}
        </p>
      ) : null}
    </section>
  )
}
