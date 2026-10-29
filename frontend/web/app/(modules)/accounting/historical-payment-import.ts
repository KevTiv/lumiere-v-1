
import { i18n } from "@lumiere/i18n"
import {
  ACCOUNT_MOVE_BUNDLE_METADATA_KEY,
  parseCsvText,
} from "@lumiere/erp-shared";
import {
  HISTORICAL_DOCUMENT_METADATA_KEY,
  type HistoricalDocumentResumeCheck,
  type HistoricalPaymentReplayGroup,
} from "@lumiere/erp-shared/outstanding-document-import";
import {
  isoToDate,
  stdbTimestampToDate,
} from "@lumiere/erp-shared/timestamp-values";
import type { ApplyHistoricalPaymentAllocationsParams } from "@lumiere/query-hooks/hooks/accounting";

export type HistoricalPaymentReplayBatch =
  ApplyHistoricalPaymentAllocationsParams;
export const HISTORICAL_ACCOUNTING_IMPORT_SOURCE =
  "historical_accounting_import";
const HISTORICAL_PAYMENT_REPLAY_OPERATION =
  "erp.apply_historical_payment_allocations";
const HISTORICAL_PAYMENT_REPLAY_REDUCER =
  "apply_historical_payment_allocations";
const HISTORICAL_PAYMENT_REPLAY_CONTRACT = "0.3.108";

type PaymentTransactionRow = object;
type AccountingRow = object;

function objectField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key);
}

function unwrapSats(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value;
    if ("some" in row) return unwrapSats(objectField(row, "some"));
    if ("none" in row) return null;
    const tag = objectField(row, "tag");
    if (typeof tag === "string") return tag;
    const keys = Object.keys(row);
    if (keys.length === 1) return keys[0];
  }
  return value;
}

function rawRowValue(
  row: PaymentTransactionRow,
  camel: string,
  snake: string,
): unknown {
  return objectField(row, camel) ?? objectField(row, snake);
}

function rowValue(
  row: PaymentTransactionRow,
  camel: string,
  snake: string,
): unknown {
  return unwrapSats(rawRowValue(row, camel, snake));
}

function normalizedTag(value: unknown): string {
  return String(unwrapSats(value) ?? "")
    .replace(/[_ -]/g, "")
    .toLowerCase();
}

function timestampDate(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const option = value;
    if ("some" in option) return timestampDate(objectField(option, "some"));
    if ("none" in option) return null;
  }
  const parsed =
    stdbTimestampToDate(value) ??
    (typeof value === "string" ? isoToDate(value) : null);
  return parsed?.toISOString().slice(0, 10) ?? null;
}

function numberField(row: AccountingRow, camel: string, snake: string): number {
  return Number(rowValue(row, camel, snake));
}

