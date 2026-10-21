import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBundleParentCsv,
  splitAccountMoveImportCsv,
} from "./csv-import-bundles"
import {
  HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS,
  HISTORICAL_DOCUMENT_METADATA_KEY,
  MAX_HISTORICAL_PAYMENT_ALLOCATIONS_PER_TRANSACTION,
  OutstandingDocumentImportError,
  prepareOutstandingDocumentImport,
  outstandingDocumentSplitArgs,
} from "./outstanding-document-import"
import { parseCsvText } from "./csv-import-safety"

const headers = [
  "Type",
  "Reference",
  "Journal",
  "Partner",
  "AR AP",
  "Opening account",
  "Posting date",
  "Invoice date",
  "Due date",
  "Original total",
  "Amount due",
  "Currency",
  "Metadata",
]

const mapping = {
  Type: "document_type",
  Reference: "reference",
  Journal: "journal_id",
  Partner: "partner_id",
  "AR AP": "counterpart_account_id",
  "Opening account": "opening_account_id",
  "Posting date": "posting_date",
  "Invoice date": "invoice_date",
  "Due date": "due_date",
  "Original total": "source_total",
  "Amount due": "opening_residual",
  Currency: "currency_id",
  Metadata: "metadata",
}

const replayHeaders = [...headers, "Payment transaction"]
const replayMapping = {
  ...mapping,
  "Payment transaction": "payment_transaction_id",
}

test("outstanding invoices and bills expand into balanced opening bundles", () => {
  const input = {
    headers,
    mapping,
    rows: [
      [
        "customer invoice",
        "INV-10",
        "7",
        "31",
        "1100",
        "3900",
        "2026-01-01",
        "2025-11-10",
        "2025-12-10",
        "150",
        "90",
        "1",
        '{"source":"legacy"}',
      ],
      [
        "vendor_bill",
        "BILL-4",
        "8",
        "44",
        "2100",
        "3900",
        "2026-01-01",
        "2025-12-15",
        "2026-01-15",
        "250",
        "125",
        "1",
        "legacy note",
      ],
    ],
  }
  const prepared = prepareOutstandingDocumentImport(input)
  assert.deepEqual(prepareOutstandingDocumentImport(input), prepared)

  assert.equal(prepared.documentCount, 2)
  assert.equal(prepared.mode, "cutover_open_residual")
  assert.equal(prepared.sourceTotal, 400)
  assert.equal(prepared.openingResidualTotal, 215)
  assert.equal(prepared.sourcePaidToDateTotal, 185)
  assert.equal(prepared.bookedDocumentTotal, 215)
  assert.deepEqual(prepared.paymentReplayGroups, [])
  assert.equal(prepared.documentResumeChecks.length, 2)
  assert.equal(prepared.rows.length, 4)

  const columns = new Map(prepared.headers.map((header, index) => [header, index]))
  const get = (row: string[], field: string) => row[columns.get(field)!]
  assert.deepEqual(
    prepared.rows.map((row) => [get(row, "ref_"), get(row, "debit"), get(row, "credit")]),
    [
      ["INV-10", "90", "0"],
      ["INV-10", "0", "90"],
      ["BILL-4", "0", "125"],
      ["BILL-4", "125", "0"],
    ],
  )
  assert.equal(get(prepared.rows[0]!, "amount_total"), "90")
  assert.equal(get(prepared.rows[1]!, "line_opening_residual"), "")

  const metadata = JSON.parse(get(prepared.rows[0]!, "metadata"))
  assert.equal(metadata.source, "legacy")
  assert.equal(metadata.lumiere_preserved_user_metadata_extra, undefined)
  assert.match(
    metadata.extra[HISTORICAL_DOCUMENT_METADATA_KEY].import_identity,
    /^v1-[0-9a-f]{16}$/,
  )
  assert.deepEqual(metadata.extra[HISTORICAL_DOCUMENT_METADATA_KEY], {
    version: 1,
    import_identity: prepared.documentResumeChecks[0]!.importIdentity,
    batch_identity: prepared.importBatchIdentity,
    mode: "cutover_open_residual",
    source_total: 150,
    source_paid_to_date: 60,
    expected_open_residual: 90,
  })
  const rawMetadata = JSON.parse(get(prepared.rows[2]!, "metadata"))
  assert.equal(rawMetadata.lumiere_preserved_user_metadata, "legacy note")

  const split = splitAccountMoveImportCsv(outstandingDocumentSplitArgs(prepared))
  assert.equal(split.reconciliation.valid, true)
  assert.equal(split.parentRows.length, 2)
  assert.equal(split.reconciliation.totalDebit, 215)
  assert.equal(split.reconciliation.totalCredit, 215)
  for (const group of split.reconciliation.groups) {
    const parent = prepared.rows.find((row) => get(row, "ref_") === group.reference)!
    assert.equal(group.debit, Number(get(parent, "amount_total")))
    assert.equal(group.credit, Number(get(parent, "amount_total")))
  }
  const parentCsv = buildBundleParentCsv(
    split.parentHeaders,
    split.parentRows,
    prepared.parentMapping,
  )
  assert.match(parentCsv, /opening_residual/)
  const parsedParents = parseCsvText(parentCsv)
  const parentColumns = new Map(
    parsedParents.headers.map((header, index) => [header, index]),
  )
  const invoiceParent = parsedParents.rows.find(
    (row) => row[parentColumns.get("ref_")!] === "INV-10",
  )!
  assert.equal(invoiceParent[parentColumns.get("opening_residual")!], "90")
})

