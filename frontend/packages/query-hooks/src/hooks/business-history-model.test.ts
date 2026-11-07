import assert from "node:assert/strict";
import test from "node:test";
import {
  businessHistoryActivityQueryKey, businessHistoryActivityQueryPath,
  businessHistoryQueryKey, businessHistoryQueryPath, businessHistoryScopeReady,
  mergeBusinessHistoryPages, parseBusinessHistoryActivityPage, parseBusinessHistoryPage,
  parseBusinessHistorySourcesPage, validBusinessHistoryEventId, type BusinessHistoryScope,
} from "./business-history-model";

const scope: BusinessHistoryScope = { organizationId: 7, companyId: "11", resource: "sale_order",
  recordId: "18446744073709551615", actorIdentity: "ab".repeat(32), authorizationKey: "policy-1" };
const entry = { id: "19", operation: "update_sales_order", actorIdentity: "cd".repeat(32),
  occurredAt: "2026-11-05T12:30:00.123456Z", changedResource: "sale-orders",
  changedRecordId: "9007199254740993", changes: [{ field: "name", before: null, after: "<b>Exact</b>" }] };
const page = () => ({ schemaVersion: 1, resource: scope.resource, recordId: scope.recordId,
  companyId: scope.companyId, data: [structuredClone(entry)], nextCursor: null,
  coverage: { status: "partial", operations: [], message: "Only captured operations are available." } });
const source = () => ({ id: "15", kind: "import", jobId: "9007199254740993", rowNumber: 2,
  tableName: "sale_order", status: "success", importedAt: "2026-11-05T12:30:00Z",
  fileName: "<script>source.csv", contentSha256: "ab".repeat(32), verification: "tracked-import", review: null });

test("record and activity requests bind current authority and preserve exact identities", () => {
  const url = new URL(businessHistoryQueryPath(scope, "opaque+/cursor"), "https://example.test");
  assert.equal(url.pathname, `/api/history/records/sale_order/${scope.recordId}`);
  assert.equal(url.searchParams.get("cursor"), "opaque+/cursor");
  assert.equal(url.searchParams.has("organizationId"), false);
  assert.match(businessHistoryQueryPath(scope, null, "sources"), /\/sources\?/);
  for (const changed of [{ companyId: "12" }, { organizationId: 8 }, { resource: "contact" },
    { recordId: "20" }, { actorIdentity: "ef".repeat(32) }, { authorizationKey: "policy-2" }]) {
    assert.notDeepEqual(businessHistoryQueryKey(scope), businessHistoryQueryKey({ ...scope, ...changed }));
  }
  assert.notDeepEqual(businessHistoryQueryKey(scope), businessHistoryQueryKey(scope, "sources"));
  assert.equal(businessHistoryScopeReady({ ...scope, resource: "sale_order/../../../secret" }), false);
  assert.equal(businessHistoryScopeReady({ ...scope, companyId: "0" }), false);
  const activity = { ...scope, module: "sales" };
  assert.match(businessHistoryActivityQueryPath(activity, null), /^\/api\/history\/activity\/sales\?/);
  assert.notDeepEqual(businessHistoryActivityQueryKey(activity), businessHistoryActivityQueryKey({ ...activity, module: "crm" }));
});

test("generic history accepts distinct company and organization evidence with exact values", () => {
  const value = { ...page(), data: [entry, { ...entry, id: "org:18446744073709551615", changes: [] }] };
  const result = parseBusinessHistoryPage(value, scope);
  assert.equal(result.recordId, scope.recordId);
  assert.equal(result.data[0]?.changedRecordId, "9007199254740993");
  assert.equal(result.data[0]?.changes[0]?.after, "<b>Exact</b>");
  assert.equal(result.data[1]?.id, "org:18446744073709551615");
  for (const invalid of ["org:0", "org:01", "org:18446744073709551616", "01", 123, "other:1"])
    assert.equal(validBusinessHistoryEventId(invalid), false);
});

test("legacy record names share canonical request, cache and response identities", () => {
  for (const [alias, canonical] of [["hr_expense_sheet", "expense_sheet"], ["document_folder", "doc_folder"], ["knowledge_article_category", "kb_category"]]) {
    const aliasScope = { ...scope, resource: alias! };
    const canonicalScope = { ...scope, resource: canonical! };
    assert.match(businessHistoryQueryPath(aliasScope, null), new RegExp(`/records/${canonical}/`));
    assert.deepEqual(businessHistoryQueryKey(aliasScope), businessHistoryQueryKey(canonicalScope));
    assert.equal(parseBusinessHistoryPage({ ...page(), resource: canonical }, aliasScope).resource, canonical);
    const sources = parseBusinessHistorySourcesPage({ ...page(), resource: canonical, data: [{ ...source(), tableName: canonical }] }, aliasScope);
    assert.equal(sources.data[0]?.tableName, canonical);
  }
});