function jsonObject(value: unknown): object | null {
  const raw = unwrapSats(value);
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function amountMatches(left: number, right: number): boolean {
  return Number.isFinite(left) && Math.abs(left - right) <= 0.000_001;
}

/** Reject deployed API/contract skew before the import creates any documents. */
export function validateHistoricalPaymentReplayCapability(
  payload: unknown,
): void {
  const root = payload && typeof payload === "object" ? payload : null;
  const dataValue = root && objectField(root, "data");
  const data = dataValue && typeof dataValue === "object" ? dataValue : null;
  if (
    !data ||
    objectField(data, "reducerName") !== HISTORICAL_PAYMENT_REPLAY_REDUCER ||
    objectField(data, "operationId") !== HISTORICAL_PAYMENT_REPLAY_OPERATION ||
    objectField(data, "contractVersion") !==
      HISTORICAL_PAYMENT_REPLAY_CONTRACT ||
    objectField(data, "signatureReady") !== true
  ) {
    throw new Error(
      i18n.t("accounting.historicalPaymentImport.historicalPaymentReplayIsUnavailableOnTheDeployedAPIContractVersion"),
    );
  }
}

export type HistoricalImportResume = {
  phase: "new" | "lines_pending" | "complete";
  moveIdByReference: Map<string, string>;
};

/**
 * Recognize only an exact prior submission. Reference collisions, changed
 * metadata, altered lines, and mixed completion states all fail closed.
 */
export function resolveHistoricalImportResume(args: {
  checks: readonly HistoricalDocumentResumeCheck[];
  existingMoves: readonly AccountingRow[];
  existingLines: readonly AccountingRow[];
  companyId: bigint;
  bundleToken: string;
  markedParentCsv: string;
  importBatchIdentity: string;
}): HistoricalImportResume {
  const references = new Set(args.checks.map((check) => check.reference));
  const matching = args.existingMoves.filter(
    (move) =>
      String(rowValue(move, "companyId", "company_id")) ===
        String(args.companyId) &&
      references.has(
        String(objectField(move, "ref") ?? objectField(move, "ref_") ?? ""),
      ),
  );
  if (matching.length === 0) {
    return { phase: "new", moveIdByReference: new Map() };
  }
  if (matching.length !== args.checks.length) {
    throw new Error(
      i18n.t("accounting.historicalPaymentImport.historicalImportFoundOnlySomeDocumentReferencesFromThisFileUse"),
    );
  }

  const marked = parseCsvText(args.markedParentCsv);
  const refIndex = marked.headers.indexOf("ref_");
  const metadataIndex = marked.headers.indexOf("metadata");
  const expectedFingerprint = new Map<string, string>();
  for (const row of marked.rows) {
    const metadata = jsonObject(row[metadataIndex]);
    const extraValue = metadata && objectField(metadata, "extra");
    const extra =
      extraValue && typeof extraValue === "object" ? extraValue : null;
    const markerValue =
      extra && objectField(extra, ACCOUNT_MOVE_BUNDLE_METADATA_KEY);
    const marker =
      markerValue && typeof markerValue === "object" ? markerValue : null;
    expectedFingerprint.set(
      String(row[refIndex] ?? ""),
      String(marker ? (objectField(marker, "fingerprint") ?? "") : ""),
    );
  }

  const moveIdByReference = new Map<string, string>();
  const completion: Array<"empty" | "complete"> = [];
  for (const check of args.checks) {
    const candidates = matching.filter(
      (move) =>
        String(objectField(move, "ref") ?? objectField(move, "ref_") ?? "") ===
        check.reference,
    );
    if (candidates.length !== 1) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.documentReferenceIsNotUniqueInThisCompany", { value1: check.reference }),
      );
    }
    const move = candidates[0]!;
    const moveId = String(unwrapSats(objectField(move, "id")) ?? "");
    const metadata = jsonObject(objectField(move, "metadata"));
    const extraValue = metadata && objectField(metadata, "extra");
    const extra =
      extraValue && typeof extraValue === "object" ? extraValue : null;
    const historyValue =
      extra && objectField(extra, HISTORICAL_DOCUMENT_METADATA_KEY);
    const history =
      historyValue && typeof historyValue === "object" ? historyValue : null;
    if (
      !history ||
      objectField(history, "mode") !== "original_total" ||
      objectField(history, "import_identity") !== check.importIdentity ||
      objectField(history, "batch_identity") !== args.importBatchIdentity ||
      !amountMatches(
        Number(objectField(history, "source_total")),
        check.sourceTotal,
      ) ||
      !amountMatches(
        Number(objectField(history, "expected_open_residual")),
        check.expectedResidual,
      ) ||
      String(rowValue(move, "journalId", "journal_id")) !== check.journalId ||
      String(rowValue(move, "partnerId", "partner_id")) !== check.partnerId ||
      String(rowValue(move, "currencyId", "currency_id")) !==
        check.currencyId ||
      normalizedTag(rowValue(move, "moveType", "move_type")) !==
        normalizedTag(check.documentType) ||
      timestampDate(rawRowValue(move, "date", "date")) !== check.postingDate ||
      timestampDate(rawRowValue(move, "invoiceDate", "invoice_date")) !==
        check.invoiceDate ||
      timestampDate(rawRowValue(move, "invoiceDateDue", "invoice_date_due")) !==
        check.dueDate ||
      !amountMatches(
        numberField(move, "amountTotal", "amount_total"),
        check.sourceTotal,
      )
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.existingDocumentDoesNotExactlyMatchThisOriginalTotalImportFile", { value1: check.reference }),
      );
    }
    const state = normalizedTag(objectField(move, "state"));
    if (state !== "draft" && state !== "posted") {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.existingDocumentIsNeitherDraftNorPosted", { value1: check.reference }),
      );
    }
    const lines = args.existingLines.filter(
      (line) => String(rowValue(line, "moveId", "move_id")) === moveId,
    );
    if (lines.length === 0) {
      const bundleValue =
        extra && objectField(extra, ACCOUNT_MOVE_BUNDLE_METADATA_KEY);
      const bundle =
        bundleValue && typeof bundleValue === "object" ? bundleValue : null;
      if (
        state !== "draft" ||
        !bundle ||
        objectField(bundle, "token") !== args.bundleToken ||
        objectField(bundle, "fingerprint") !==
          expectedFingerprint.get(check.reference)
      ) {
        throw new Error(
          i18n.t("accounting.historicalPaymentImport.emptyDocumentIsNotOwnedByThisExactBundleImport", { value1: check.reference }),
        );
      }
      completion.push("empty");
    } else {
      if (lines.length !== 2) {
        throw new Error(
          i18n.t("accounting.historicalPaymentImport.existingDocumentHasAnUnexpectedLineCount", { value1: check.reference }),
        );
      }
      const expected =
        check.documentType === "out_invoice"
          ? [
              {
                account: check.counterpartAccountId,
                debit: check.sourceTotal,
                credit: 0,
              },
              {
                account: check.openingAccountId,
                debit: 0,
                credit: check.sourceTotal,
              },
            ]
          : [
              {
                account: check.counterpartAccountId,
                debit: 0,
                credit: check.sourceTotal,
              },
              {
                account: check.openingAccountId,
                debit: check.sourceTotal,
                credit: 0,
              },
            ];
      for (const expectation of expected) {
        const line = lines.find(
          (candidate) =>
            String(rowValue(candidate, "accountId", "account_id")) ===
            expectation.account,
        );
        if (
          !line ||
          !amountMatches(
            numberField(line, "debit", "debit"),
            expectation.debit,
          ) ||
          !amountMatches(
            numberField(line, "credit", "credit"),
            expectation.credit,
          )
        ) {
          throw new Error(
            i18n.t("accounting.historicalPaymentImport.existingDocumentLinesWereAltered", { value1: check.reference }),
          );
        }
      }
      const residual = numberField(move, "amountResidual", "amount_residual");
      if (
        !amountMatches(residual, check.sourceTotal) &&
        !amountMatches(residual, check.expectedResidual)
      ) {
        throw new Error(
          i18n.t("accounting.historicalPaymentImport.existingDocumentHasAnUnexpectedResidual", { value1: check.reference }),
        );
      }
      completion.push("complete");
    }
    moveIdByReference.set(check.reference, moveId);
  }
  if (new Set(completion).size !== 1) {
    // The marked parent and line reducers validate and commit each complete bundle as a unit.
    // A supported interrupted run is therefore either all empty parents or all completed
    // documents. Mixed state indicates a legacy/out-of-band change and must stay fail-closed.
    throw new Error(
      i18n.t("accounting.historicalPaymentImport.historicalImportHasMixedEmptyAndCompletedDocumentsWhichAnAtomic"),
    );
  }
  return {
    phase: completion[0] === "empty" ? "lines_pending" : "complete",
    moveIdByReference,
  };
}

