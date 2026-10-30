import assert from "node:assert/strict"
import test from "node:test"
import { productReviewReferenceOptions, productReviewStoredUnit, validateProductReviewReferences } from "./import-review-product-references"
import type { ReviewRow } from "./import-review-model"

const row: ReviewRow = { id: "1", revision: 1, state: "needs_review", reason: null, reviewedBy: null, reviewedAt: null, values: {}, source: { key: "source", label: "Synthetic product", issue: "Unit unknown", source: { file: "source.csv", row: 2, sha256: "a".repeat(64) }, proposed: {}, fields: [{ key: "stored_unit", label: "Price unit", kind: "choice", sourceValue: null, required: true, options: ["kg", "unit"] }] } }
const references = { categories: [{ id: 8, organizationId: 7, name: "Historic products" }], uoms: [{ id: 9, organizationId: 7, name: "Kilogram", symbol: "kg", categoryId: 1 }, { id: 10, organizationId: 7, name: "Unit", symbol: "unit", categoryId: 2 }, { id: 11, organizationId: 6, name: "Foreign unit", symbol: "kg", categoryId: 1 }] }
const values = { category_id: "8", uom_id: "9", uom_po_id: "9", stored_unit: "kg" }

test("reference choices show names and units from the current organization", () => {
  assert.deepEqual(productReviewReferenceOptions(references.uoms, 7), [{ value: "9", label: "Kilogram (kg)" }, { value: "10", label: "Unit (unit)" }])
  assert.deepEqual(productReviewReferenceOptions([{ id: Number.MAX_SAFE_INTEGER + 1, organizationId: 7, name: "Unsafe id" }], 7), [])
})
test("a product confirmation retains a coherent price, product and purchase unit", () => {
  assert.doesNotThrow(() => validateProductReviewReferences(row, values, references, 7))
  for (const changes of [{ stored_unit: "unit" }, { uom_id: "11" }, { uom_po_id: "10" }, { category_id: "999" }]) {
    assert.throws(() => validateProductReviewReferences(row, { ...values, ...changes }, references, 7))
  }
  assert.deepEqual(values, { category_id: "8", uom_id: "9", uom_po_id: "9", stored_unit: "kg" })
})
test("a declared storage unit remains fixed while source-unit uncertainty can be corrected", () => {
  const declared = { ...row, source: { ...row.source, fields: row.source.fields.map(field => ({ ...field, sourceValue: "kg" })) } }
  assert.equal(productReviewStoredUnit(declared), "kg")
  assert.deepEqual(productReviewReferenceOptions(references.uoms, 7, "kg"), [{ value: "9", label: "Kilogram (kg)" }])
  assert.throws(() => validateProductReviewReferences(declared, { ...values, stored_unit: "unit", uom_id: "10", uom_po_id: "10" }, references, 7))
})
