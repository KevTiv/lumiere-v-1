import { describe, expect, it } from "vitest"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import { reviewedImportSource, type ReviewDetail } from "../../../../web/lib/import-review-model"
import { parseRecordImportSource } from "./record-import-source"

const source = {
  version: 1,
  source_file: "farm, July.csv",
  source_row: 42,
  source_sha256: "a".repeat(64),
  row_basis: "source_line",
  batch_id: "31",
  item_id: "9007199254740993",
  revision: 3,
  decision_reason: "Confirmed price; weight remains unknown",
}

describe("recorded import source metadata", () => {
  it("reads the exact metadata emitted by the product and location review exporter", () => {
    for (const targetEntity of ["product", "stock_location"]) {
      const values: Record<string, string> = targetEntity === "product"
        ? { name: "Sausage", sale_price: "4800", cost_price: "3000" }
        : { name: "Farm store", usage: "internal" }
      const detail: ReviewDetail = {
        id: source.batch_id,
        title: "Farm",
        targetEntity,
        sourceFile: "farm-review.json",
        history: [],
        items: [{
          id: source.item_id,
          source: {
            key: "farm-row",
            label: "Farm record",
            source: { file: source.source_file, row: source.source_row, sha256: source.source_sha256 },
            issue: "Confirm source values",
            fields: Object.keys(values).map((key) => ({ key, label: key, kind: "text", sourceValue: null, required: true })),
            proposed: {},
          },
          values,
          confirmedFields: Object.keys(values),
          state: "confirmed",
          revision: source.revision,
          reason: source.decision_reason,
          reviewedBy: "owner",
          reviewedAt: "2026-10-31",
        }],
      }
      const csv = parseCsvText(reviewedImportSource(detail).csv)
      const metadata = csv.rows[0]![csv.headers.indexOf("metadata")]
      expect(parseRecordImportSource(metadata)).toEqual({
        file: source.source_file,
        row: 42,
        rowBasis: "source_line",
        sha256: source.source_sha256,
        batchId: "31",
        itemId: "9007199254740993",
        revision: 3,
        reason: source.decision_reason,
      })
    }
  })

  it("accepts authorized decoded metadata and native Option strings without coercing IDs", () => {
    const metadata = { source_review: source }
    expect(parseRecordImportSource({ some: JSON.stringify(metadata) })).toEqual(parseRecordImportSource(metadata))
    expect(parseRecordImportSource(metadata)?.itemId).toBe("9007199254740993")
    expect(parseRecordImportSource({ source_review: { ...source, row_basis: "import_row" } })?.rowBasis).toBe("import_row")
  })

  it("rejects absent, oversized, malformed and unsupported evidence instead of guessing values", () => {
    for (const metadata of [undefined, null, "{", [], { none: [] }, " ".repeat(131_073), { source_review: null }]) {
      expect(parseRecordImportSource(metadata)).toBeNull()
    }
    for (const invalid of [
      { version: 2 }, { version: "1" }, { source_file: " " },
      { source_row: 0 }, { source_row: -1 }, { source_row: 1.5 }, { source_row: "42" },
      { source_sha256: "not-a-file-hash" }, { row_basis: "guessed" },
      { batch_id: "0" }, { batch_id: "01" }, { item_id: "9223372036854775808" },
      { item_id: Number("9007199254740993") }, { revision: 0 },
    ]) {
      expect(parseRecordImportSource({ source_review: { ...source, ...invalid } })).toBeNull()
    }
  })

  it("omits invalid optional reasons and never returns unrelated metadata", () => {
    const parsed = parseRecordImportSource({
      private_note: "not source evidence",
      source_review: { ...source, decision_reason: { html: "<script>" }, secret: "not source evidence" },
    })
    expect(parsed?.reason).toBeNull()
    expect(parsed).not.toHaveProperty("secret")
    expect(parsed).not.toHaveProperty("private_note")
  })
})
