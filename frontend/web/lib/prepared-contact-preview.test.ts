import assert from "node:assert/strict"
import test from "node:test"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import { csvImportRequestBody } from "@lumiere/query-hooks/hooks/csv-import-request"
import { buildMappedImportCsv } from "./import-spreadsheet-file"
import { guidedImportRequest } from "./guided-import-request"
import { reviewedImportSource, type ReviewDetail } from "./import-review-model"
import { previewPreparedContacts } from "./prepared-contact-preview"

const header = "name,type_,is_customer,is_vendor,is_employee,is_prospect,is_partner"
const contact = "Customer,contact,true,false,false,false,false"

test("prepared contacts retain explicit roles and bind actual CSV to the selected company", () => {
  const result = previewPreparedContacts({ csv: `${header}\n${contact}`, companyId: 22 })
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.target_entity, "contact")
  assert.equal(result.preview.rows[0].is_vendor, "false")
  assert.equal(result.preview.rows[0].company_id, "22")
  assert.equal(result.mapping.company_id, "company_id")
  const parsed = parseCsvText(result.csv)
  assert.equal(parsed.rows[0][parsed.headers.indexOf("company_id")], "22")
})

test("unknown contact roles and types cannot become native false/default values", () => {
  assert.throws(() => previewPreparedContacts({ csv: "name\nCustomer", companyId: 22 }), /Required contact columns/)
  const result = previewPreparedContacts({ csv: `${header}\nCustomer,unknown,,false,false,false,0`, companyId: 22 })
  assert.deepEqual(new Set(result.preview.validation_errors.map(error => error.field)), new Set(["type_", "is_customer", "is_partner"]))
})

test("supplied company links must exactly match the selected company", () => {
  for (const id of ["", "0", "21", "022", "not-known"]) {
    const result = previewPreparedContacts({ csv: `${header},company_id\n${contact},${id}`, companyId: 22 })
    assert.deepEqual(result.preview.validation_errors.map(error => error.field), ["company_id"])
  }
  assert.deepEqual(previewPreparedContacts({ csv: `${header},company_id\n${contact},22`, companyId: 22 }).preview.validation_errors, [])
  for (const id of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => previewPreparedContacts({ csv: `${header}\n${contact}`, companyId: id }), /operating company/)
})

test("contact headers reject unsupported links, ignored native aliases and duplicate fields", () => {
  for (const field of ["parent_id", "active", "description", "name"]) {
    assert.throws(() => previewPreparedContacts({ csv: `${header},${field}\n${contact},7`, companyId: 22 }), /exact contact CSV headers/)
  }
})

test("optional contact numbers and metadata preserve unknowns but reject malformed values", () => {
  const result = previewPreparedContacts({ csv: `${header},employees_count,annual_revenue,metadata\n${contact},,,{}\n${contact},1.5,NaN,[]\n${contact},2147483648,unknown,bad\n${contact},0,0,{}`, companyId: 22 })
  assert.deepEqual(result.preview.validation_errors.map(error => `${error.row_index}:${error.field}`), ["1:employees_count", "1:annual_revenue", "1:metadata", "2:employees_count", "2:annual_revenue", "2:metadata"])
  assert.equal(result.preview.rows[0].employees_count, "")
  assert.equal(result.preview.rows[0].annual_revenue, "")
  assert.equal(result.preview.rows[3].annual_revenue, "0")
  assert.ok(previewPreparedContacts({ csv: `${header}\n${contact},extra`, companyId: 22 }).preview.validation_errors.some(error => error.field === "row"))
})

test("confirmed contact source reaches a tracked request with original provenance and scope", () => {
  const values = { name: "Customer", type_: "contact", is_customer: "true", is_vendor: "false", is_employee: "false", is_prospect: "false", is_partner: "false" }
  const detail: ReviewDetail = {
    id: "91", title: "Customers", targetEntity: "contact", sourceFile: "original customers.csv", history: [],
    items: [{
      id: "9007199254740993", revision: 3, state: "confirmed", reason: "Confirmed contact identity and role", reviewedBy: "actor", reviewedAt: "2026-11-01", values,
      source: { key: "customer-4", label: "Customer", source: { file: "original customers.csv", row: 4, sha256: "a".repeat(64) }, issue: "Review roles", proposed: values, fields: Object.entries(values).map(([key, value]) => ({ key, label: key, kind: "text", sourceValue: value, required: true })) },
    }],
  }
  const reviewed = reviewedImportSource(detail)
  const result = previewPreparedContacts({ csv: reviewed.csv, companyId: 22 })
  assert.deepEqual(result.preview.validation_errors, [])
  const parsed = parseCsvText(result.csv)
  const csv = buildMappedImportCsv(parsed.headers, parsed.rows, result.mapping, new Set())
  const request = guidedImportRequest({ organizationId: 7n, companyId: 22, entity: "contact", csv, fileName: reviewed.fileName, companies: [{ id: 22 }] })
  assert.equal(request.entity, "contact")
  assert.match(request.requestId, /^[0-9a-f]{32}$/)
  assert.equal(request.csvData, csv)
  const body = JSON.parse(csvImportRequestBody(request))
  assert.equal(body.params.companyId, "22")
  const submitted = parseCsvText(request.csvData)
  const row = Object.fromEntries(submitted.headers.map((field, index) => [field, submitted.rows[0][index]]))
  assert.equal(row.company_id, "22")
  assert.equal(row._source_file, "original customers.csv")
  assert.equal(row._source_row, "4")
  assert.equal(row._review_item_id, "9007199254740993")
  assert.equal(JSON.parse(row.metadata).source_review.decision_reason, detail.items[0].reason)
  assert.equal(JSON.parse(row.metadata).source_review.source_sha256, "a".repeat(64))
})

test("contact safety checks include rows after the first fifty", () => {
  const csv = `${header}\n` + Array.from({ length: 60 }, (_, index) => `${index === 59 ? "=1+1" : "Customer"},contact,true,false,false,false,false`).join("\n")
  assert.throws(() => previewPreparedContacts({ csv, companyId: 22 }), /unsafe|safety|blocked/i)
})