test("foreign scope, malformed comparison values and duplicate identities fail closed", () => {
  const invalid = [{ ...page(), resource: "contact" }, { ...page(), companyId: "9" },
    { ...page(), recordId: "3" }, { ...page(), coverage: { status: "complete", message: "All" } },
    { ...page(), data: [entry, entry] },
    { ...page(), data: [{ ...entry, actorIdentity: "unknown" }] },
    { ...page(), data: [{ ...entry, occurredAt: "yesterday" }] },
    { ...page(), data: [{ ...entry, changes: [{ field: "name", before: 0, after: 1 }] }] },
    { ...page(), data: [{ ...entry, changes: [{ field: "name", before: "same", after: "same" }] }] },
    { ...page(), data: [{ ...entry, changes: [entry.changes[0], entry.changes[0]] }] }];
  for (const value of invalid) assert.throws(() => parseBusinessHistoryPage(value, scope));
  const parsed = parseBusinessHistoryPage({ ...page(), data: [{ ...entry, metadata: "never pass through" }] }, scope);
  assert.equal("metadata" in parsed.data[0]!, false);
});

test("sparse pages retain continuation and conflicting immutable repeats are rejected", () => {
  const empty = parseBusinessHistoryPage({ ...page(), data: [], nextCursor: "more" }, scope);
  assert.equal(empty.nextCursor, "more");
  const parsed = parseBusinessHistoryPage(page(), scope);
  assert.equal(mergeBusinessHistoryPages([parsed, parsed]).length, 1);
  const conflicting = parseBusinessHistoryPage({ ...page(), data: [{ ...entry, operation: "different" }] }, scope);
  assert.throws(() => mergeBusinessHistoryPages([parsed, conflicting]), /Conflicting/);
});

test("activity retains exact primary source links without assuming child identity equals parent", () => {
  const activityScope = { ...scope, module: "sales" };
  const activityPage = { ...page(), module: "sales", data: [{ ...entry, resource: "sale_order", recordId: "20" }] };
  const result = parseBusinessHistoryActivityPage(activityPage, activityScope);
  assert.equal(result.data[0]?.recordId, "20");
  assert.equal(result.data[0]?.changedRecordId, "9007199254740993");
  assert.throws(() => parseBusinessHistoryActivityPage({ ...activityPage, module: "crm" }, activityScope));
  assert.throws(() => parseBusinessHistoryActivityPage({ ...activityPage, data: [{ ...entry, resource: "sale_order", recordId: 20 }] }, activityScope));
});

test("import mappings do not invent original rows or review decisions", () => {
  const result = parseBusinessHistorySourcesPage({ ...page(), data: [source()] }, scope);
  assert.equal(result.data[0]?.rowNumber, 2);
  assert.equal(result.data[0]?.jobId, "9007199254740993");
  assert.equal(result.data[0]?.review, null);
  assert.equal(result.data[0]?.sourceSha256, null);
  assert.equal(result.data[0]?.fileName, "<script>source.csv");
  for (const changed of [{ rowNumber: 0 }, { tableName: "contact" }, { review: { revision: 2 } },
    { contentSha256: "not a hash" }, { verification: "claimed" }]) {
    assert.throws(() => parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), ...changed }] }, scope));
  }
  const admitted = parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), sourceAdmissionId: "ab".repeat(16), sourceSha256: "cd".repeat(32), sourceRelationship: "user_prepared_derivative" }] }, scope);
  assert.equal(admitted.data[0]?.sourceRelationship, "user_prepared_derivative");
  assert.throws(() => parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), sourceRelationship: "user_prepared_derivative" }] }, scope));
  const reviewed = parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), review: { batchId: "24", itemId: "9007199254740993", revision: 3 } }] }, scope);
  assert.deepEqual(reviewed.data[0]?.review, { batchId: "24", itemId: "9007199254740993", revision: 3 });
  const workflow = { batchId: "24", itemId: "9007199254740993", revision: 3, taskRequestId: "a".repeat(32), proposalId: "100", proposalDigest: "b".repeat(64), source: { file: "original.csv", row: 7, sha256: "c".repeat(64) }, role: "journal_header" };
  const linked = parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), review: workflow }] }, scope);
  assert.equal(linked.data[0]?.review?.taskRequestId, workflow.taskRequestId);
  assert.equal(linked.data[0]?.review?.source?.row, 7);
  for (const invalid of [{ ...workflow, proposalDigest: undefined }, { ...workflow, source: { ...workflow.source, row: 0 } }, { ...workflow, taskRequestId: "https://example.test" }])
    assert.throws(() => parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), review: invalid }] }, scope));
  for (const review of [{ batchId: "24", itemId: "700", revision: 0 }, { batchId: 24, itemId: "700", revision: 3 }])
    assert.throws(() => parseBusinessHistorySourcesPage({ ...page(), data: [{ ...source(), review }] }, scope));
});