/** Stop before document creation when the referenced posted payments cannot fund the replay. */
export function validateHistoricalPaymentReplaySources(args: {
  groups: readonly HistoricalPaymentReplayGroup[];
  paymentTransactions: readonly PaymentTransactionRow[];
  companyId: bigint;
}): void {
  const byId = new Map(
    args.paymentTransactions.map((row) => [
      String(unwrapSats(objectField(row, "id")) ?? ""),
      row,
    ]),
  );
  for (const group of args.groups) {
    const transaction = byId.get(group.paymentTransactionId);
    if (!transaction) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionWasNotFound", { value1: group.paymentTransactionId }),
      );
    }
    if (
      String(rowValue(transaction, "companyId", "company_id")) !==
      String(args.companyId)
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionBelongsToAnotherCompany", { value1: group.paymentTransactionId }),
      );
    }
    if (normalizedTag(objectField(transaction, "status")) !== "posted") {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionMustBePostedBeforeImport", { value1: group.paymentTransactionId }),
      );
    }
    if (
      rowValue(transaction, "sourceEntity", "source_entity") !==
      HISTORICAL_ACCOUNTING_IMPORT_SOURCE
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionMustComeFrom", { value1: group.paymentTransactionId, value2: HISTORICAL_ACCOUNTING_IMPORT_SOURCE }),
      );
    }
    const sourceEntityId = Number(
      rowValue(transaction, "sourceEntityId", "source_entity_id"),
    );
    if (!Number.isSafeInteger(sourceEntityId) || sourceEntityId <= 0) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionNeedsAPositiveOperatorSuppliedMigrationBatchReference", { value1: group.paymentTransactionId }),
      );
    }
    const occurredDate = timestampDate(
      rawRowValue(transaction, "occurredAt", "occurred_at"),
    );
    if (
      !occurredDate ||
      group.allocations.some(
        (allocation) => occurredDate > allocation.postingDate,
      )
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionOccurredAfterAnImportedDocumentPostingDate", { value1: group.paymentTransactionId }),
      );
    }
    if (
      String(rowValue(transaction, "currencyId", "currency_id")) !==
      group.currencyId
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionUsesADifferentCurrency", { value1: group.paymentTransactionId }),
      );
    }
    if (
      String(rowValue(transaction, "partnerId", "partner_id")) !==
      group.partnerId
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionUsesADifferentPartner", { value1: group.paymentTransactionId }),
      );
    }
    const expectedDirection =
      group.documentType === "out_invoice" ? "inbound" : "outbound";
    const expectedPartnerType =
      group.documentType === "out_invoice" ? "customer" : "supplier";
    if (
      normalizedTag(objectField(transaction, "direction")) !==
        expectedDirection ||
      normalizedTag(rowValue(transaction, "partnerType", "partner_type")) !==
        expectedPartnerType
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionIsIncompatibleWithItsInvoiceOrBillRows", { value1: group.paymentTransactionId }),
      );
    }
    const allocatedTotal = group.allocations.reduce(
      (total, allocation) => total + allocation.allocatedAmount,
      0,
    );
    const settlementAmount = Number(
      rowValue(transaction, "settlementAmount", "settlement_amount"),
    );
    if (
      !Number.isFinite(settlementAmount) ||
      Math.abs(settlementAmount - allocatedTotal) > 0.000_001
    ) {
      throw new Error(
        i18n.t("accounting.historicalPaymentImport.historicalPaymentTransactionSettlementMustEqualThePaidToDateTotal", { value1: group.paymentTransactionId, value2: allocatedTotal }),
      );
    }
  }
}

