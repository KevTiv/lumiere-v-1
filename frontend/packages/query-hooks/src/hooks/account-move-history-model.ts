/** Authorized, record-scoped history returned by the Finance history API. */
export interface AccountMoveHistoryScope {
  organizationId: number;
  companyId: string;
  recordId: string;
  actorIdentity: string;
  authorizationKey: string;
}

export interface BusinessChangeField {
  field: string;
  before: string | null;
  after: string | null;
}

export interface AccountMoveHistoryEntry {
  id: string;
  operation: AccountMoveHistoryOperation;
  actorIdentity: string;
  occurredAt: string;
  changedResource: "account-move-lines";
  changedRecordId: string;
  changes: BusinessChangeField[];
}

export type AccountMoveHistoryOperation = "update_account_move_line" | "add_account_move_line";
function historyOperation(value: unknown): value is AccountMoveHistoryOperation {
  return value === "update_account_move_line" || value === "add_account_move_line";
}

export interface AccountMoveHistoryPage {
  schemaVersion: 1;
  recordId: string;
  companyId: string;
  data: AccountMoveHistoryEntry[];
  nextCursor: string | null;
  coverage: {
    status: "partial";
    operations: AccountMoveHistoryOperation[];
    message: string;
  };
}

const maxU64 = 18_446_744_073_709_551_615n;
const identityPattern = /^[0-9a-f]{64}$/i;
const historyFields = new Set([
  "name",
  "debit",
  "credit",
  "balance",
  "amount_currency",
  "amount_residual",
  "amount_residual_currency",
  "debit_currency",
  "credit_currency",
  "partner_id",
  "analytic_account_id",
  "account_id",
  "currency_id",
]);

export function validHistoryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,19}$/.test(value) &&
    BigInt(value) <= maxU64
  );
}

export function accountMoveHistoryScopeReady(
  scope: AccountMoveHistoryScope,
): boolean {
  return (
    Number.isSafeInteger(scope.organizationId) &&
    scope.organizationId > 0 &&
    validHistoryId(scope.companyId) &&
    validHistoryId(scope.recordId) &&
    identityPattern.test(scope.actorIdentity)
  );
}

export function accountMoveHistoryQueryKey(scope: AccountMoveHistoryScope) {
  return [
    "account-move-history",
    String(scope.organizationId),
    scope.companyId,
    scope.recordId,
    scope.actorIdentity,
    scope.authorizationKey,
  ] as const;
}

export function accountMoveHistoryQueryPath(
  scope: AccountMoveHistoryScope,
  cursor: string | null,
) {
  if (!accountMoveHistoryScopeReady(scope))
    throw new Error("Invalid history scope");
  const params = new URLSearchParams({
    companyId: scope.companyId,
    limit: "25",
  });
  if (cursor != null) params.set("cursor", cursor);
  return `/api/history/account-moves/${scope.recordId}?${params}`;
}

type WireObject = { [key: string]: unknown };
function object(value: unknown): value is WireObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
function scalar(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && value.length <= 65_536)
  );
}

function parseEntry(value: unknown): AccountMoveHistoryEntry {
  if (
    !object(value) ||
    !validHistoryId(value.id) ||
    !historyOperation(value.operation) ||
    typeof value.actorIdentity !== "string" ||
    !identityPattern.test(value.actorIdentity) ||
    typeof value.occurredAt !== "string" ||
    value.occurredAt.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.occurredAt) ||
    !Number.isFinite(Date.parse(value.occurredAt)) ||
    value.changedResource !== "account-move-lines" ||
    !validHistoryId(value.changedRecordId) ||
    !Array.isArray(value.changes) ||
    value.changes.length === 0 ||
    value.changes.length > 32
  ) {
    throw new Error("Invalid history entry");
  }
  const fields = new Set<string>();
  const changes = value.changes.map((change): BusinessChangeField => {
    if (
      !object(change) ||
      typeof change.field !== "string" ||
      !historyFields.has(change.field) ||
      fields.has(change.field) ||
      !scalar(change.before) ||
      !scalar(change.after) ||
      change.before === change.after
      || (value.operation === "add_account_move_line" && change.before !== null)
    ) {
      throw new Error("Invalid history field");
    }
    fields.add(change.field);
    return { field: change.field, before: change.before, after: change.after };
  });
  return {
    id: value.id,
    operation: value.operation,
    actorIdentity: value.actorIdentity,
    occurredAt: value.occurredAt,
    changedResource: value.changedResource,
    changedRecordId: value.changedRecordId,
    changes,
  };
}

export function parseAccountMoveHistoryPage(
  value: unknown,
  scope: AccountMoveHistoryScope,
): AccountMoveHistoryPage {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.recordId !== scope.recordId ||
    value.companyId !== scope.companyId ||
    !Array.isArray(value.data) ||
    value.data.length > 50 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 4096)
    ) ||
    !object(value.coverage) ||
    value.coverage.status !== "partial" ||
    !Array.isArray(value.coverage.operations) ||
    value.coverage.operations.length < 1 ||
    value.coverage.operations.length > 2 ||
    value.coverage.operations.some((operation) => !historyOperation(operation)) ||
    new Set(value.coverage.operations).size !== value.coverage.operations.length ||
    typeof value.coverage.message !== "string" ||
    value.coverage.message.length > 2048
  ) {
    throw new Error("Invalid or out-of-scope history response");
  }
  const data = value.data.map(parseEntry);
  const operations = value.coverage.operations.map((operation): AccountMoveHistoryOperation => {
    if (!historyOperation(operation)) throw new Error("Invalid history coverage operation");
    return operation;
  });
  if (data.some((entry) => !operations.includes(entry.operation))) throw new Error("History entry is outside declared capture coverage");
  if (new Set(data.map((entry) => entry.id)).size !== data.length)
    throw new Error("Duplicate history identity");
  return {
    schemaVersion: 1,
    recordId: scope.recordId,
    companyId: scope.companyId,
    data,
    nextCursor: value.nextCursor,
    coverage: {
      status: "partial",
      operations,
      message: value.coverage.message,
    },
  };
}

export function mergeAccountMoveHistoryPages(
  pages: readonly AccountMoveHistoryPage[],
): AccountMoveHistoryEntry[] {
  const entries = new Map<string, AccountMoveHistoryEntry>();
  for (const page of pages) {
    for (const entry of page.data) {
      const previous = entries.get(entry.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
        throw new Error("Conflicting history identity");
      entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}
