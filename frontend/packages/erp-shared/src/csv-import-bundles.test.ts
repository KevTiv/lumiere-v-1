import assert from "node:assert/strict"
import test from "node:test"

import {
  ACCOUNT_MOVE_BUNDLE_COLUMNS,
  ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS,
  ACCOUNT_MOVE_IMPORT_BUNDLE,
  ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS,
  accountMoveBundleMappings,
  accountMoveBundleToken,
  accountMoveReference,
  assertAccountMoveReferencesAvailable,
  buildAccountMoveLineCsv,
  buildBundleLineCsv,
  buildBundleParentCsv,
  buildMoveIdMapFromAccountMoves,
  buildNewMoveIdMapFromAccountMoves,
  buildOrderIdMapFromSaleOrders,
  detectParentLinkSourceColumn,
  ImportBundleValidationError,
  importBundleForParentEntity,
  markAccountMoveBundleParentCsv,
  markAccountMoveBundleLineCsv,
  SALE_ORDER_IMPORT_BUNDLE,
  splitAccountMoveImportCsv,
  splitImportBundleCsv,
} from "./csv-import-bundles"
import { parseCsvText } from "./csv-import-safety"

test("splitImportBundleCsv deduplicates parent rows and keeps line rows", () => {
  const headers = ["Order Ref", "Customer", "Product", "Qty"]
  const rows = [
    ["SO-1", "100", "200", "2"],
    ["SO-1", "100", "201", "1"],
    ["SO-2", "101", "200", "3"],
  ]
  const parentMapping = {
    "Order Ref": "client_order_ref",
    Customer: "partner_id",
  }
  const lineMapping = {
    Product: "product_id",
    Qty: "product_uom_qty",
  }

  const split = splitImportBundleCsv({
    headers,
    rows,
    parentMapping,
    lineMapping,
    parentLinkSourceColumn: "Order Ref",
  })

  assert.equal(split.parentRows.length, 2)
  assert.equal(split.lineRows.length, 3)
  assert.deepEqual(split.parentLinkValues, ["SO-1", "SO-2"])
})

test("buildBundleParentCsv emits canonical headers", () => {
  const csv = buildBundleParentCsv(
    ["Order Ref", "Customer"],
    [["SO-1", "100"]],
    { "Order Ref": "client_order_ref", Customer: "partner_id" },
  )
  assert.match(csv, /client_order_ref,partner_id/)
  assert.match(csv, /SO-1,100/)
})

test("buildBundleLineCsv resolves order ids from parent refs", () => {
  const headers = ["Product", "Qty"]
  const lineRows = [
    ["200", "2", "SO-1"],
    ["201", "1", "SO-1"],
  ]
  const orderIdByRef = new Map([["SO-1", "42"]])
  const csv = buildBundleLineCsv(
    headers,
    lineRows,
    { Product: "product_id", Qty: "product_uom_qty" },
    orderIdByRef,
    SALE_ORDER_IMPORT_BUNDLE,
  )
  assert.match(csv, /order_id,product_id,product_uom_qty/)
  assert.match(csv, /42,200,2/)
})

test("buildOrderIdMapFromSaleOrders maps refs to ids", () => {
  const map = buildOrderIdMapFromSaleOrders(
    [
      { id: 10, client_order_ref: "SO-1" },
      { id: 11, clientOrderRef: "SO-2" },
    ],
    ["SO-1", "SO-2", "SO-3"],
  )
  assert.equal(map.get("SO-1"), "10")
  assert.equal(map.get("SO-2"), "11")
  assert.equal(map.has("SO-3"), false)
})

test("detectParentLinkSourceColumn prefers mapped client_order_ref", () => {
  const column = detectParentLinkSourceColumn(
    ["Reference", "SKU"],
    { Reference: "client_order_ref" },
    SALE_ORDER_IMPORT_BUNDLE,
  )
  assert.equal(column, "Reference")
})

