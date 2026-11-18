import assert from "node:assert/strict"
import test from "node:test"
import {
  importCoverageSchema,
  importPreparationIdentity,
  importPreparationSchema,
  importRecipeSchema,
  type ImportPreparation,
} from "./import-preparation"

const preparation: ImportPreparation = {
  version: 1,
  files: [
    {
      fileName: "history.csv",
      sourceSha256: "a".repeat(64),
      dateOrder: "dmy",
      decimalSeparator: ",",
      groupingSeparator: ".",
      sections: [
        {
          key: "expenses",
          headerRecord: 1,
          firstRecord: 2,
          lastRecord: 3,
          targetEntity: "source_observation",
          expectedHeaders: ["Itariki", "Igikorwa", "Amafaranga"],
          headerMap: {
            Itariki: "business_date",
            Igikorwa: "category",
            Amafaranga: "amount",
          },
          aliases: [{ field: "category", from: "umuriro", to: "electricity" }],
        },
      ],
    },
  ],
}

test("coverage preserves exact report differences and remains compatible with older receipts", () => {
  const control = {
    sectionKey: "shop-sales",
    label: "Reported shop sales subtotal",
    row: 1_048_575,
    reportRow: 1_048_560,
    reported: "1000.05",
    computed: "1000.04",
    difference: "0.01",
    currency: "RWF",
    missingLineValues: 1,
  }
  const file = {
    fileName: "farm.xlsx",
    sourceSha256: "a".repeat(64),
    byteCount: 500,
    status: "prepared",
    worksheet: "Kicukiro",
    recordCount: 0,
    reviewRecords: 0,
    blankRecords: 0,
    headerRecords: 0,
    records: [],
    sections: [],
    layoutSha256: null,
    error: null,
  }
  const coverage = { version: 1, complete: true, reconciliation: [] }
  assert.equal(
    importCoverageSchema.parse({ ...coverage, files: [file] }).files[0]
      .controls,
    undefined,
  )
  assert.deepEqual(
    importCoverageSchema.parse({
      ...coverage,
      files: [{ ...file, controls: [control] }],
    }).files[0].controls,
    [control],
  )
  assert.equal(
    importCoverageSchema.safeParse({
      ...coverage,
      files: [{ ...file, controls: [{ ...control, difference: 0.01 }] }],
    }).success,
    false,
  )
})

test("source-bound mixed-language rules remain explicit and cannot approve business facts", () => {
  assert.deepEqual(importPreparationSchema.parse(preparation), preparation)
  assert.equal(
    importPreparationSchema.safeParse({
      ...preparation,
      confirmedFields: ["amount"],
    }).success,
    false,
  )
  const changed = structuredClone(preparation)
  changed.files[0].sections![0].aliases = [
    { field: "amount", from: "1,50", to: "150" },
  ]
  assert.equal(importPreparationSchema.safeParse(changed).success, false)
  changed.files[0].sections![0].aliases = [
    { field: "unit", from: "pieces", to: "kilograms" },
  ]
  assert.equal(importPreparationSchema.safeParse(changed).success, false)
})

test("preparation identity distinguishes exact rules and source versions, independent of key order", () => {
  assert.equal(importPreparationIdentity(undefined), "null")
  assert.equal(
    importPreparationIdentity(preparation),
    importPreparationIdentity({ files: preparation.files, version: 1 }),
  )
  const changed = structuredClone(preparation)
  changed.files[0].dateOrder = "mdy"
  assert.notEqual(
    importPreparationIdentity(preparation),
    importPreparationIdentity(changed),
  )
  changed.files[0].dateOrder = "dmy"
  changed.files[0].sourceSha256 = "b".repeat(64)
  assert.notEqual(
    importPreparationIdentity(preparation),
    importPreparationIdentity(changed),
  )
})

test("section ranges, aliases and locale choices fail closed on ambiguous or overlapping rules", () => {
  const changed = structuredClone(preparation)
  changed.files[0].groupingSeparator = ","
  assert.equal(importPreparationSchema.safeParse(changed).success, false)
  changed.files[0].groupingSeparator = "."
  changed.files[0].sections!.push({
    ...changed.files[0].sections![0],
    key: "duplicate",
  })
  assert.equal(importPreparationSchema.safeParse(changed).success, false)
  changed.files[0].sections!.pop()
  changed.files[0].sections![0].aliases!.push({
    field: "category",
    from: "umuriro",
    to: "water",
  })
  assert.equal(importPreparationSchema.safeParse(changed).success, false)
})

test("saved recipe slots preserve layout identity but cannot carry an old source hash", () => {
  const {
    fileName: label,
    sourceSha256: _source,
    ...rules
  } = preparation.files[0]
  const recipe = {
    companyId: "2",
    key: "shop-history",
    name: "Shop history",
    version: 3,
    sha256: "b".repeat(64),
    createdAt: "2026-11-07T10:00:00Z",
    slots: [
      {
        key: "source-1",
        label,
        format: "csv",
        options: { ...rules, expectedLayoutSha256: "c".repeat(64) },
      },
    ],
  }
  assert.equal(importRecipeSchema.safeParse(recipe).success, true)
  const changed = structuredClone(recipe)
  Object.assign(changed.slots[0].options, { sourceSha256: "d".repeat(64) })
  assert.equal(importRecipeSchema.safeParse(changed).success, false)
})
