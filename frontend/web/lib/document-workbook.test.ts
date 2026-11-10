import assert from "node:assert/strict"
import test from "node:test"
import {
  DocumentViewerError,
  type DocumentViewerFetch,
} from "./document-viewer"
import {
  DocumentWorkbookError,
  readDocumentWorkbook,
} from "./document-workbook"

const signal = new AbortController().signal
const scope = { organizationId: 7n, companyId: 4n }
const identity = { documentId: "12", versionId: "18", checksum: "a".repeat(64) }
const source = {
  ...identity,
  fileName: "book.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  url: "/api/documents/blobs/object/7/eu/blob-id",
  size: 123,
  isCurrent: true,
}
const metadata = {
  ...identity,
  format: "xlsx",
  dateSystem: "1904",
  sheets: [
    {
      id: "0",
      name: "First",
      visibility: "visible",
      rowCount: 400,
      columnCount: 200,
    },
  ],
}
const rect = { rowStart: 1, rowCount: 2, columnStart: 0, columnCount: 3 }
const cell = {
  row: 1,
  column: 0,
  kind: "number",
  value: 9,
  displayValue: "9.00",
  formula: "=3*3",
  formulaStatus: "cached",
  numberFormat: "0.00",
  numberFormatId: 2,
}
const range = {
  ...identity,
  ...rect,
  sheetId: "0",
  cells: [cell],
  merges: [{ rowStart: 0, rowCount: 3, columnStart: 1, columnCount: 2 }],
}

function hasError(code: DocumentViewerError["code"]) {
  return (error: unknown) =>
    error instanceof DocumentViewerError && error.code === code
}

test("current workbook reads use the active scope and preserve sparse cells and merge extents", async () => {
  const requests: URL[] = []
  const fetcher: DocumentViewerFetch = async (path, options) => {
    assert.equal(options.signal, signal)
    assert.equal(options.cache, "no-store")
    assert.equal(options.redirect, "error")
    assert.equal(options.credentials, "include")
    const url = new URL(path, "https://example.com")
    assert.equal(url.searchParams.get("organizationId"), "7")
    assert.equal(url.searchParams.get("companyId"), "4")
    assert.equal(url.searchParams.get("checksum"), identity.checksum)
    requests.push(url)
    return Response.json(requests.length === 1 ? metadata : range)
  }
  const workbook = await readDocumentWorkbook(source, scope, fetcher, signal)
  assert.equal(workbook.versionId, identity.versionId)
  assert.equal(workbook.dateSystem, "1904")
  assert.deepEqual(await workbook.readRange("0", rect, signal), range)
  assert.equal(requests[0]?.pathname, "/api/documents/spreadsheet/12/current")
  assert.equal(
    requests[1]?.pathname,
    "/api/documents/spreadsheet/12/current/range",
  )
  for (const [key, value] of Object.entries({ sheetId: "0", ...rect })) {
    assert.equal(requests[1]?.searchParams.get(key), String(value))
  }
})

test("explicit workbook selection and search preserve the exact version even when it was current", async () => {
  const fetcher: DocumentViewerFetch = async (path) => {
    const url = new URL(path, "https://example.com")
    assert.equal(url.searchParams.has("companyId"), false)
    if (url.pathname.endsWith("/search")) {
      assert.equal(url.pathname, "/api/documents/spreadsheet/12/18/search")
      assert.equal(url.searchParams.get("sheetId"), "0")
      assert.equal(url.searchParams.get("query"), "=3*3")
      assert.equal(url.searchParams.get("direction"), "previous")
      assert.equal(url.searchParams.get("afterRow"), "0")
      assert.equal(url.searchParams.get("afterColumn"), "1")
      return Response.json({
        ...identity,
        match: { row: 1, column: 0 },
        wrapped: true,
      })
    }
    assert.equal(url.pathname, "/api/documents/spreadsheet/12/18")
    return Response.json(metadata)
  }
  const workbook = await readDocumentWorkbook(
    source,
    { ...scope, companyId: null },
    fetcher,
    signal,
    false,
  )
  const result = await workbook.search(
    "0",
    "=3*3",
    "previous",
    { row: 0, column: 1 },
    signal,
  )
  assert.deepEqual(result.match, { row: 1, column: 0 })
  assert.equal(result.wrapped, true)
})

