import assert from "node:assert/strict";
import test from "node:test";
import {
  accountMoveBundleToken,
  markAccountMoveBundleParentCsv,
  parseCsvText,
} from "@lumiere/erp-shared";

import {
  buildHistoricalPaymentReplayBatches,
  resolveHistoricalImportResume,
  validateHistoricalPaymentReplayCapability,
  validateHistoricalPaymentReplaySources,
} from "./historical-payment-import";

const groups = [
  {
    paymentTransactionId: "31",
    currencyId: "4",
    partnerId: "9",
    documentType: "out_invoice" as const,
    allocations: [
      {
        documentReference: "INV-1",
        postingDate: "2026-01-01",
        allocatedAmount: 60,
        expectedResidualAfter: 90,
        completesDocumentHistory: true as const,
      },
      {
        documentReference: "INV-2",
        postingDate: "2026-01-01",
        allocatedAmount: 40,
        expectedResidualAfter: 10,
        completesDocumentHistory: true as const,
      },
    ],
  },
];

test("binds grouped historical allocations to imported move ids", () => {
  const batches = buildHistoricalPaymentReplayBatches({
    companyId: 7n,
    bundleToken: "v1-abc",
    moveIdByReference: new Map([
      ["INV-1", "101"],
      ["INV-2", "102"],
    ]),
    groups,
  });

  assert.deepEqual(batches, [
    {
      idempotencyKey: "accounting-history:v1-abc:31",
      companyId: 7n,
      paymentTransactionId: 31n,
      currencyId: 4n,
      allocations: [
        {
          documentMoveId: 101n,
          allocatedAmount: 60,
          expectedResidualAfter: 90,
          completesDocumentHistory: true,
        },
        {
          documentMoveId: 102n,
          allocatedAmount: 40,
          expectedResidualAfter: 10,
          completesDocumentHistory: true,
        },
      ],
      metadata: JSON.stringify({
        source: "accounting-original-total-import",
        bundle_token: "v1-abc",
      }),
    },
  ]);
});

test("fails closed when an imported reference cannot be resolved", () => {
  assert.throws(
    () =>
      buildHistoricalPaymentReplayBatches({
        companyId: 7n,
        bundleToken: "v1-abc",
        moveIdByReference: new Map(),
        groups: [
          {
            paymentTransactionId: "31",
            currencyId: "4",
            partnerId: "9",
            documentType: "out_invoice",
            allocations: [
              {
                documentReference: "INV-MISSING",
                postingDate: "2026-01-01",
                allocatedAmount: 60,
                expectedResidualAfter: 90,
                completesDocumentHistory: true,
              },
            ],
          },
        ],
      }),
    /could not be resolved/,
  );
});

test("preflights payment scope, state, direction, and exact settlement total", () => {
  assert.doesNotThrow(() =>
    validateHistoricalPaymentReplaySources({
      companyId: 7n,
      groups,
      paymentTransactions: [
        {
          id: 31,
          companyId: 7,
          currencyId: 4,
          partnerId: 9,
          status: { tag: "Posted" },
          direction: { tag: "Inbound" },
          partnerType: { tag: "Customer" },
          settlementAmount: 100,
          sourceEntity: "historical_accounting_import",
          sourceEntityId: 501,
          occurredAt: {
            microsSinceUnixEpoch:
              BigInt(Date.parse("2025-12-31T23:00:00Z")) * 1000n,
          },
        },
      ],
    }),
  );

  assert.throws(
    () =>
      validateHistoricalPaymentReplaySources({
        companyId: 7n,
        groups,
        paymentTransactions: [
          {
            id: 31,
            company_id: 7,
            currency_id: 4,
            partner_id: 9,
            status: "Pending",
            direction: "Inbound",
            partner_type: "Customer",
            settlement_amount: 100,
            source_entity: { some: "historical_accounting_import" },
            source_entity_id: { some: 501 },
            occurred_at: "2025-12-31T23:00:00Z",
          },
        ],
      }),
    /must be posted/,
  );
});