test("original-total reconstruction books face value for subsequent payment replay", () => {
  const prepared = prepareOutstandingDocumentImport({
    headers: replayHeaders,
    mapping: replayMapping,
    mode: "reconstruct_original_total",
    rows: [
      [
        "customer invoice",
        "INV-10",
        "7",
        "31",
        "1100",
        "3900",
        "2026-01-01",
        "2025-11-10",
        "2025-12-10",
        "150",
        "90",
        "1",
        '{"source":"legacy"}',
        "81",
      ],
    ],
  })

  assert.equal(prepared.mode, "reconstruct_original_total")
  assert.equal(prepared.sourceTotal, 150)
  assert.equal(prepared.openingResidualTotal, 90)
  assert.equal(prepared.sourcePaidToDateTotal, 60)
  assert.equal(prepared.bookedDocumentTotal, 150)
  assert.deepEqual(prepared.paymentReplayGroups, [
    {
      paymentTransactionId: "81",
      currencyId: "1",
      partnerId: "31",
      documentType: "out_invoice",
      allocations: [
        {
          documentReference: "INV-10",
          postingDate: "2026-01-01",
          allocatedAmount: 60,
          expectedResidualAfter: 90,
          completesDocumentHistory: true,
        },
      ],
    },
  ])

  const columns = new Map(prepared.headers.map((header, index) => [header, index]))
  const get = (row: string[], field: string) => row[columns.get(field)!]
  assert.deepEqual(
    prepared.rows.map((row) => [get(row, "debit"), get(row, "credit")]),
    [
      ["150", "0"],
      ["0", "150"],
    ],
  )
  assert.equal(get(prepared.rows[0]!, "amount_total"), "150")
  assert.equal(get(prepared.rows[0]!, "move_opening_residual"), "150")
  assert.equal(get(prepared.rows[0]!, "line_opening_residual"), "150")
  const marker = JSON.parse(get(prepared.rows[0]!, "metadata")).extra[
    HISTORICAL_DOCUMENT_METADATA_KEY
  ]
  assert.deepEqual(marker, {
    version: 1,
    import_identity: prepared.documentResumeChecks[0]!.importIdentity,
    batch_identity: prepared.importBatchIdentity,
    mode: "original_total",
    source_total: 150,
    source_paid_to_date: 60,
    expected_open_residual: 90,
  })

  const split = splitAccountMoveImportCsv(outstandingDocumentSplitArgs(prepared))
  assert.equal(split.reconciliation.valid, true)
  assert.equal(split.reconciliation.totalDebit, 150)
  assert.equal(split.reconciliation.totalCredit, 150)
})

