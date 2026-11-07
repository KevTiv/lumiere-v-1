import { validHistoryId, type BusinessChangeField } from "./account-move-history-model";

/** Current read authority is part of every cache identity; historical access is never reused. */
export interface BusinessHistoryScope {
  organizationId: number;
  companyId: string;
  resource: string;
  recordId: string;
  actorIdentity: string;
  authorizationKey: string;
}

export interface BusinessHistoryEntry {
  id: string;
  operation: string;
  actorIdentity: string;
  occurredAt: string;
  changedResource: string;
  changedRecordId: string;
  changes: BusinessChangeField[];
}

export interface BusinessHistoryCoverage {
  status: "partial";
  message: string;
  operations?: string[];
}

export interface BusinessHistoryPage {
  schemaVersion: 1;
  resource: string;
  recordId: string;
  companyId: string;
  data: BusinessHistoryEntry[];
  nextCursor: string | null;
  coverage: BusinessHistoryCoverage;
}

export interface BusinessHistoryActivityScope extends Omit<BusinessHistoryScope, "resource" | "recordId"> {
  module: string;
}

export interface BusinessHistoryActivityEntry extends BusinessHistoryEntry {
  resource: string;
  recordId: string;
}

export interface BusinessHistoryActivityPage {
  schemaVersion: 1;
  module: string;
  companyId: string;
  data: BusinessHistoryActivityEntry[];
  nextCursor: string | null;
  coverage: BusinessHistoryCoverage;
}

export interface BusinessHistorySource {
  id: string;
  kind: "import";
  jobId: string;
  rowNumber: number;
  tableName: string;
  status: string;
  importedAt: string;
  fileName: string | null;
  contentSha256: string | null;
  sourceAdmissionId: string | null;
  sourceSha256: string | null;
  sourceRelationship: "user_prepared_derivative" | null;
  verification: "tracked-import";
  review: { batchId: string; itemId: string; revision: number } | null;
}

export interface BusinessHistorySourcesPage extends Omit<BusinessHistoryPage, "data"> {
  data: BusinessHistorySource[];
}

interface WireEnvelope {
  schemaVersion?: unknown; resource?: unknown; recordId?: unknown; companyId?: unknown;
  module?: unknown; data?: unknown; nextCursor?: unknown; coverage?: unknown;
}
interface WireCoverage { status?: unknown; message?: unknown; operations?: unknown }
interface WireEntry {
  id?: unknown; operation?: unknown; actorIdentity?: unknown; occurredAt?: unknown;
  changedResource?: unknown; changedRecordId?: unknown; changes?: unknown;
  resource?: unknown; recordId?: unknown;
}
interface WireDelta { field?: unknown; before?: unknown; after?: unknown }
interface WireReview { batchId?: unknown; itemId?: unknown; revision?: unknown }
interface WireSource {
  id?: unknown; kind?: unknown; jobId?: unknown; rowNumber?: unknown; tableName?: unknown;
  status?: unknown; importedAt?: unknown; fileName?: unknown; contentSha256?: unknown;
  sourceAdmissionId?: unknown; sourceSha256?: unknown; sourceRelationship?: unknown;
  verification?: unknown; review?: unknown;
}
const identityPattern = /^[0-9a-f]{64}$/i;
const tablePattern = /^[a-z][a-z0-9_]{0,95}$/;
const resourcePattern = /^[a-z][a-z0-9_-]{0,95}$/;
const fieldPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,95}$/;

export function validBusinessHistoryEventId(value: unknown): value is string {
  return validHistoryId(value) || (typeof value === "string" && value.startsWith("org:") && validHistoryId(value.slice(4)));
}

/** Older record hosts retain these table names; the history owner returns canonical names. */
export function canonicalBusinessHistoryResource(resource: string): string {
  if (resource === "hr_expense_sheet") return "expense_sheet";
  if (resource === "document_folder") return "doc_folder";
  if (resource === "knowledge_article_category") return "kb_category";
  return resource;
}