test("account move bundle uses a human reference and generated move id", () => {
  assert.ok(ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS.includes("date"))
  assert.equal(ACCOUNT_MOVE_IMPORT_BUNDLE.parentLinkField, "ref_")
  assert.equal(ACCOUNT_MOVE_IMPORT_BUNDLE.lineOrderIdField, "move_id")
  assert.equal(
    importBundleForParentEntity("account_move"),
    ACCOUNT_MOVE_IMPORT_BUNDLE,
  )
  assert.equal(
    detectParentLinkSourceColumn(
      ["Invoice Number", "Journal"],
      {},
      ACCOUNT_MOVE_IMPORT_BUNDLE,
    ),
    "Invoice Number",
  )
})

test("account move bundle template has unique disjoint headers", () => {
  const headers = [
    ...ACCOUNT_MOVE_BUNDLE_COLUMNS.required,
    ...ACCOUNT_MOVE_BUNDLE_COLUMNS.optional,
  ]
  assert.equal(new Set(headers).size, headers.length)
  assert.deepEqual(
    ACCOUNT_MOVE_BUNDLE_COLUMNS.optional.filter((field) =>
      ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS.includes(
        field as (typeof ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS)[number],
      ),
    ),
    [],
  )
  assert.ok(headers.includes(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveName))
  assert.ok(headers.includes(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineName))
  assert.equal((headers as readonly string[]).includes("name"), false)
})

test("account move bundle maps distinct move and line names to canonical CSVs", () => {
  const headers = [
    "journal_id",
    "ref_",
    "date",
    "account_id",
    "debit",
    "credit",
    "move_name",
    "line_name",
  ]
  const rows = [
    ["7", "OPEN-001", "2026-01-01", "1100", "100", "", "Opening", "Cash"],
    ["7", "OPEN-001", "2026-01-01", "3000", "", "100", "Opening", "Equity"],
  ]
  const { parentMapping, lineMapping } = accountMoveBundleMappings(headers)
  const split = splitAccountMoveImportCsv({
    headers,
    rows,
    parentMapping,
    lineMapping,
    parentLinkSourceColumn: "ref_",
  })

  assert.equal(parentMapping.move_name, "name")
  assert.equal(lineMapping.line_name, "name")
  assert.equal(parentMapping.line_name, undefined)
  assert.equal(lineMapping.move_name, undefined)
  assert.match(
    buildBundleParentCsv(split.parentHeaders, split.parentRows, parentMapping),
    /name[^\n]*\n[^\n]*Opening/,
  )
  const lineCsv = buildAccountMoveLineCsv(
    headers,
    split.lineRows,
    lineMapping,
    new Map([["OPEN-001", "41"]]),
  )
  assert.match(lineCsv, /name/)
  assert.match(lineCsv, /Cash/)
  assert.match(lineCsv, /Equity/)
})

test("account move bundle marker preserves object and raw user metadata", () => {
  const objectMarked = parseCsvText(
    markAccountMoveBundleParentCsv(
      'journal_id,metadata,ref_\n7,"{""source"":""legacy""}",OPEN-1',
    ),
  )
  const objectMetadata = JSON.parse(objectMarked.rows[0][1])
  assert.equal(objectMetadata.source, "legacy")
  assert.equal(objectMetadata.extra.lumiere_account_move_bundle.version, 1)
  assert.equal(typeof objectMetadata.extra.lumiere_account_move_bundle.token, "string")
  assert.match(objectMetadata.extra.lumiere_account_move_bundle.fingerprint, /^v1-/)

  const rawMarked = parseCsvText(
    markAccountMoveBundleParentCsv("journal_id,metadata,ref_\n7,legacy note,OPEN-2"),
  )
  const rawMetadata = JSON.parse(rawMarked.rows[0][1])
  assert.equal(rawMetadata.lumiere_preserved_user_metadata, "legacy note")
  assert.equal(rawMetadata.extra.lumiere_account_move_bundle.version, 1)
})

test("account move bundle marker preserves a non-object extra value", () => {
  const marked = parseCsvText(
    markAccountMoveBundleParentCsv(
      'journal_id,metadata,ref_\n7,"{""extra"":""legacy-extra""}",OPEN-3',
    ),
  )
  const metadata = JSON.parse(marked.rows[0][1])
  const marker = metadata.extra.lumiere_account_move_bundle
  assert.equal(marker.version, 1)
  assert.equal(marker.original_extra_present, true)
  assert.equal(marker.original_extra, "legacy-extra")
})

