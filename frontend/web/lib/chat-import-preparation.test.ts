import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { reviewedImportSource, type ReviewDataset, type ReviewDetail } from "./import-review-model"
import { previewPreparedProducts } from "./prepared-product-preview"
import { previewPreparedLocations } from "./prepared-location-preview"
import { previewPreparedContacts } from "./prepared-contact-preview"

const worker = fileURLToPath(new URL("../../../scripts/import-task-prepare.py", import.meta.url))
const actor = "ab".repeat(32)

/** Execute the same deterministic worker that the API packages and invokes. */
function prepare(files: { fileName: string; text: string }[], mode: "prepare_import" | "inspect_only" = "prepare_import"): ReviewDataset[] {
  const result = spawnSync("python3", ["-B", "-I", worker], {
    input: JSON.stringify({ mode, files: files.map(file => ({ fileName: file.fileName, contentBase64: Buffer.from(file.text).toString("base64") })) }),
    encoding: "utf8", timeout: 15_000, maxBuffer: 8_000_000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return (JSON.parse(result.stdout) as { datasets: ReviewDataset[] }).datasets
}

/** Model an explicit operator decision; the parser alone never confirms a row. */
function confirmed(dataset: ReviewDataset, overrides: Record<string, string> | ((index: number) => Record<string, string>) = {}): ReviewDetail {
  return {
    id: "71", title: dataset.title, targetEntity: dataset.targetEntity, sourceFile: dataset.sourceFile, history: [],
    items: dataset.items.map((source, index) => {
      const values = { ...source.proposed, ...(typeof overrides === "function" ? overrides(index) : overrides) }
      for (const field of source.fields.filter(field => field.required)) {
        assert.ok(values[field.key]?.trim(), `Test operator must explicitly resolve ${field.key}`)
      }
      return {
        id: String(711 + index), source, values,
        confirmedFields: source.fields.filter(field => values[field.key]?.trim()).map(field => field.key),
        state: "confirmed", revision: 2, reason: "Operator verified these values against the synthetic source.",
        reviewedBy: actor, reviewedAt: "2026-11-01T10:00:00Z",
      }
    }),
  }
}

test("real worker product proposals reach prepared preview with exact source rows and hashes", () => {
  const text = 'name,category_id,uom_id,uom_po_id,sale_price,cost_price,active,can_be_sold,can_be_purchased\n"Sausage\npremium",12,13,13,4800,3000,false,true,true\nEggs,12,14,14,0,0,true,true,false\n'
  const datasets = prepare([{ fileName: "products.csv", text }])
  assert.equal(datasets.length, 1)
  const dataset = datasets[0]
  assert.equal(dataset.targetEntity, "product")
  assert.deepEqual(dataset.items.map(item => item.source.row), [2, 4])
  // The native CSV preview accepts one record per line. An operator explicitly
  // corrects the proposed display name; the multiline original remains evidence.
  assert.equal(dataset.items[0].proposed.name, null)
  assert.match(dataset.items[0].issue, /Multiline source text/)
  const reviewed = confirmed(dataset, (index): Record<string, string> => index === 0 ? { name: "Sausage premium" } : {})
  assert.equal(reviewed.items[0].source.fields.find(field => field.key === "name")?.sourceValue, "Sausage\npremium")
  const source = reviewedImportSource(reviewed)
  const result = previewPreparedProducts({
    csv: source.csv, organizationId: 8001,
    categories: [{ id: 12, organizationId: 8001 }],
    uoms: [{ id: 13, organizationId: 8001 }, { id: 14, organizationId: 8001 }],
  })
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.rows[0].name, "Sausage premium")
  assert.equal(result.preview.rows[0].active, "false")
  assert.equal(result.preview.rows[1].sale_price, "0")
  assert.equal(result.preview.rows[1]._source_row, "4")
  const hash = createHash("sha256").update(text).digest("hex")
  for (const row of result.preview.rows) {
    assert.equal(row._source_sha256, hash)
    assert.ok(typeof row.metadata === "string")
    const metadata = JSON.parse(row.metadata)
    assert.equal(metadata.source_review.source_file, "products.csv")
    assert.equal(metadata.source_review.source_sha256, hash)
    assert.equal(metadata.source_review.revision, 2)
  }
})

test("real worker location proposals include the native preview contract without inventing flags", () => {
  const [dataset] = prepare([{ fileName: "locations.csv", text: "name,usage,active,is_scrap\nNyabugogo,internal,true,false\n" }])
  assert.equal(dataset.targetEntity, "stock_location")
  const source = reviewedImportSource(confirmed(dataset))
  const result = previewPreparedLocations(source.csv)
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.rows[0].usage, "internal")
  assert.equal(result.preview.rows[0].is_scrap, "false")
  assert.equal(result.preview.rows[0]._source_file, "locations.csv")

  const [incomplete] = prepare([{ fileName: "locations.csv", text: "name,usage\nKicukiro,internal\n" }])
  assert.equal(incomplete.items[0].proposed.active, null)
  assert.equal(incomplete.items[0].proposed.is_scrap, null)
  assert.throws(() => confirmed(incomplete), /explicitly resolve/)
  const corrected = reviewedImportSource(confirmed(incomplete, { active: "true", is_scrap: "false" }))
  assert.deepEqual(previewPreparedLocations(corrected.csv).preview.validation_errors, [])
})