test("original-total reconstruction requires a posted payment transaction id", () => {
  assert.ok(
    HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS.required.includes(
      "payment_transaction_id",
    ),
  )
  assert.throws(
    () =>
      prepareOutstandingDocumentImport({
        headers,
        mapping,
        mode: "reconstruct_original_total",
        rows: [],
      }),
    /No source column is mapped to payment_transaction_id/,
  )
})

test("original-total reconstruction fails before import when one payment exceeds the BFF batch limit", () => {
  const replayRow = (index: number) => [
    "customer invoice",
    `INV-LIMIT-${index}`,
    "7",
    "31",
    "1100",
    "3900",
    "2026-01-01",
    "2025-11-10",
    "2025-12-10",
    "2",
    "1",
    "1",
    "",
    "81",
  ]
  assert.throws(
    () =>
      prepareOutstandingDocumentImport({
        headers: replayHeaders,
        mapping: replayMapping,
        mode: "reconstruct_original_total",
        rows: Array.from(
          { length: MAX_HISTORICAL_PAYMENT_ALLOCATIONS_PER_TRANSACTION + 1 },
          (_, index) => replayRow(index),
        ),
      }),
    /exceeds the 500-document alpha limit/,
  )
})

test("outstanding import rejects duplicate refs, bad due dates, and residuals above source total", () => {
  assert.throws(
    () =>
      prepareOutstandingDocumentImport({
        headers,
        mapping,
        rows: [
          [
            "out_invoice",
            "INV-1",
            "7",
            "31",
            "1100",
            "3900",
            "2026-01-01",
            "2025-12-10",
            "2025-12-01",
            "50",
            "60",
            "",
            "",
          ],
          [
            "in_invoice",
            "INV-1",
            "8",
            "44",
            "2100",
            "3900",
            "2026-01-01",
            "2025-12-01",
            "2025-12-10",
            "50",
            "40",
            "",
            "",
          ],
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OutstandingDocumentImportError)
      assert.ok(error.issues.some((issue) => issue.code === "invalid_date"))
      assert.ok(error.issues.some((issue) => issue.code === "invalid_residual"))
      assert.ok(error.issues.some((issue) => issue.code === "duplicate_reference"))
      return true
    },
  )
})

test("outstanding import rejects even small residual overages", () => {
  assert.throws(() =>
    prepareOutstandingDocumentImport({
      headers,
      mapping,
      rows: [
        [
          "out_invoice",
          "INV-ROUND",
          "7",
          "31",
          "1100",
          "3900",
          "2026-01-01",
          "2025-12-01",
          "2025-12-10",
          "100",
          "100.004",
          "1",
          "",
        ],
      ],
    }),
  )
})

test("outstanding import surfaces the company-currency-only alpha constraint", () => {
  assert.throws(
    () =>
      prepareOutstandingDocumentImport({
        headers,
        mapping,
        companyCurrencyId: "1",
        rows: [
          [
            "out_invoice",
            "INV-FX",
            "7",
            "31",
            "1100",
            "3900",
            "2026-01-01",
            "2025-12-01",
            "2025-12-10",
            "100",
            "90",
            "2",
            "",
          ],
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OutstandingDocumentImportError)
      assert.ok(error.issues.some((issue) => issue.code === "unsupported_currency"))
      return true
    },
  )
})

test("outstanding import validates mapping and protects its audit marker", () => {
  assert.throws(
    () => prepareOutstandingDocumentImport({ headers, rows: [], mapping: {} }),
    /No source column is mapped to document_type/,
  )

  const reserved = JSON.stringify({
    extra: { [HISTORICAL_DOCUMENT_METADATA_KEY]: { mode: "user" } },
  })
  assert.throws(
    () =>
      prepareOutstandingDocumentImport({
        headers,
        mapping,
        rows: [
          [
            "customer_invoice",
            "INV-1",
            "7",
            "31",
            "1100",
            "3900",
            "2026-01-01",
            "2025-12-01",
            "2025-12-10",
            "50",
            "40",
            "",
            reserved,
          ],
        ],
      }),
    /reserved historical-document marker/,
  )
})