test("account move bundle marker snapshots object and array extra without changing it", () => {
  for (const extra of [{ region: "rw", nested: { code: 7 } }, ["a", { b: 2 }], null]) {
    const source = JSON.stringify({ source: "legacy", extra })
    const csv = `journal_id,metadata,ref_\n7,"${source.replaceAll('"', '""')}",OPEN-X`
    const marked = parseCsvText(markAccountMoveBundleParentCsv(csv))
    const metadata = JSON.parse(marked.rows[0][1])
    const marker = metadata.extra.lumiere_account_move_bundle
    assert.equal(marker.original_extra_present, true)
    assert.deepEqual(marker.original_extra, extra)
  }
})

test("account move bundle rejects user metadata containing the reserved marker key", () => {
  const source = JSON.stringify({
    extra: { lumiere_account_move_bundle: { user: "value" } },
  })
  const csv = `journal_id,metadata,ref_\n7,"${source.replaceAll('"', '""')}",OPEN-X`
  assert.throws(
    () => markAccountMoveBundleParentCsv(csv),
    /is reserved for journal bundle imports/,
  )
})

test("account move line marker carries the matching request token", () => {
  const parentCsv = "journal_id,ref_\n7,OPEN-1"
  const token = accountMoveBundleToken(parentCsv)
  const marked = parseCsvText(
    markAccountMoveBundleLineCsv("account_id,move_id\n10,41", token),
  )
  const metadataIndex = marked.headers.indexOf("metadata")
  const metadata = JSON.parse(marked.rows[0][metadataIndex])
  assert.equal(metadata.extra.lumiere_account_move_bundle.token, token)
  assert.equal(metadata.extra.lumiere_account_move_bundle.fingerprint, undefined)
})

test("account move bundle marker is stable for an exact retry", () => {
  const csv = "journal_id,ref_\n7,OPEN-1"
  assert.equal(markAccountMoveBundleParentCsv(csv), markAccountMoveBundleParentCsv(csv))
})

test("account move reference prefers the route-shaped ref field", () => {
  assert.equal(
    accountMoveReference({ id: 1, ref: "ROUTE-REF", ref_: "RAW-REF" }),
    "ROUTE-REF",
  )
  assert.equal(accountMoveReference({ id: 2, ref_: "RAW-ONLY" }), "RAW-ONLY")
  assert.equal(accountMoveReference({ id: 3, ref: " ", ref_: "RAW-FALLBACK" }), "RAW-FALLBACK")
})

test("splitAccountMoveImportCsv deterministically deduplicates balanced parents", () => {
  const result = splitAccountMoveImportCsv({
    headers: ["Journal Ref", "Journal", "Account", "Debit", "Credit"],
    rows: [
      ["OPEN-001", "7", "1100", "100", ""],
      ["OPEN-001", "7", "3000", "", "100"],
      ["OPEN-002", "7", "1200", "50", ""],
      ["OPEN-002", "7", "4000", "", "50"],
    ],
    parentMapping: { "Journal Ref": "ref_", Journal: "journal_id" },
    lineMapping: { Account: "account_id", Debit: "debit", Credit: "credit" },
    parentLinkSourceColumn: "Journal Ref",
  })

  assert.deepEqual(result.parentLinkValues, ["OPEN-001", "OPEN-002"])
  assert.equal(result.parentRows.length, 2)
  assert.equal(result.lineRows.length, 4)
  assert.equal(result.reconciliation.valid, true)
  assert.equal(result.reconciliation.totalDebit, 150)
  assert.equal(result.reconciliation.totalCredit, 150)
})