test("real worker contact proposals reach company-bound preview with original provenance", () => {
  const [dataset] = prepare([{ fileName: "contacts.csv", text: "name,email,type_,is_customer,is_vendor,is_employee,is_prospect,is_partner\nSynthetic buyer,buyer@example.invalid,contact,true,false,false,false,false\n" }])
  assert.equal(dataset.targetEntity, "contact")
  const source = reviewedImportSource(confirmed(dataset))
  const result = previewPreparedContacts({ csv: source.csv, companyId: 9001 })
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.rows[0].company_id, "9001")
  assert.equal(result.preview.rows[0].is_customer, "true")
  assert.equal(result.preview.rows[0]._source_file, "contacts.csv")
  assert.equal(result.preview.rows[0]._source_row, "2")
  assert.ok(typeof result.preview.rows[0].metadata === "string")
  assert.equal(JSON.parse(result.preview.rows[0].metadata).source_review.item_id, "711")
  assert.match(result.csv, /company_id/)
})

test("historical stock and debt rows remain observations instead of current master data", () => {
  const datasets = prepare([
    { fileName: "inventory-2022.csv", text: "name,quantity,date\nSausage,8,2022-10-01\n" },
    { fileName: "debt-2023.csv", text: "name,balance,date\nSynthetic buyer,4800,2023-01-01\n" },
  ])
  assert.equal(datasets.length, 2)
  assert.deepEqual(datasets.map(dataset => dataset.targetEntity), ["source_observation", "source_observation"])
  for (const dataset of datasets) {
    const row = dataset.items.find(item => item.source.row === 2)!
    assert.ok(row)
    assert.match(row.issue, /historical|Historical/)
    assert.equal(row.fields.some(field => field.key === "active"), false)
    assert.equal(row.fields.some(field => field.key === "company_id"), false)
  }
})

test("explicit inspection mode emits evidence without a business-import continuation", () => {
  const datasets = prepare([
    { fileName: "products.csv", text: "name,category_id,uom_id,uom_po_id,sale_price,cost_price,active\nSausage,12,13,13,4800,3000,true\n" },
    { fileName: "contacts.csv", text: "name,email\nSynthetic buyer,buyer@example.invalid\n" },
    { fileName: "locations.csv", text: "name,usage,active,is_scrap\nNyabugogo,internal,true,false\n" },
  ], "inspect_only")
  assert.equal(datasets.length, 3)
  for (const dataset of datasets) {
    assert.equal(dataset.targetEntity, "source_observation")
    assert.ok(dataset.items.every(item => item.fields.every(field => field.export === false)))
    assert.ok(dataset.items.every(item => /no business-record import was approved/.test(item.issue)))
    const exported = reviewedImportSource(confirmed(dataset))
    assert.equal(exported.targetEntity, "source_observation")
    assert.throws(() => previewPreparedProducts({ csv: exported.csv, organizationId: 8001, categories: [], uoms: [] }))
    assert.throws(() => previewPreparedLocations(exported.csv))
    assert.throws(() => previewPreparedContacts({ csv: exported.csv, companyId: 9001 }))
  }
})
