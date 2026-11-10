import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import {
  DocumentCsvError,
  DocumentViewerError,
  documentPreview,
  parseDocumentCsv,
  readDocumentOfficePreview,
  readDocumentViewerFile,
  readDocumentViewerManifest,
  resolveDocumentViewerManifest,
  type DocumentViewerFetch,
} from "./document-viewer"

const bytes = new TextEncoder().encode("Name,Amount\nCoffee,1200\n")
const checksum = createHash("sha256").update(bytes).digest("hex")
const url = "/api/documents/blobs/object/7/default/csv-current"
const scope = { organizationId: 7n, companyId: 3n }
const document = {
  id: "1",
  organizationId: 7,
  companyId: 3,
  name: "Farm records",
  fileName: "farm.csv",
  mimetype: "text/csv",
  fileSize: bytes.length,
  checksum,
  url,
  isDeleted: false,
  currentVersionId: 11,
  versionCount: 2,
}
const version = {
  id: "11",
  organizationId: 7,
  documentId: 1,
  versionNumber: 2,
  fileName: "farm.csv",
  mimetype: "text/csv",
  fileSize: bytes.length,
  checksum,
  url,
  isCurrent: true,
}
const oldVersion = {
  ...version,
  id: "10",
  versionNumber: 1,
  url: "/api/documents/blobs/object/7/default/csv-previous",
  isCurrent: false,
}
const resolve = (
  overrides: Partial<Parameters<typeof resolveDocumentViewerManifest>[0]> = {},
) =>
  resolveDocumentViewerManifest({
    documents: [document],
    versions: [version, oldVersion],
    scope,
    documentId: "1",
    ...overrides,
  })
const errorCode = (code: string) => (error: unknown) =>
  error instanceof DocumentViewerError && error.code === code

test("viewer binds the current file and exact historical version to their parent", () => {
  const current = resolve()
  assert.equal(current.name, "Farm records")
  assert.equal(current.source.url, url)
  assert.equal(current.source.isCurrent, true)
  assert.deepEqual(
    current.versions.map((item) => item.versionId),
    ["11", "10"],
  )
  assert.equal(resolve({ versionId: "10" }).source.url, oldVersion.url)
  assert.throws(() => resolve({ versionId: "12" }), errorCode("unavailable"))
  assert.throws(
    () =>
      resolve({
        versions: [{ ...oldVersion, documentId: 2 }],
        versionId: "10",
      }),
    errorCode("unavailable"),
  )
})

test("viewer rejects missing, deleted, foreign and ambiguous document scope", () => {
  for (const changed of [
    { organizationId: 8 },
    { companyId: 4 },
    { companyId: undefined },
    { isDeleted: true },
    { isDeleted: undefined },
    { url: "https://files.example/file.csv" },
    { url: "/api/documents/blobs/object/8/default/csv-current" },
    { checksum: null },
  ])
    assert.throws(
      () => resolve({ documents: [{ ...document, ...changed }] }),
      errorCode("unavailable"),
    )
  assert.throws(
    () => resolve({ documents: [document, document] }),
    errorCode("unavailable"),
  )
  assert.throws(
    () =>
      resolve({
        documentId: "9007199254740993",
        documents: [{ ...document, id: 9_007_199_254_740_992 }],
      }),
    errorCode("unavailable"),
  )
  assert.equal(
    resolve({ documents: [{ ...document, companyId: null }] }).source.url,
    url,
  )
  assert.throws(
    () => resolve({ scope: { organizationId: 7n, companyId: null } }),
    errorCode("unavailable"),
  )
})

