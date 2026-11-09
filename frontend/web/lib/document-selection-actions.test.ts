import assert from "node:assert/strict"
import { test } from "node:test"

import {
  documentSelectionAnalysisReference,
  documentSelectionMatchesScope,
  documentSelectionPreparation,
  type DocumentSelection,
} from "./document-selection-actions"

const selection: DocumentSelection = {
  organizationId: 7n,
  companyId: 3n,
  includeVersions: true,
  source: {
    documentId: "9007199254740993",
    versionId: "9",
    fileName: "inventory.csv",
    mimeType: "text/csv",
    checksum: "a".repeat(64),
    url: "/api/documents/blobs/object/7/default/unused",
    size: 310,
  },
  sheetName: "Localized CSV records",
  range: { firstRow: 5, lastRow: 9, firstColumn: 2, lastColumn: 3 },
  parsing: { delimiter: ";", encoding: "utf-8", headerRow: 1 },
  text: "private-cell-value",
}

test("assistant handoff includes the exact source and parser settings without cell data", () => {
  assert.deepEqual(documentSelectionAnalysisReference(selection), {
    documentId: "9007199254740993",
    versionId: "9",
    current: false,
    checksum: "a".repeat(64),
    sheetName: "CSV",
    ...selection.range,
    ...selection.parsing,
  })
  assert.throws(() =>
    documentSelectionAnalysisReference({
      ...selection,
      range: { ...selection.range, lastRow: 250 },
    }),
  )
})

test("reviewed preparation pins the source and never silently substitutes an entire file", () => {
  const result = documentSelectionPreparation({
    ...selection,
    includeVersions: false,
  })
  assert.deepEqual(result, {
    version: 1,
    files: [
      {
        fileName: "inventory.csv",
        sourceSha256: "a".repeat(64),
        delimiter: ";",
        managedSelection: {
          documentId: "9007199254740993",
          versionId: "9",
          current: true,
          sheetName: "CSV",
          ...selection.range,
          encoding: "utf-8",
          headerRow: 1,
        },
      },
    ],
  })
  assert.throws(() =>
    documentSelectionPreparation({
      ...selection,
      source: { ...selection.source, versionId: undefined },
    }),
  )
  assert.throws(() =>
    documentSelectionPreparation({
      ...selection,
      range: { ...selection.range, lastColumn: 201 },
    }),
  )
  assert.equal(documentSelectionMatchesScope(selection, 7, 3), true)
  assert.equal(documentSelectionMatchesScope(selection, 7, 4), false)
  assert.equal(documentSelectionMatchesScope(selection, 6, 3), false)
})