test("rejects ordinary payments and payments after the migration posting date", () => {
  const transaction = {
    id: 31,
    companyId: 7,
    currencyId: 4,
    partnerId: 9,
    status: "Posted",
    direction: "Inbound",
    partnerType: "Customer",
    settlementAmount: 100,
    sourceEntityId: 501,
    occurredAt: "2025-12-31T23:00:00Z",
  };
  assert.throws(
    () =>
      validateHistoricalPaymentReplaySources({
        companyId: 7n,
        groups,
        paymentTransactions: [{ ...transaction, sourceEntity: "manual_entry" }],
      }),
    /must come from historical_accounting_import/,
  );
  assert.throws(
    () =>
      validateHistoricalPaymentReplaySources({
        companyId: 7n,
        groups,
        paymentTransactions: [
          {
            ...transaction,
            sourceEntity: "historical_accounting_import",
            occurredAt: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    /occurred after/,
  );
  assert.doesNotThrow(() =>
    validateHistoricalPaymentReplaySources({
      companyId: 7n,
      groups,
      paymentTransactions: [
        {
          ...transaction,
          sourceEntity: "historical_accounting_import",
          occurredAt: {
            __timestamp_micros_since_unix_epoch__:
              Date.parse("2026-01-01T23:59:59.999Z") * 1000,
          },
        },
      ],
    }),
  );
});

test("runtime capability rejects deployed contract skew", () => {
  assert.doesNotThrow(() =>
    validateHistoricalPaymentReplayCapability({
      data: {
        reducerName: "apply_historical_payment_allocations",
        operationId: "erp.apply_historical_payment_allocations",
        contractVersion: "0.3.108",
        signatureReady: true,
      },
    }),
  );
  assert.throws(
    () =>
      validateHistoricalPaymentReplayCapability({
        data: {
          reducerName: "apply_historical_payment_allocations",
          operationId: "erp.apply_historical_payment_allocations",
          contractVersion: "0.3.107",
          signatureReady: true,
        },
      }),
    /unavailable/,
  );
});

test("same-file retry recognizes the two atomic bundle states: all parents empty or all documents complete", () => {
  const history = {
    version: 1,
    mode: "original_total",
    import_identity: "v1-document",
    batch_identity: "v1-upload",
    source_total: 150,
    source_paid_to_date: 60,
    expected_open_residual: 90,
  };
  const rawMetadata = JSON.stringify({
    extra: { lumiere_historical_document: history },
  });
  const parentCsv = `ref_,metadata\nINV-1,"${rawMetadata.replaceAll('"', '""')}"`;
  const bundleToken = accountMoveBundleToken(parentCsv);
  const markedParentCsv = markAccountMoveBundleParentCsv(parentCsv);
  const marked = parseCsvText(markedParentCsv);
  const markedMetadata = marked.rows[0]![marked.headers.indexOf("metadata")]!;
  const check = {
    reference: "INV-1",
    importIdentity: "v1-document",
    journalId: "7",
    partnerId: "31",
    currencyId: "1",
    documentType: "out_invoice" as const,
    postingDate: "2026-01-01",
    invoiceDate: "2025-11-10",
    dueDate: "2025-12-10",
    sourceTotal: 150,
    expectedResidual: 90,
    counterpartAccountId: "1100",
    openingAccountId: "3900",
  };
  const move = {
    id: 101,
    companyId: 7,
    journalId: 7,
    partnerId: 31,
    currencyId: 1,
    ref: "INV-1",
    moveType: "OutInvoice",
    state: "Draft",
    date: {
      __timestamp_micros_since_unix_epoch__:
        Date.parse("2026-01-01T00:00:00Z") * 1000,
    },
    invoiceDate: {
      microsSinceUnixEpoch: BigInt(Date.parse("2025-11-10T00:00:00Z")) * 1000n,
    },
    invoiceDateDue: {
      micros_since_unix_epoch: String(
        Date.parse("2025-12-10T00:00:00Z") * 1000,
      ),
    },
    amountTotal: 150,
    amountResidual: 150,
    metadata: markedMetadata,
  };
  const base = {
    checks: [check],
    existingMoves: [move],
    companyId: 7n,
    bundleToken,
    markedParentCsv,
    importBatchIdentity: "v1-upload",
  };
  const partial = resolveHistoricalImportResume({ ...base, existingLines: [] });
  assert.equal(partial.phase, "lines_pending");
  assert.equal(partial.moveIdByReference.get("INV-1"), "101");

  const complete = resolveHistoricalImportResume({
    ...base,
    existingMoves: [
      { ...move, state: "Posted", amountResidual: 90, metadata: rawMetadata },
    ],
    existingLines: [
      { moveId: 101, accountId: 1100, debit: 150, credit: 0 },
      { moveId: 101, accountId: 3900, debit: 0, credit: 150 },
    ],
  });
  assert.equal(complete.phase, "complete");

  assert.throws(
    () =>
      resolveHistoricalImportResume({
        ...base,
        existingMoves: [{ ...move, amountTotal: 151 }],
        existingLines: [],
      }),
    /does not exactly match/,
  );
});
