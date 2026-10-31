import assert from "node:assert/strict";
import test from "node:test";
import {
  accountMoveHistoryQueryKey,
  accountMoveHistoryQueryPath,
  mergeAccountMoveHistoryPages,
  parseAccountMoveHistoryPage,
  validHistoryId,
  type AccountMoveHistoryScope,
} from "./account-move-history-model";

const scope: AccountMoveHistoryScope = {
  organizationId: 7,
  companyId: "11",
  recordId: "18446744073709551615",
  actorIdentity: "ab".repeat(32),
  authorizationKey: "policy-1",
};
const entry = {
  id: "19",
  operation: "update_account_move_line",
  actorIdentity: "cd".repeat(32),
  occurredAt: "2026-10-26T12:30:00.123456Z",
  changedResource: "account-move-lines",
  changedRecordId: "9007199254740993",
  changes: [{ field: "debit", before: "0", after: "123456789.01" }],
};
const page = () => ({
  schemaVersion: 1,
  recordId: scope.recordId,
  companyId: scope.companyId,
  data: [structuredClone(entry)],
  nextCursor: null,
  coverage: {
    status: "partial",
    operations: ["update_account_move_line"],
    message: "Only draft line edits are tracked.",
  },
});

test("history keeps exact u64 identities and decimal strings without numeric coercion", () => {
  const result = parseAccountMoveHistoryPage(page(), scope);
  assert.equal(result.recordId, "18446744073709551615");
  assert.equal(result.data[0]?.changedRecordId, "9007199254740993");
  assert.equal(result.data[0]?.changes[0]?.after, "123456789.01");
  for (const value of ["0", "-1", "1.0", "01", "18446744073709551616", 123])
    assert.equal(validHistoryId(value), false);
});

test("explicit line additions retain exact account/currency identity and require admitted creation semantics", () => {
  const addition = { ...entry, operation: "add_account_move_line", changes: [
    { field: "account_id", before: null, after: "18446744073709551615" },
    { field: "currency_id", before: null, after: "9007199254740993" },
    { field: "debit", before: null, after: "0" },
  ] };
  const value = { ...page(), data: [addition], coverage: { ...page().coverage, operations: ["update_account_move_line", "add_account_move_line"] } };
  const result = parseAccountMoveHistoryPage(value, scope);
  assert.equal(result.data[0]?.operation, "add_account_move_line");
  assert.equal(result.data[0]?.changes[0]?.after, "18446744073709551615");
  assert.throws(() => parseAccountMoveHistoryPage({ ...value, coverage: page().coverage }, scope));
  assert.throws(() => parseAccountMoveHistoryPage({ ...value, data: [{ ...addition, changes: [{ field: "debit", before: "0", after: "1" }] }] }, scope));
  assert.throws(() => parseAccountMoveHistoryPage({ ...value, coverage: { ...value.coverage, operations: ["add_account_move_line", "add_account_move_line"] } }, scope));
});

test("history reads and cache identities bind actor, organization, company, record and authorization", () => {
  const path = accountMoveHistoryQueryPath(scope, "opaque+/cursor");
  const url = new URL(path, "https://example.test");
  assert.equal(url.pathname, `/api/history/account-moves/${scope.recordId}`);
  assert.equal(url.searchParams.get("companyId"), "11");
  assert.equal(url.searchParams.get("cursor"), "opaque+/cursor");
  assert.equal(url.searchParams.has("organizationId"), false);
  for (const changed of [
    { organizationId: 8 },
    { companyId: "12" },
    { recordId: "24" },
    { actorIdentity: "ef".repeat(32) },
    { authorizationKey: "policy-2" },
  ])
    assert.notDeepEqual(
      accountMoveHistoryQueryKey(scope),
      accountMoveHistoryQueryKey({ ...scope, ...changed }),
    );
});

test("foreign scope, malformed values, missing coverage and untrusted metadata fail closed", () => {
  const invalid = [
    { ...page(), recordId: "12" },
    { ...page(), companyId: "8" },
    { ...page(), schemaVersion: 2 },
    { ...page(), coverage: { status: "complete", operations: [] } },
    {
      ...page(),
      data: [{ ...entry, changes: [{ field: "debit", before: 0, after: 1 }] }],
    },
    {
      ...page(),
      data: [
        {
          ...entry,
          changes: [{ field: "metadata", before: null, after: "private" }],
        },
      ],
    },
    {
      ...page(),
      data: [
        { ...entry, changes: [{ field: "debit", before: "1", after: "1" }] },
      ],
    },
    { ...page(), data: [{ ...entry, occurredAt: "not a timestamp" }] },
    { ...page(), data: [{ ...entry, actorIdentity: "not an identity" }] },
    { ...page(), data: [{ ...entry, changes: [] }] },
    { ...page(), data: [entry, entry] },
  ];
  for (const value of invalid)
    assert.throws(() => parseAccountMoveHistoryPage(value, scope));
});

test("empty sparse pages preserve continuation and don't claim a complete history", () => {
  const value = { ...page(), data: [], nextCursor: "continue" };
  const result = parseAccountMoveHistoryPage(value, scope);
  assert.deepEqual(result.data, []);
  assert.equal(result.nextCursor, "continue");
  assert.equal(result.coverage.status, "partial");
});

test("all native visible delta fields and valid larger source descriptions remain readable", () => {
  const fields = [
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
  ];
  const result = parseAccountMoveHistoryPage(
    {
      ...page(),
      data: [
        {
          ...entry,
          changes: fields.map((field) => ({
            field,
            before: "0",
            after: field === "name" ? "a".repeat(20_000) : "1",
          })),
        },
      ],
    },
    scope,
  );
  assert.equal(result.data[0]?.changes.length, fields.length);
  assert.equal(result.data[0]?.changes[0]?.after?.length, 20_000);
  assert.throws(() =>
    parseAccountMoveHistoryPage(
      {
        ...page(),
        data: [
          {
            ...entry,
            changes: [
              { field: "name", before: null, after: "a".repeat(65_537) },
            ],
          },
        ],
      },
      scope,
    ),
  );
});

test("wire extras are not passed to rendering and conflicting repeated evidence is rejected", () => {
  const result = parseAccountMoveHistoryPage(
    { ...page(), data: [{ ...entry, privateMetadata: "secret" }] },
    scope,
  );
  assert.equal("privateMetadata" in result.data[0]!, false);
  assert.equal(mergeAccountMoveHistoryPages([result, result]).length, 1);
  const conflict = parseAccountMoveHistoryPage(
    {
      ...page(),
      data: [
        { ...entry, changes: [{ field: "debit", before: "0", after: "2" }] },
      ],
    },
    scope,
  );
  assert.throws(
    () => mergeAccountMoveHistoryPages([result, conflict]),
    /Conflicting/,
  );
});
