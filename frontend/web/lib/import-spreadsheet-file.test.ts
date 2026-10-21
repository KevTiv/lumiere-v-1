import assert from "node:assert/strict"
import test from "node:test"
import { deflateRawSync } from "node:zlib"

import {
  buildMappedImportCsv,
  filterMappingForHeaders,
  parseXlsxWorkbook,
} from "./import-spreadsheet-file"

const encoder = new TextEncoder()

function littleEndian(size: number, values: Array<[number, number, number]>): Uint8Array {
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  for (const [offset, value, width] of values) {
    if (width === 2) view.setUint16(offset, value, true)
    else view.setUint32(offset, value, true)
  }
  return bytes
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

function storedZip(files: Record<string, string>): ArrayBuffer {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const localHeader = littleEndian(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [8, 0, 2],
      [18, data.byteLength, 4],
      [22, data.byteLength, 4],
      [26, nameBytes.byteLength, 2],
    ])
    localParts.push(localHeader, nameBytes, data)

    const centralHeader = littleEndian(46, [
      [0, 0x02014b50, 4],
      [4, 20, 2],
      [6, 20, 2],
      [10, 0, 2],
      [20, data.byteLength, 4],
      [24, data.byteLength, 4],
      [28, nameBytes.byteLength, 2],
      [42, localOffset, 4],
    ])
    centralParts.push(centralHeader, nameBytes)
    localOffset += localHeader.byteLength + nameBytes.byteLength + data.byteLength
  }

  const central = concat(centralParts)
  const eocd = littleEndian(22, [
    [0, 0x06054b50, 4],
    [8, Object.keys(files).length, 2],
    [10, Object.keys(files).length, 2],
    [12, central.byteLength, 4],
    [16, localOffset, 4],
  ])
  const zip = concat([...localParts, central, eocd])
  return toArrayBuffer(zip)
}

function compressedZip(name: string, text: string, declaredSize: number): ArrayBuffer {
  const nameBytes = encoder.encode(name)
  const compressed = new Uint8Array(deflateRawSync(encoder.encode(text)))
  const localHeader = littleEndian(30, [
    [0, 0x04034b50, 4],
    [4, 20, 2],
    [8, 8, 2],
    [18, compressed.byteLength, 4],
    [22, declaredSize, 4],
    [26, nameBytes.byteLength, 2],
  ])
  const local = concat([localHeader, nameBytes, compressed])
  const centralHeader = littleEndian(46, [
    [0, 0x02014b50, 4],
    [4, 20, 2],
    [6, 20, 2],
    [10, 8, 2],
    [20, compressed.byteLength, 4],
    [24, declaredSize, 4],
    [28, nameBytes.byteLength, 2],
    [42, 0, 4],
  ])
  const central = concat([centralHeader, nameBytes])
  const eocd = littleEndian(22, [
    [0, 0x06054b50, 4],
    [8, 1, 2],
    [10, 1, 2],
    [12, central.byteLength, 4],
    [16, local.byteLength, 4],
  ])
  const zip = concat([local, central, eocd])
  return toArrayBuffer(zip)
}

test("opens the first worksheet, resolves shared strings, and normalizes dates", async () => {
  const workbook = storedZip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Opening balances" sheetId="1"/></sheets></workbook>',
    "xl/sharedStrings.xml":
      '<sst><si><t>Account</t></si><si><t>Date</t></si><si><t>Cash</t></si></sst>',
    "xl/styles.xml":
      '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": [
      "<worksheet><sheetData>",
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45292</v></c></row>',
      "</sheetData></worksheet>",
    ].join(""),
  })

  const parsed = await parseXlsxWorkbook(workbook)

  assert.equal(parsed.format, "xlsx")
  assert.equal(parsed.sheetName, "Opening balances")
  assert.deepEqual(parsed.headers, ["Account", "Date"])
  assert.deepEqual(parsed.rows, [["Cash", "2024-01-01"]])
  assert.equal(parsed.csvText, '"Account","Date"\n"Cash","2024-01-01"')
})

test("rejects a file without worksheets", async () => {
  const workbook = storedZip({ "xl/workbook.xml": "<workbook/>" })
  await assert.rejects(() => parseXlsxWorkbook(workbook), /does not contain a worksheet/)
})

test("rejects a ZIP entry whose local header points outside the workbook", async () => {
  const workbook = new Uint8Array(
    storedZip({ "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>" }),
  )
  const view = new DataView(workbook.buffer)
  let centralOffset = -1
  for (let offset = 0; offset <= workbook.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      centralOffset = offset
      break
    }
  }
  assert.notEqual(centralOffset, -1)
  view.setUint32(centralOffset + 42, workbook.byteLength + 100, true)

  await assert.rejects(
    () => parseXlsxWorkbook(workbook.buffer),
    /points outside the file/,
  )
})

test("caps actual decompressed output when the ZIP declaration lies", async () => {
  const workbook = compressedZip(
    "xl/worksheets/sheet1.xml",
    `<worksheet>${"x".repeat(10_000_100)}</worksheet>`,
    1,
  )
  await assert.rejects(
    () => parseXlsxWorkbook(workbook),
    /expands beyond the safe import limit/,
  )
})

test("rejects extreme sparse worksheet coordinates before matrix allocation", async () => {
  const workbook = storedZip({
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
  })
  await assert.rejects(
    () => parseXlsxWorkbook(workbook),
    /exceeds the 25,000 row import limit/,
  )
})

test("rejects reordered multi-sheet workbooks instead of reading the wrong sheet", async () => {
  const workbook = storedZip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Import this" sheetId="2"/><sheet name="Not this" sheetId="1"/></sheets></workbook>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wanted</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wrong</t></is></c></row></sheetData></worksheet>',
  })
  await assert.rejects(
    () => parseXlsxWorkbook(workbook),
    /contains multiple worksheets.*Keep only the sheet you want to import/,
  )
})

test("saved mappings only carry columns that exist in the new file", () => {
  assert.deepEqual(
    filterMappingForHeaders(
      { Account: "account_code", Amount: "debit", "Old column": "metadata.extra.old" },
      ["Account", "Amount"],
    ),
    { Account: "account_code", Amount: "debit" },
  )
})

test("builds canonical import CSV from the reviewed mapping and skipped duplicates", () => {
  assert.equal(
    buildMappedImportCsv(
      ["Ledger account", "Opening debit", "Ignored"],
      [
        ["1000", "25.00", "first"],
        ["2000", "10.00", "duplicate"],
      ],
      {
        "Ledger account": "account_code",
        "Opening debit": "debit",
        Ignored: "__skip__",
        "Stale template column": "credit",
      },
      new Set([1]),
    ),
    "account_code,debit\n1000,25.00",
  )
})