test("workbook rejects stale identities even when a current version has identical bytes", async () => {
  await assert.rejects(
    readDocumentWorkbook(
      source,
      scope,
      async () => Response.json({ ...metadata, versionId: "19" }),
      signal,
    ),
    hasError("integrity"),
  )
  const workbook = await readDocumentWorkbook(
    source,
    scope,
    async (path) =>
      Response.json(
        path.includes("/range?")
          ? { ...range, checksum: "b".repeat(64) }
          : metadata,
      ),
    signal,
  )
  await assert.rejects(
    workbook.readRange("0", rect, signal),
    hasError("integrity"),
  )
})

test("workbook limits requests and rejects mismatched range cells", async () => {
  let calls = 0
  const workbook = await readDocumentWorkbook(
    source,
    scope,
    async () => {
      calls++
      return Response.json(
        calls === 1 ? metadata : { ...range, cells: [{ ...cell, row: 0 }] },
      )
    },
    signal,
  )
  await assert.rejects(
    workbook.readRange(
      "0",
      { ...rect, rowCount: 100, columnCount: 100 },
      signal,
    ),
    hasError("invalid"),
  )
  await assert.rejects(
    workbook.search("0", "é".repeat(129), "next", null, signal),
    hasError("invalid"),
  )
  assert.equal(calls, 1)
  await assert.rejects(
    workbook.readRange("0", rect, signal),
    hasError("invalid"),
  )
  assert.equal(calls, 2)
})

test("workbook rejects oversized or canceled metadata before decoding", async () => {
  await assert.rejects(
    readDocumentWorkbook(
      source,
      scope,
      async () =>
        new Response("{}", { headers: { "content-length": "1048576" } }),
      signal,
    ),
    hasError("tooLarge"),
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    readDocumentWorkbook(
      source,
      scope,
      async () => assert.fail("aborted fetch"),
      controller.signal,
    ),
    { name: "AbortError" },
  )
})

test("workbook keeps server failures distinct and identifies oversized range reads", async () => {
  for (const [status, reason] of [
    [415, "unsupported"],
    [422, "unreadable"],
    [503, "workerUnavailable"],
  ] as const) {
    await assert.rejects(
      readDocumentWorkbook(
        source,
        scope,
        async () => Response.json({ error: "internal detail" }, { status }),
        signal,
      ),
      (error: unknown) =>
        error instanceof DocumentWorkbookError && error.reason === reason,
    )
  }
  const workbook = await readDocumentWorkbook(
    source,
    scope,
    async (path) =>
      path.includes("/range?")
        ? new Response("{}", { headers: { "content-length": "9000000" } })
        : Response.json(metadata),
    signal,
  )
  await assert.rejects(
    workbook.readRange("0", rect, signal),
    (error: unknown) =>
      error instanceof DocumentWorkbookError &&
      error.reason === "rangeTooLarge",
  )
})

test("workbook validates metadata merges and recovers oversized tiles without duplicating merges", async () => {
  const merge = { rowStart: 0, rowCount: 4, columnStart: 0, columnCount: 3 }
  const mergedMetadata = {
    ...metadata,
    sheets: [{ ...metadata.sheets[0], merges: [merge] }],
  }
  await assert.rejects(
    readDocumentWorkbook(
      source,
      scope,
      async () =>
        Response.json({
          ...mergedMetadata,
          sheets: [
            {
              ...mergedMetadata.sheets[0],
              merges: [{ ...merge, columnStart: 199 }],
            },
          ],
        }),
      signal,
    ),
    hasError("invalid"),
  )

  const tileStarts: number[] = []
  const workbook = await readDocumentWorkbook(
    source,
    scope,
    async (path) => {
      if (!path.includes("/range?")) return Response.json(mergedMetadata)
      const query = new URL(path, "https://example.com").searchParams
      const columnStart = Number(query.get("columnStart"))
      const columnCount = Number(query.get("columnCount"))
      tileStarts.push(columnStart)
      if (columnCount === rect.columnCount)
        return new Response(null, { status: 413 })
      return Response.json({
        ...range,
        columnStart,
        columnCount,
        cells: [{ ...cell, column: columnStart }],
        merges: [merge],
      })
    },
    signal,
  )
  const result = await workbook.readRange("0", rect, signal)
  assert.deepEqual(workbook.sheets[0]?.merges, [merge])
  assert.deepEqual(tileStarts, [0, 0, 1])
  assert.equal(result.columnCount, rect.columnCount)
  assert.deepEqual(result.merges, [merge])
  assert.deepEqual(
    result.cells.map((value) => value.column),
    [0, 1],
  )
})
