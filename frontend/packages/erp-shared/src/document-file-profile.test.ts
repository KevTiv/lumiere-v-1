import assert from "node:assert/strict"
import test from "node:test"
import {
  billDocumentContentType,
  DOCX_DOCUMENT_MIME,
  documentFileContentType,
} from "./document-file-profile"

test("document declarations infer missing MIME only for supported exact extensions", () => {
  assert.equal(
    documentFileContentType({ name: "source.CSV", type: "", size: 50 }),
    "text/csv",
  )
  assert.equal(
    documentFileContentType({ name: "receipt.pdf", type: "", size: 50 }),
    "application/pdf",
  )
  assert.equal(
    documentFileContentType({ name: "document.docx", type: "", size: 50 }),
    DOCX_DOCUMENT_MIME,
  )
  for (const name of [
    "active.svg",
    "legacy.xls",
    "document.docm",
    "unknown.bin",
  ]) {
    assert.throws(
      () => documentFileContentType({ name, type: "", size: 50 }),
      /supported/,
    )
  }
  assert.throws(
    () =>
      documentFileContentType({
        name: "receipt.pdf",
        type: "image/png",
        size: 50,
      }),
    /does not match/,
  )
})

test("PDF, workbook, text and branding limits match the server profiles", () => {
  assert.equal(
    billDocumentContentType({
      name: "receipt.pdf",
      type: "application/pdf",
      size: 16 * 1024 * 1024,
    }),
    "application/pdf",
  )
  assert.throws(
    () =>
      billDocumentContentType({
        name: "receipt.pdf",
        type: "application/pdf",
        size: 16 * 1024 * 1024 + 1,
      }),
    /size limit/,
  )
  assert.equal(
    billDocumentContentType({
      name: "receipt.webp",
      type: "image/webp",
      size: 20 * 1024 * 1024,
    }),
    "image/webp",
  )
  assert.throws(
    () =>
      documentFileContentType(
        { name: "logo.webp", type: "image/webp", size: 50 },
        "branding",
      ),
    /PNG or JPEG/,
  )
  assert.throws(
    () =>
      documentFileContentType(
        { name: "logo.png", type: "image/png", size: 2 * 1024 * 1024 + 1 },
        "branding",
      ),
    /size limit/,
  )
  assert.throws(
    () =>
      documentFileContentType({
        name: "source.xlsx",
        type: "",
        size: 5_000_001,
      }),
    /size limit/,
  )
})
