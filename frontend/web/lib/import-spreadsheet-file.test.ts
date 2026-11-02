import assert from "node:assert/strict"
import test from "node:test"
import { deflateRawSync } from "node:zlib"

import {
  buildMappedImportCsv,
  filterMappingForHeaders,
  parseXlsxWorkbook,
  readImportFile,
} from "./import-spreadsheet-file"

const encoder = new TextEncoder()

function littleEndian(
  size: number,
  values: Array<[number, number, number]>,
): Uint8Array {
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
    localOffset +=
      localHeader.byteLength + nameBytes.byteLength + data.byteLength
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

function compressedZip(
  name: string,
  text: string,
  declaredSize: number,
): ArrayBuffer {
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
      "<sst><si><t>Account</t></si><si><t>Date</t></si><si><t>Cash</t></si></sst>",
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
  await assert.rejects(
    () => parseXlsxWorkbook(workbook),
    /does not contain a worksheet/,
  )
})

test("rejects a ZIP entry whose local header points outside the workbook", async () => {
  const workbook = new Uint8Array(
    storedZip({
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    }),
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
      {
        Account: "account_code",
        Amount: "debit",
        "Old column": "metadata.extra.old",
      },
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

const basicSheet =
  '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c></row></sheetData></worksheet>'

test("rejects formula cells instead of trusting their cached result", async () => {
  const workbook = storedZip({
    "xl/worksheets/sheet1.xml": basicSheet.replace(
      "<is><t>Acme</t></is>",
      '<f>WEBSERVICE("https://attacker.invalid")</f><v>Acme</v>',
    ),
  })
  await assert.rejects(
    () => parseXlsxWorkbook(workbook),
    /formulas are not supported/,
  )
})

test("rejects unsafe parts, duplicate names, external relationships and XML declarations", async () => {
  const hostileParts: Array<Record<string, string>> = [
    { "../escape.xml": "<x/>" },
    { "xl/vbaProject.bin": "executable" },
    { "xl/comments1.xml": "<comments/>" },
    { "XL/WORKSHEETS/SHEET1.XML": "<worksheet/>" },
    {
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship TargetMode = "External" Target="https://attacker.invalid"/></Relationships>',
    },
    {
      "docProps/core.xml":
        '<!DOCTYPE x [<!ENTITY steal SYSTEM "file:///etc/passwd">]><x>&steal;</x>',
    },
    {
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Hidden" state="veryHidden" sheetId="1"/></sheets></workbook>',
    },
  ]
  for (const parts of hostileParts) {
    await assert.rejects(() =>
      parseXlsxWorkbook(
        storedZip({ "xl/worksheets/sheet1.xml": basicSheet, ...parts }),
      ),
    )
  }
})

test("rejects hidden rows and duplicate coordinates instead of importing concealed or overwritten data", async () => {
  for (const xml of [
    basicSheet.replace('<row r="2">', '<row r="2" hidden="1">'),
    basicSheet.replace(
      "</row></sheetData>",
      '<c r="A2"><v>9</v></c></row></sheetData>',
    ),
  ]) {
    await assert.rejects(
      () => parseXlsxWorkbook(storedZip({ "xl/worksheets/sheet1.xml": xml })),
      /Hidden|duplicate cell/,
    )
  }
})

test("rejects encrypted ZIP entries and implausible aggregate expansion before XML parsing", async () => {
  const encrypted = storedZip({ "xl/worksheets/sheet1.xml": basicSheet })
  const view = new DataView(encrypted)
  view.setUint16(6, 1, true)
  for (let offset = 0; offset < encrypted.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50)
      view.setUint16(offset + 8, 1, true)
  }
  await assert.rejects(() => parseXlsxWorkbook(encrypted), /Encrypted/)
  await assert.rejects(
    () =>
      parseXlsxWorkbook(
        compressedZip("xl/worksheets/sheet1.xml", basicSheet, 30_000_001),
      ),
    /safe import limit/,
  )
})

test("readImportFile sends original bytes for server admission and retains immutable provenance", async () => {
  const file = new File(["name\nAcme"], "original.csv")
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/import/inspect-file")
      assert.equal(init?.body, file)
      assert.equal(init?.credentials, "same-origin")
      assert.equal(
        (init?.headers as Record<string, string>)["x-file-name"],
        "original.csv",
      )
      return Response.json({
        csvText: "name\nAcme",
        headers: ["name"],
        rows: [["Acme"]],
        format: "csv",
        policyVersion: "file-admission-v1",
        sourceSha256: "a".repeat(64),
      })
    }
    const parsed = await readImportFile(file)
    assert.equal(parsed.sourceSha256, "a".repeat(64))
    assert.equal(parsed.policyVersion, "file-admission-v1")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("failed server admission never falls back to local extraction", async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      Response.json({ error: "Workbook rejected" }, { status: 422 })
    await assert.rejects(
      () => readImportFile(new File(["name\nAcme"], "file.csv")),
      /Workbook rejected/,
    )
    globalThis.fetch = async () =>
      Response.json({
        csvText: "name\nOther",
        headers: ["name"],
        rows: [["Acme"]],
        format: "csv",
        policyVersion: "v1",
        sourceSha256: "a".repeat(64),
      })
    await assert.rejects(
      () => readImportFile(new File(["name\nAcme"], "file.csv")),
      /inconsistent normalized data/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("workbook source admissions are retained and malformed or missing handles reject", async () => {
  const originalFetch = globalThis.fetch
  const base = {
    csvText: "name\nAcme",
    headers: ["name"],
    rows: [["Acme"]],
    format: "xlsx",
    sheetName: null,
    policyVersion: "file-admission-v1",
    sourceSha256: "a".repeat(64),
  }
  try {
    globalThis.fetch = async () =>
      Response.json({ ...base, sourceAdmissionId: "b".repeat(32) })
    assert.equal(
      (await readImportFile(new File(["zip"], "source.xlsx")))
        .sourceAdmissionId,
      "b".repeat(32),
    )
    for (const id of [undefined, "not-clean", "A".repeat(32)]) {
      globalThis.fetch = async () =>
        Response.json({ ...base, ...(id ? { sourceAdmissionId: id } : {}) })
      await assert.rejects(
        () => readImportFile(new File(["zip"], "source.xlsx")),
        /invalid result/,
      )
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("rejects refresh connections, defined-name formulas and worksheet extension cells", async () => {
  for (const parts of [
    {
      "xl/connections.xml":
        '<connections><connection refreshOnLoad="1"><webPr url="https://attacker.invalid"/></connection></connections>',
    },
    {
      "xl/workbook.xml":
        '<workbook><definedNames><definedName name="Payload">WEBSERVICE("https://attacker.invalid")</definedName></definedNames></workbook>',
    },
    {
      "xl/worksheets/sheet1.xml": basicSheet.replace(
        "</worksheet>",
        '<extLst><ext><c r="A3"><v>hidden</v></c></ext></extLst></worksheet>',
      ),
    },
    {
      "xl/worksheets/sheet1.xml": basicSheet.replace(
        "<worksheet>",
        '<worksheet xmlns="urn:foreign">',
      ),
    },
  ] as Array<Record<string, string>>) {
    await assert.rejects(() =>
      parseXlsxWorkbook(
        storedZip({ "xl/worksheets/sheet1.xml": basicSheet, ...parts }),
      ),
    )
  }
})

test("original admission uses the explicitly selected company and rejects a mismatched result", async () => {
  const originalFetch = globalThis.fetch
  const base = {
    csvText: "name\nAcme",
    headers: ["name"],
    rows: [["Acme"]],
    format: "csv",
    policyVersion: "file-admission-v1",
    sourceSha256: "a".repeat(64),
    sourceAdmissionId: "b".repeat(32),
  }
  try {
    globalThis.fetch = async (path) => {
      assert.equal(path, "/api/import/inspect-file?companyId=9007199254740993")
      return Response.json({ ...base, companyId: "9007199254740993" })
    }
    await readImportFile(new File(["name\nAcme"], "source.csv"), {
      companyId: 9007199254740993n,
    })
    globalThis.fetch = async () => Response.json({ ...base, companyId: "1" })
    await assert.rejects(
      () =>
        readImportFile(new File(["name\nAcme"], "source.csv"), {
          companyId: 2,
        }),
      /invalid result/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
