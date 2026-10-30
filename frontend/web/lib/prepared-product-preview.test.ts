import assert from "node:assert/strict"
import test from "node:test"
import { previewPreparedProducts } from "./prepared-product-preview"

const header = "name,category_id,uom_id,uom_po_id,sale_price,cost_price,active"
const args = { organizationId: 7, categories: [{ id: 12, organizationId: 7 }], uoms: [{ id: 13, organizationId: 7 }] }

test("prepared products retain explicit zero and archived status without an AI request", () => {
  const result = previewPreparedProducts({ ...args, csv: `${header}\nBones,12,13,13,0,0,false` })
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.rows[0].cost_price, "0")
  assert.equal(result.preview.rows[0].active, "false")
  assert.equal(result.mapping.uom_id, "uom_id")
})

test("unknown cost stays blank and every row is checked", () => {
  const csv = `${header}\n` + Array.from({ length: 60 }, (_, i) => `Product ${i},12,13,13,4800,${i === 59 ? "" : "3000"},false`).join("\n")
  const result = previewPreparedProducts({ ...args, csv })
  assert.equal(result.preview.rows.length, 60)
  assert.equal(result.preview.rows[59].cost_price, "")
  assert.ok(result.preview.validation_errors.some(error => error.row_index === 59 && error.field === "cost_price"))
})

test("foreign or unavailable unit and category references cannot pass preview", () => {
  const result = previewPreparedProducts({ ...args, categories: [{ id: 12, organizationId: 8 }], uoms: [], csv: `${header}\nSausage,12,13,13,4800,3000,false` })
  assert.deepEqual(new Set(result.preview.validation_errors.map(error => error.field)), new Set(["category_id", "uom_id", "uom_po_id"]))
})

test("header typos, duplicates and missing required columns fail before import", () => {
  for (const csv of ["name,saleprice\nSausage,4800", `${header},name\nSausage,12,13,13,4800,3000,false,Sausage`, "name\nSausage"]) assert.throws(() => previewPreparedProducts({ ...args, csv }))
})

test("unsafe cells after the first fifty rows are still rejected", () => {
  const csv = `${header}\n` + Array.from({ length: 60 }, (_, i) => `${i === 59 ? "=1+1" : "Product"},12,13,13,4800,3000,false`).join("\n")
  assert.throws(() => previewPreparedProducts({ ...args, csv }), /unsafe|safety|blocked/i)
})

test("confirmed review exports keep their source references through prepared preview", () => {
  const result = previewPreparedProducts({ ...args, csv: `${header},metadata,_source_file,_source_row,_source_sha256,_review_item_id,_review_revision,_review_reason\nSausage,12,13,13,4800,3000,false,{},historic.csv,8,${"a".repeat(64)},11,2,Confirmed against source` })
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.rows[0]._source_file, "historic.csv")
  assert.equal(result.mapping._review_revision, "_review_revision")
})