test("version projection cannot reconstruct hidden references or guess the current version", () => {
  const hidden = { ...oldVersion, url: undefined }
  assert.deepEqual(
    resolve({ versions: [version, hidden] }).versions.map(
      (item) => item.versionId,
    ),
    ["11"],
  )
  assert.throws(
    () => resolve({ versions: [version, hidden], versionId: "10" }),
    errorCode("unavailable"),
  )
  assert.throws(
    () => resolve({ versions: [version, { ...oldVersion, isCurrent: true }] }),
    errorCode("integrity"),
  )
  assert.throws(
    () => resolve({ versions: [{ ...version, checksum: "a".repeat(64) }] }),
    errorCode("integrity"),
  )
  assert.throws(
    () => resolve({ versions: [version, version] }),
    errorCode("invalid"),
  )
  assert.throws(
    () => resolve({ documents: [{ ...document, company_id: 4 }] }),
    errorCode("invalid"),
  )
})

test("viewer performs fresh scoped metadata reads and honors document-only access", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher: DocumentViewerFetch = async (url, init) => {
    calls.push({ url, init })
    return Response.json({ data: [document] })
  }
  const signal = new AbortController().signal
  const manifest = await readDocumentViewerManifest({
    scope,
    documentId: "1",
    includeVersions: false,
    fetcher,
    signal,
  })
  assert.equal(manifest.source.url, url)
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0]?.url,
    "/api/query/documents?organizationId=7&companyId=3",
  )
  assert.deepEqual(calls[0]?.init, {
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    signal,
  })
  await assert.rejects(
    readDocumentViewerManifest({
      scope,
      documentId: "1",
      versionId: "10",
      includeVersions: false,
      fetcher,
      signal,
    }),
    errorCode("denied"),
  )
  assert.equal(calls.length, 1)
})

test("denied or malformed metadata stays unavailable rather than becoming an empty successful view", async () => {
  const options = {
    scope,
    documentId: "1",
    includeVersions: false,
    signal: new AbortController().signal,
  }
  await assert.rejects(
    readDocumentViewerManifest({
      ...options,
      fetcher: async () => new Response("denied", { status: 403 }),
    }),
    errorCode("denied"),
  )
  await assert.rejects(
    readDocumentViewerManifest({
      ...options,
      fetcher: async () => Response.json({ rows: [document] }),
    }),
    errorCode("invalid"),
  )
})

test("file reads use the authenticated inspected endpoint and verify its exact type, size and checksum", async () => {
  const selected = resolve().source
  const signal = new AbortController().signal
  const fetched = await readDocumentViewerFile(
    selected,
    async (path, init) => {
      assert.equal(path, `${url}?sha256=${checksum}`)
      assert.deepEqual(init, {
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal,
      })
      return new Response(bytes, {
        headers: { "content-type": "text/csv; charset=utf-8" },
      })
    },
    signal,
  )
  assert.deepEqual(fetched.bytes, bytes)
  assert.equal(fetched.blob.type, "text/csv")
  await assert.rejects(
    readDocumentViewerFile(
      selected,
      async () =>
        new Response(bytes, { headers: { "content-type": "text/html" } }),
      signal,
    ),
    errorCode("integrity"),
  )
  await assert.rejects(
    readDocumentViewerFile(
      selected,
      async () =>
        new Response(new Uint8Array(bytes.length), {
          headers: { "content-type": "text/csv" },
        }),
      signal,
    ),
    errorCode("integrity"),
  )
  await assert.rejects(
    readDocumentViewerFile(
      selected,
      async () =>
        new Response(bytes.slice(1), {
          headers: { "content-type": "text/csv" },
        }),
      signal,
    ),
    errorCode("integrity"),
  )
})

test("the viewer bounds streamed bodies even without Content-Length", async () => {
  const selected = resolve().source
  let cancelled = false
  const fetcher: DocumentViewerFetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(selected.size + 1))
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "content-type": "text/csv" } },
    )
  await assert.rejects(
    readDocumentViewerFile(selected, fetcher, new AbortController().signal),
    errorCode("tooLarge"),
  )
  assert.equal(cancelled, true)
  let requested = false
  await assert.rejects(
    readDocumentViewerFile(
      { ...selected, size: 2_000_001 },
      async () => {
        requested = true
        return new Response(bytes)
      },
      new AbortController().signal,
    ),
    errorCode("unavailable"),
  )
  assert.equal(requested, false)
})