function object(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function wireEnvelope(value: unknown): value is WireEnvelope { return object(value); }
function wireCoverage(value: unknown): value is WireCoverage { return object(value); }
function wireEntry(value: unknown): value is WireEntry { return object(value); }
function wireDelta(value: unknown): value is WireDelta { return object(value); }
function wireSource(value: unknown): value is WireSource { return object(value); }
function wireReview(value: unknown): value is WireReview { return object(value); }
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function scalar(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 65_536);
}
function timestamp(value: unknown): value is string {
  return text(value, 64) && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export function businessHistoryScopeReady(scope: BusinessHistoryScope): boolean {
  return Number.isSafeInteger(scope.organizationId) && scope.organizationId > 0
    && validHistoryId(scope.companyId) && validHistoryId(scope.recordId)
    && tablePattern.test(scope.resource) && identityPattern.test(scope.actorIdentity);
}

export function businessHistoryQueryKey(scope: BusinessHistoryScope, kind: "changes" | "sources" = "changes") {
  return ["business-history", kind, String(scope.organizationId), scope.companyId,
    canonicalBusinessHistoryResource(scope.resource), scope.recordId, scope.actorIdentity, scope.authorizationKey] as const;
}

export function businessHistoryQueryPath(scope: BusinessHistoryScope, cursor: string | null, kind: "changes" | "sources" = "changes") {
  if (!businessHistoryScopeReady(scope)) throw new Error("Invalid business history scope");
  const params = new URLSearchParams({ companyId: scope.companyId, limit: "25" });
  if (cursor !== null) params.set("cursor", cursor);
  return `/api/history/records/${canonicalBusinessHistoryResource(scope.resource)}/${scope.recordId}${kind === "sources" ? "/sources" : ""}?${params}`;
}

function parseEnvelope(value: unknown, scope: BusinessHistoryScope) {
  const resource = canonicalBusinessHistoryResource(scope.resource);
  if (!wireEnvelope(value) || value.schemaVersion !== 1 || value.resource !== resource
    || value.recordId !== scope.recordId || value.companyId !== scope.companyId
    || !Array.isArray(value.data) || value.data.length > 50
    || !(value.nextCursor === null || text(value.nextCursor, 4096))
    || !wireCoverage(value.coverage) || value.coverage.status !== "partial"
    || !text(value.coverage.message, 4096)
    || (value.coverage.operations !== undefined && (!Array.isArray(value.coverage.operations)
      || value.coverage.operations.length > 1024
      || value.coverage.operations.some((operation) => !text(operation, 160))
      || new Set(value.coverage.operations).size !== value.coverage.operations.length))) {
    throw new Error("Invalid or out-of-scope business history response");
  }
  return {
    schemaVersion: 1 as const, resource, recordId: scope.recordId,
    companyId: scope.companyId, data: value.data, nextCursor: value.nextCursor,
    coverage: { status: "partial" as const, message: value.coverage.message,
      ...(Array.isArray(value.coverage.operations) ? { operations: value.coverage.operations as string[] } : {}) },
  };
}

function parseEntry(value: unknown): BusinessHistoryEntry {
  if (!wireEntry(value) || !validBusinessHistoryEventId(value.id) || !text(value.operation, 160)
    || !text(value.actorIdentity, 64) || !identityPattern.test(value.actorIdentity)
    || !timestamp(value.occurredAt) || !text(value.changedResource, 96)
    || !resourcePattern.test(value.changedResource) || !validHistoryId(value.changedRecordId)
    || !Array.isArray(value.changes) || value.changes.length > 64) {
    throw new Error("Invalid business history entry");
  }
  const fields = new Set<string>();
  const changes = value.changes.map((change): BusinessChangeField => {
    if (!wireDelta(change) || !text(change.field, 96) || !fieldPattern.test(change.field)
      || fields.has(change.field) || !scalar(change.before) || !scalar(change.after)
      || change.before === change.after) throw new Error("Invalid business history comparison");
    fields.add(change.field);
    return { field: change.field, before: change.before, after: change.after };
  });
  return { id: value.id, operation: value.operation, actorIdentity: value.actorIdentity,
    occurredAt: value.occurredAt, changedResource: value.changedResource,
    changedRecordId: value.changedRecordId, changes };
}

export function parseBusinessHistoryPage(value: unknown, scope: BusinessHistoryScope): BusinessHistoryPage {
  const page = parseEnvelope(value, scope);
  const data = page.data.map(parseEntry);
  if (new Set(data.map((entry) => entry.id)).size !== data.length) throw new Error("Duplicate business history identity");
  return { ...page, data };
}

export function businessHistoryActivityScopeReady(scope: BusinessHistoryActivityScope): boolean {
  return Number.isSafeInteger(scope.organizationId) && scope.organizationId > 0
    && validHistoryId(scope.companyId) && resourcePattern.test(scope.module)
    && identityPattern.test(scope.actorIdentity);
}

export function businessHistoryActivityQueryKey(scope: BusinessHistoryActivityScope) {
  return ["business-history", "activity", String(scope.organizationId), scope.companyId,
    scope.module, scope.actorIdentity, scope.authorizationKey] as const;
}

export function businessHistoryActivityQueryPath(scope: BusinessHistoryActivityScope, cursor: string | null) {
  if (!businessHistoryActivityScopeReady(scope)) throw new Error("Invalid activity scope");
  const params = new URLSearchParams({ companyId: scope.companyId, limit: "25" });
  if (cursor !== null) params.set("cursor", cursor);
  return `/api/history/activity/${scope.module}?${params}`;
}

export function parseBusinessHistoryActivityPage(value: unknown, scope: BusinessHistoryActivityScope): BusinessHistoryActivityPage {
  if (!wireEnvelope(value) || value.module !== scope.module) throw new Error("Invalid activity module");
  // The common envelope validates bounds, authority and coverage. The synthetic
  // record identity is local validation context and never enters an API request.
  const page = parseEnvelope({ ...value, resource: "activity", recordId: "1" },
    { ...scope, resource: "activity", recordId: "1" });
  const data = page.data.map((item): BusinessHistoryActivityEntry => {
    const entry = parseEntry(item);
    if (!wireEntry(item) || !text(item.resource, 96) || !tablePattern.test(item.resource)
      || !validHistoryId(item.recordId)) throw new Error("Invalid activity source record");
    return { ...entry, resource: item.resource, recordId: item.recordId };
  });
  if (new Set(data.map((entry) => entry.id)).size !== data.length) throw new Error("Duplicate activity identity");
  return { schemaVersion: 1, module: scope.module, companyId: page.companyId,
    nextCursor: page.nextCursor, coverage: page.coverage, data };
}

export function parseBusinessHistorySourcesPage(value: unknown, scope: BusinessHistoryScope): BusinessHistorySourcesPage {
  const page = parseEnvelope(value, scope);
  const data = page.data.map((source): BusinessHistorySource => {
    if (!wireSource(source) || !validHistoryId(source.id) || source.kind !== "import"
      || !validHistoryId(source.jobId) || !Number.isSafeInteger(source.rowNumber)
      || Number(source.rowNumber) < 1 || source.tableName !== page.resource
      || !text(source.status, 64) || !timestamp(source.importedAt)
      || !(source.fileName === null || (typeof source.fileName === "string" && source.fileName.length <= 1024))
      || !(source.contentSha256 === null || (typeof source.contentSha256 === "string" && /^[0-9a-f]{64}$/.test(source.contentSha256)))
      || !(source.sourceAdmissionId == null || (typeof source.sourceAdmissionId === "string" && /^[0-9a-f]{32}$/.test(source.sourceAdmissionId)))
      || !(source.sourceSha256 == null || (typeof source.sourceSha256 === "string" && /^[0-9a-f]{64}$/.test(source.sourceSha256)))
      || !(source.sourceRelationship == null || source.sourceRelationship === "user_prepared_derivative")
      || (source.sourceRelationship === "user_prepared_derivative" && (!source.sourceAdmissionId || !source.sourceSha256))
      || source.verification !== "tracked-import"
      || !(source.review === null || (wireReview(source.review) && validHistoryId(source.review.batchId)
        && validHistoryId(source.review.itemId) && typeof source.review.revision === "number"
        && Number.isSafeInteger(source.review.revision) && source.review.revision > 0 && source.review.revision <= 2_147_483_647))) {
      throw new Error("Invalid business history source");
    }
    return { id: source.id, kind: "import", jobId: source.jobId, rowNumber: source.rowNumber as number,
      tableName: source.tableName, status: source.status, importedAt: source.importedAt,
      fileName: source.fileName, contentSha256: source.contentSha256,
      sourceAdmissionId: typeof source.sourceAdmissionId === "string" ? source.sourceAdmissionId : null,
      sourceSha256: typeof source.sourceSha256 === "string" ? source.sourceSha256 : null,
      sourceRelationship: source.sourceRelationship === "user_prepared_derivative" ? source.sourceRelationship : null,
      verification: "tracked-import", review: source.review === null ? null : {
        batchId: source.review.batchId as string, itemId: source.review.itemId as string, revision: source.review.revision as number,
      } };
  });
  if (new Set(data.map((entry) => entry.id)).size !== data.length) throw new Error("Duplicate source identity");
  return { ...page, data };
}

/** Repeated immutable identities must agree, including across sparse pages. */
export function mergeBusinessHistoryPages<T extends { id: string }>(pages: readonly { data: T[] }[]): T[] {
  const entries = new Map<string, T>();
  for (const page of pages) for (const entry of page.data) {
    const previous = entries.get(entry.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error("Conflicting business history identity");
    entries.set(entry.id, entry);
  }
  return [...entries.values()];
}
