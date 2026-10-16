export interface OpeningBalanceFixtureInput {
  code: string
  name: string
  userTypeId: number
  openingDebit: number
  openingCredit?: number
  openingBalance: number
}

export interface HistoricalJournalFixtureInput {
  journalId: number
  debitAccountId: number
  creditAccountId: number
  reference: string
  date: string
  amount: number
  /** Adds a deliberate imbalance to the credit row for the failed-import drill. */
  creditAdjustment?: number
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function fixtureCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")
}

/** One account row that exercises the historical opening-balance compatibility fields. */
export function openingBalanceCsv(input: OpeningBalanceFixtureInput): string {
  return fixtureCsv(
    [
      "code",
      "name",
      "user_type_id",
      "reconcile",
      "opening_debit",
      "opening_credit",
      "opening_balance",
      "metadata",
    ],
    [[
      input.code,
      input.name,
      input.userTypeId,
      "true",
      input.openingDebit,
      input.openingCredit ?? 0,
      input.openingBalance,
      JSON.stringify({ source: "rwanda-alpha-rehearsal", country: "RW" }),
    ]],
  )
}

/**
 * Flat historical journal fixture accepted by the accounting bundle UI. The
 * repeated reference is resolved to one draft parent after its lines balance.
 */
export function historicalJournalCsv(input: HistoricalJournalFixtureInput): string {
  return fixtureCsv(
    [
      "journal_id",
      "ref_",
      "date",
      "move_name",
      "account_id",
      "debit",
      "credit",
      "line_name",
      "metadata",
    ],
    [
      [
        input.journalId,
        input.reference,
        input.date,
        input.reference,
        input.debitAccountId,
        input.amount,
        0,
        "Opening debit",
        JSON.stringify({ source: "rwanda-alpha-rehearsal", country: "RW" }),
      ],
      [
        input.journalId,
        input.reference,
        input.date,
        input.reference,
        input.creditAccountId,
        0,
        input.amount + (input.creditAdjustment ?? 0),
        "Opening credit",
        JSON.stringify({ source: "rwanda-alpha-rehearsal", country: "RW" }),
      ],
    ],
  )
}

export interface HistoricalPaymentFixtureInput {
  companyId: number
  paymentTransactionId: number
  currencyId: number
  documentMoveId: number
  sourceTotal: number
  expectedOpenResidual: number
}

/** Exact reducer wire shape for replaying paid-to-date value on original-total documents. */
export function historicalPaymentAllocationFixture(input: HistoricalPaymentFixtureInput) {
  const allocatedAmount = input.sourceTotal - input.expectedOpenResidual
  if (input.sourceTotal <= 0 || input.expectedOpenResidual < 0 || allocatedAmount <= 0) {
    throw new Error("Historical payment fixture requires a positive paid-to-date amount")
  }
  return {
    idempotency_key: `rw-alpha-history-${input.paymentTransactionId}-${input.documentMoveId}`,
    company_id: input.companyId,
    payment_transaction_id: input.paymentTransactionId,
    currency_id: input.currencyId,
    allocations: [
      {
        document_move_id: input.documentMoveId,
        allocated_amount: allocatedAmount,
        expected_residual_after: input.expectedOpenResidual,
        completes_document_history: true,
      },
    ],
    metadata: JSON.stringify({ source: "rwanda-alpha-rehearsal", country: "RW" }),
  }
}