test("CSV preview detects logical records with titles, decimal commas and quoted separators", () => {
  const source = new TextEncoder().encode(
    "Summary\r\n".repeat(70) +
      '\r\nID;Amount;Notes\r\n0007;12,34;"line 1; x\r\nline 2"\r\n0008;1,20\r\n',
  )
  const preview = documentPreview("text/csv", source)
  assert.equal(preview.kind, "csv")
  assert.equal(preview.delimiter, ";")
  assert.deepEqual(preview.rows.slice(-4), [
    [""],
    ["ID", "Amount", "Notes"],
    ["0007", "12,34", "line 1; x\r\nline 2"],
    ["0008", "1,20"],
  ])
  assert.deepEqual(preview.diagnostics, [])
  assert.deepEqual(
    documentPreview(
      "application/csv",
      new TextEncoder().encode('ID\tNote\n0001\t"a,b;c"'),
    ),
    {
      kind: "csv",
      delimiter: "\t",
      encoding: "utf-8",
      diagnostics: [],
      rows: [
        ["ID", "Note"],
        ["0001", "a,b;c"],
      ],
      columns: 2,
    },
  )
})

test("ambiguous CSV warns and can be reparsed with the selected delimiter", () => {
  const source = new TextEncoder().encode("A,B;C\n0001,0002;0003")
  const detected = documentPreview("text/csv", source)
  assert.equal(detected.kind, "csv")
  assert.equal(detected.delimiter, ",")
  assert.deepEqual(detected.diagnostics, [
    { code: "ambiguousDelimiter", candidates: [",", ";"] },
  ])
  const manual = documentPreview("text/csv", source, { delimiter: ";" })
  assert.equal(manual.kind, "csv")
  assert.deepEqual(manual.rows, [
    ["A,B", "C"],
    ["0001,0002", "0003"],
  ])
  assert.deepEqual(manual.diagnostics, [])
})

test("CSV preview reads UTF BOMs and requires an explicit legacy encoding", () => {
  const text = "Item;Cost\nCafé;€"
  const utf8 = new TextEncoder().encode("\uFEFF" + text)
  const utf16le = new Uint8Array(Buffer.from("\uFEFF" + text, "utf16le"))
  const utf16be = new Uint8Array(Buffer.from(utf16le).swap16())
  for (const [source, encoding] of [
    [utf8, "utf-8"],
    [utf16le, "utf-16le"],
    [utf16be, "utf-16be"],
  ] as const) {
    const preview = documentPreview("text/csv", source)
    assert.equal(preview.kind, "csv")
    assert.equal(preview.encoding, encoding)
    assert.deepEqual(preview.rows, [
      ["Item", "Cost"],
      ["Café", "€"],
    ])
  }
  const legacy = Uint8Array.from(
    Buffer.from("Item;Cost\nCaf\xe9;\x80", "latin1"),
  )
  assert.throws(
    () => documentPreview("text/csv", legacy),
    (error: unknown) =>
      error instanceof DocumentCsvError &&
      error.diagnostic.code === "unknownEncoding",
  )
  const preview = documentPreview("text/csv", legacy, {
    encoding: "windows-1252",
  })
  assert.equal(preview.kind, "csv")
  assert.deepEqual(preview.rows, [
    ["Item", "Cost"],
    ["Café", "€"],
  ])
  assert.throws(
    () => documentPreview("text/csv", utf16le, { encoding: "windows-1252" }),
    (error: unknown) =>
      error instanceof DocumentCsvError &&
      error.diagnostic.code === "invalidEncoding",
  )
})

test("CSV diagnostics report a malformed field's logical record and column", () => {
  assert.throws(
    () =>
      documentPreview(
        "text/csv",
        new TextEncoder().encode('x;y\n"1\n2";"open'),
        { delimiter: ";" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DocumentCsvError)
      assert.deepEqual(error.diagnostic, {
        code: "unterminatedQuote",
        row: 2,
        column: 2,
      })
      return true
    },
  )
})

