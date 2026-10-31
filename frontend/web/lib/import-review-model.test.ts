import assert from "node:assert/strict"
import test from "node:test"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import {
  reviewArithmetic,
  reviewDatasetFromCsv,
  reviewedImportSource,
  type ReviewDetail,
  type ReviewRow,
} from "./import-review-model"

test("review arithmetic preserves totals without guessing a weight conversion", () => {
  assert.equal(reviewArithmetic({ quantity: "8", unit_price: "600" }), "4800")
  assert.equal(
    reviewArithmetic({ quantity: "0.008", unit_price: "600000" }),
    "4800",
  )
  assert.equal(reviewArithmetic({ quantity: "1", unit_price: "4800" }), "4800")
  assert.equal(reviewArithmetic({ quantity: "", unit_price: "4800" }), null)
  assert.equal(reviewArithmetic({ quantity: "NaN", unit_price: "4800" }), null)
})

test("a review copy retains bad and missing source cells without confirming them", async () => {
  const sourceRows = [["Sausage", "not known", "2024-02-30"]]
  const before = JSON.stringify(sourceRows)
  const result = await reviewDatasetFromCsv({
    title: "History",
    targetEntity: "product",
    fileName: "history.csv",
    csv: "name,cost,date\nSausage,not known,2024-02-30",
    headers: ["name", "cost", "date"],
    rows: sourceRows,
    mapping: { name: "name", cost: "cost_price", date: "date" },
    requiredFields: ["name", "cost_price"],
    issues: [],
  })
  assert.equal(result.items[0].fields[1].sourceValue, "not known")
  assert.equal(result.items[0].proposed.cost_price, null)
  assert.equal(result.items[0].proposed.date, null)
  assert.equal(result.items[0].source.row, 2)
  assert.match(result.items[0].source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(sourceRows), before)
})

test("only confirmed corrections enter the next import and a cleared value stays cleared", () => {
  const row: ReviewRow = {
    id: "42",
    source: {
      key: "sausage",
      label: "Sausage",
      source: { file: "shop.csv", row: 8, sha256: "a".repeat(64) },
      issue: "Weight unknown",
      fields: [
        {
          key: "name",
          label: "Name",
          kind: "text",
          sourceValue: "Sausage",
          required: true,
        },
        {
          key: "sale_price",
          label: "Price",
          kind: "decimal",
          sourceValue: "600",
          required: false,
        },
      ],
      proposed: { name: "Sausage", sale_price: "4800" },
    },
    values: { name: "Sausage", sale_price: null },
    state: "confirmed",
    revision: 2,
    reason: "Price removed pending source check",
    reviewedBy: "actor",
    reviewedAt: "2026-10-30",
  }
  const detail: ReviewDetail = {
    id: "1",
    title: "History",
    targetEntity: "source_observation",
    sourceFile: "shop.csv",
    items: [
      row,
      { ...row, id: "43", state: "needs_review" },
      { ...row, id: "44", state: "excluded" },
    ],
    history: [],
  }
  const result = parseCsvText(reviewedImportSource(detail).csv)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0][result.headers.indexOf("sale_price")], "")
  assert.equal(result.rows[0][result.headers.indexOf("_source_row")], "8")
  assert.equal(result.rows[0][result.headers.indexOf("_review_revision")], "2")
  assert.equal(row.source.fields[1].sourceValue, "600")
  assert.throws(
    () => reviewedImportSource({ ...detail, targetEntity: "product" }),
    /explicit sale price and cost price/,
  )
})

test("supported draft records retain exact source file, row, revision and decision evidence", () => {
  const row: ReviewRow = {
    id: "9007199254740993",
    source: {
      key: "farm-row",
      label: "Farm record",
      source: {
        file: "farm, sales.csv",
        row: 8,
        sha256: "b".repeat(64),
        rowBasis: "source_line",
      },
      issue: "Unit verified",
      fields: [
        {
          key: "name",
          label: "Name",
          kind: "text",
          sourceValue: "Farm record",
          required: true,
        },
        {
          key: "sale_price",
          label: "Sale price",
          kind: "decimal",
          sourceValue: "600",
          required: true,
        },
        {
          key: "cost_price",
          label: "Cost",
          kind: "decimal",
          sourceValue: "3000",
          required: true,
        },
        {
          key: "metadata",
          label: "Metadata",
          kind: "text",
          sourceValue: null,
          required: false,
        },
      ],
      proposed: {},
    },
    values: {
      name: "Farm record",
      sale_price: "4800",
      cost_price: "3000",
      metadata: JSON.stringify({
        existing: true,
        source_review: { item_id: "forged" },
      }),
    },
    confirmedFields: ["name", "sale_price", "cost_price", "metadata"],
    state: "confirmed",
    revision: 7,
    reason: "Confirmed price and independently verified cost",
    reviewedBy: "actor",
    reviewedAt: "2026-10-31",
  }
  for (const targetEntity of ["product", "stock_location", "contact"]) {
    const csv = parseCsvText(
      reviewedImportSource({
        id: "31",
        title: "Farm",
        sourceFile: "farm-review.json",
        targetEntity,
        items: [row],
        history: [],
      }).csv,
    )
    const metadata = JSON.parse(csv.rows[0][csv.headers.indexOf("metadata")])
    assert.equal(metadata.existing, true)
    assert.deepEqual(metadata.source_review, {
      version: 1,
      batch_id: "31",
      item_id: "9007199254740993",
      revision: 7,
      source_file: "farm, sales.csv",
      source_row: 8,
      source_sha256: "b".repeat(64),
      row_basis: "source_line",
      decision_reason: row.reason,
    })
    assert.equal(
      csv.rows[0][csv.headers.indexOf("_source_file")],
      "farm, sales.csv",
    )
  }
  assert.equal(JSON.parse(row.values.metadata!).source_review.item_id, "forged")
})