/**
 * Bind source document references to the moves created by the parent import.
 * The resulting keys remain stable across a safe import retry.
 */
export function buildHistoricalPaymentReplayBatches(args: {
  groups: readonly HistoricalPaymentReplayGroup[];
  moveIdByReference: ReadonlyMap<string, string>;
  companyId: bigint;
  bundleToken: string;
}): HistoricalPaymentReplayBatch[] {
  return args.groups.map((group) => ({
    idempotencyKey: `accounting-history:${args.bundleToken}:${group.paymentTransactionId}`,
    companyId: args.companyId,
    paymentTransactionId: BigInt(group.paymentTransactionId),
    currencyId: BigInt(group.currencyId),
    allocations: group.allocations.map((allocation) => {
      const moveId = args.moveIdByReference.get(allocation.documentReference);
      if (!moveId) {
        throw new Error(
          i18n.t("accounting.historicalPaymentImport.importedDocumentCouldNotBeResolvedForHistoricalPaymentReplay", { value1: allocation.documentReference }),
        );
      }
      return {
        documentMoveId: BigInt(moveId),
        allocatedAmount: allocation.allocatedAmount,
        expectedResidualAfter: allocation.expectedResidualAfter,
        completesDocumentHistory: allocation.completesDocumentHistory,
      };
    }),
    metadata: JSON.stringify({
      source: "accounting-original-total-import",
      bundle_token: args.bundleToken,
    }),
  }));
}