test("a revoked request or an aborted scope cannot return file bytes", async () => {
  await assert.rejects(
    readDocumentViewerFile(
      resolve().source,
      async () => new Response("denied", { status: 403 }),
      new AbortController().signal,
    ),
    errorCode("denied"),
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    readDocumentViewerFile(
      resolve().source,
      async () =>
        new Response(bytes, { headers: { "content-type": "text/csv" } }),
      controller.signal,
    ),
    { name: "AbortError" },
  )
})

test("CSV preview preserves irregular report records, whitespace, blank rows and quoted newlines", () => {
  assert.deepEqual(
    parseDocumentCsv(
      '\uFEFF Farm report\r\n\r\nitem,item,\r\n" First\nsecond ","a ""quote""",=1+2\r\n',
    ),
    {
      rows: [
        [" Farm report"],
        [""],
        ["item", "item", ""],
        [" First\nsecond ", 'a "quote"', "=1+2"],
      ],
      columns: 3,
    },
  )
  assert.deepEqual(parseDocumentCsv(""), { rows: [], columns: 0 })
  assert.deepEqual(parseDocumentCsv(" a , b \n"), {
    rows: [[" a ", " b "]],
    columns: 2,
  })
})

test("CSV preview rejects malformed records and enforces the inspected profile budgets", () => {
  for (const csv of ['"open', 'abc"quoted"', '"closed"oops'])
    assert.throws(() => parseDocumentCsv(csv), errorCode("invalid"))
  for (const csv of [
    "a".repeat(4001),
    new Array(201).fill("cell").join(","),
    "\n".repeat(25002),
    "é".repeat(1_000_001),
  ]) {
    assert.throws(() => parseDocumentCsv(csv), errorCode("tooLarge"))
  }
})

test("Markdown and JSON stay plain text while unknown formats have no active renderer", () => {
  const text = "<script>alert(1)</script>\n[link](https://example.com)"
  assert.deepEqual(
    documentPreview("text/markdown", new TextEncoder().encode(text)),
    { kind: "text", text },
  )
  assert.deepEqual(
    documentPreview("text/html", new TextEncoder().encode(text)),
    { kind: "unsupported" },
  )
  assert.deepEqual(
    documentPreview(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    ),
    { kind: "unsupported" },
  )
  assert.throws(
    () => documentPreview("text/plain", new Uint8Array([0xff])),
    errorCode("invalid"),
  )
})

test("Office preview requests the exact historical source and validates its response binding", async () => {
  const selected = {
    ...resolve({ versionId: "10" }).source,
    fileName: "records.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
  const signal = new AbortController().signal
  const preview = {
    kind: "xlsx",
    sheets: [
      { name: "Ledger", columns: 1, rows: [["<img>"]], truncated: false },
    ],
  }
  const body = {
    preview,
    sourceSha256: selected.checksum,
    sourceSize: selected.size,
  }
  assert.deepEqual(
    await readDocumentOfficePreview(
      selected,
      scope,
      async (path, init) => {
        assert.equal(
          path,
          `${oldVersion.url}?sha256=${checksum}&preview=true&documentId=1&versionId=10&companyId=3`,
        )
        assert.equal(init.cache, "no-store")
        assert.equal(init.signal, signal)
        return Response.json(body)
      },
      signal,
    ),
    preview,
  )
  for (const [response, code] of [
    [Response.json({ ...body, sourceSha256: "a".repeat(64) }), "integrity"],
    [Response.json({ ...body, sourceSize: selected.size + 1 }), "integrity"],
    [
      Response.json({ ...body, preview: { kind: "docx", blocks: [] } }),
      "invalid",
    ],
    [
      Response.json({
        ...body,
        preview: { ...preview, sheets: [{ ...preview.sheets[0], columns: 2 }] },
      }),
      "invalid",
    ],
    [new Response("revoked", { status: 403 }), "denied"],
    [new Response("malformed", { status: 422 }), "invalid"],
  ] as const) {
    await assert.rejects(
      readDocumentOfficePreview(selected, scope, async () => response, signal),
      errorCode(code),
    )
  }
})