test("strict accounting split reports missing and conflicting references", () => {
  assert.throws(
    () =>
      splitAccountMoveImportCsv({
        headers: ["Reference", "Journal", "Account", "Debit", "Credit"],
        rows: [
          ["MOVE-1", "7", "1100", "10", ""],
          ["MOVE-1", "8", "3000", "", "10"],
          ["", "7", "1100", "5", ""],
        ],
        parentMapping: { Reference: "ref_", Journal: "journal_id" },
        lineMapping: {
          Account: "account_id",
          Debit: "debit",
          Credit: "credit",
        },
        parentLinkSourceColumn: "Reference",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ImportBundleValidationError)
      assert.deepEqual(
        error.issues.map((issue) => issue.code),
        ["conflicting_parent_reference", "missing_parent_reference"],
      )
      return true
    },
  )
})

test("buildMoveIdMapFromAccountMoves requires exactly one move for every reference", () => {
  const map = buildMoveIdMapFromAccountMoves(
    [
      { id: 41, ref_: "MOVE-1" },
      { id: 42, ref: "MOVE-2" },
    ],
    ["MOVE-1", "MOVE-2"],
  )
  assert.deepEqual(
    [...map],
    [
      ["MOVE-1", "41"],
      ["MOVE-2", "42"],
    ],
  )

  assert.throws(
    () =>
      buildMoveIdMapFromAccountMoves(
        [
          { id: 41, ref_: "MOVE-1" },
          { id: 43, ref_: "MOVE-1" },
        ],
        ["MOVE-1", "MOVE-2"],
      ),
    (error: unknown) => {
      assert.ok(error instanceof ImportBundleValidationError)
      assert.deepEqual(
        error.issues.map((issue) => issue.code),
        [
          "duplicate_resolved_parent_reference",
          "missing_resolved_parent_reference",
        ],
      )
      return true
    },
  )
})

test("new move resolution rejects reused refs and ignores preflight ids", () => {
  const before = [{ id: 40, ref: "OLD" }, { id: 41, ref: "OTHER" }]
  assert.throws(
    () => assertAccountMoveReferencesAvailable(before, ["OLD"]),
    (error: unknown) => {
      assert.ok(error instanceof ImportBundleValidationError)
      assert.equal(error.issues[0]?.code, "existing_parent_reference")
      return true
    },
  )

  const resolved = buildNewMoveIdMapFromAccountMoves(
    before,
    [...before, { id: 42, ref: "NEW-1" }, { id: 43, ref_: "NEW-2" }],
    ["NEW-1", "NEW-2"],
  )
  assert.deepEqual([...resolved], [["NEW-1", "42"], ["NEW-2", "43"]])

  assert.throws(
    () =>
      buildNewMoveIdMapFromAccountMoves(
        before,
        [...before, { id: 42, ref: "NEW" }, { id: 43, ref: "NEW" }],
        ["NEW"],
      ),
    (error: unknown) => {
      assert.ok(error instanceof ImportBundleValidationError)
      assert.equal(error.issues[0]?.code, "duplicate_resolved_parent_reference")
      return true
    },
  )
})

test("buildAccountMoveLineCsv refuses to silently discard unresolved lines", () => {
  assert.throws(
    () =>
      buildAccountMoveLineCsv(
        ["Account", "Debit", "Credit"],
        [
          ["1100", "10", "", "MOVE-1"],
          ["3000", "", "10", "MOVE-2"],
        ],
        { Account: "account_id", Debit: "debit", Credit: "credit" },
        new Map([["MOVE-1", "41"]]),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ImportBundleValidationError)
      assert.equal(error.issues[0]?.code, "unresolved_parent_reference")
      assert.equal(error.issues[0]?.reference, "MOVE-2")
      return true
    },
  )
})

test("buildAccountMoveLineCsv links every line to the generated move id", () => {
  const csv = buildAccountMoveLineCsv(
    ["Account", "Debit", "Credit"],
    [
      ["1100", "10", "", "MOVE-1"],
      ["3000", "", "10", "MOVE-1"],
    ],
    { Account: "account_id", Debit: "debit", Credit: "credit" },
    new Map([["MOVE-1", "41"]]),
  )

  assert.equal(
    csv,
    ["account_id,credit,debit,move_id", "1100,,10,41", "3000,10,,41"].join(
      "\n",
    ),
  )
})
