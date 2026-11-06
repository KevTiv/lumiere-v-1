import assert from "node:assert/strict"
import { test } from "node:test"
import {
  accountMoveBundleMappings,
  accountMoveBundleToken,
  buildBundleParentCsv,
  markAccountMoveBundleParentCsv,
  parseCsvText,
  splitAccountMoveImportCsv,
} from "@lumiere/erp-shared"
import type { CsvImportReceipt } from "@lumiere/query-hooks/hooks/csv-import-request"
import { runAccountMoveBundleImport } from "./account-move-bundle-import"

function fixture(reference = "source-electricity") {
  const source = parseCsvText(
    `journal_id,ref_,date,account_id,debit,credit\n1,${reference},2024-05-18,31,"1 250,50",0\n1,${reference},2024-05-18,32,0,"1 250,50"`,
  )
  const mappings = accountMoveBundleMappings(source.headers)
  const split = splitAccountMoveImportCsv({ ...source, ...mappings, parentLinkSourceColumn: "ref_" })
  const parent = buildBundleParentCsv(split.parentHeaders, split.parentRows, mappings.parentMapping)
  const markedParentCsv = markAccountMoveBundleParentCsv(parent)
  const metadata = parseCsvText(markedParentCsv)
  const moves = [{
    id: "9007199254740993",
    companyId: "5",
    journalId: "1",
    date: { microsSinceUnixEpoch: String(Date.UTC(2024, 4, 18) * 1000) },
    state: { tag: "Draft" },
    metadata: metadata.rows[0]![metadata.headers.indexOf("metadata")],
  }]
  const lines = [
    { id: "71", companyId: "5", moveId: moves[0]!.id, journalId: "1", accountId: "31", debit: 1250.5, credit: 0 },
    { id: "72", companyId: "5", moveId: moves[0]!.id, journalId: "1", accountId: "32", debit: 0, credit: 1250.5 },
  ]
  const receipts = new Map<string, CsvImportReceipt>()
  const calls: string[] = []
  const options: Parameters<typeof runAccountMoveBundleImport>[0] = {
    organizationId: 2n,
    companyId: 5n,
    fileNamePrefix: "journal-entry",
    bundleToken: accountMoveBundleToken(parent),
    markedParentCsv,
    headers: source.headers,
    lineRows: split.lineRows,
    lineMapping: mappings.lineMapping,
    lookup: async (request) => receipts.get(request.requestId) ?? null,
    submit: async (request) => {
      assert.equal(request.companyId, "5")
      calls.push(request.entity)
      const isParent = request.entity === "account_move"
      const imported = isParent ? moves : lines
      if (!isParent) {
        const parsed = parseCsvText(request.csvData)
        assert.deepEqual(parsed.rows.map((row) => row[parsed.headers.indexOf("move_id")]), [moves[0]!.id, moves[0]!.id])
      }
      const receipt: CsvImportReceipt = {
        ok: true,
        entity: request.entity,
        requestId: request.requestId,
        jobId: isParent ? "11" : "12",
        status: "success",
        totalRows: imported.length,
        rowsImported: imported.length,
        errorRows: 0,
        errors: [],
        errorsRedacted: false,
        records: imported.map((row, i) => ({ recordId: row.id, rowNumber: i + 2 })),
      }
      receipts.set(request.requestId, receipt)
      return receipt
    },
    readMoves: async () => moves,
    readLines: async () => lines,
  }
  return { options, calls, moves, lines }
}

test("resumes a lost header or line response using the same receipt and native IDs", async () => {
  for (const entity of ["account_move", "account_move_line"]) {
    const { options, calls } = fixture()
    const submit = options.submit
    options.submit = async (request) => {
      const saved = await submit(request)
      if (request.entity === entity) throw new Error("Response was lost after save")
      return saved
    }
    await assert.rejects(runAccountMoveBundleImport(options), /Response was lost/)
    const ids = await runAccountMoveBundleImport(options)
    assert.deepEqual([...ids], [["source-electricity", "9007199254740993"]])
    await runAccountMoveBundleImport(options)
    assert.deepEqual(calls, ["account_move", "account_move_line"])
  }
})

test("recovers a reused draft from its exact marker even when the list omits its reference", async () => {
  const { options, moves } = fixture()
  const submit = options.submit
  options.submit = async (request) => {
    const saved = await submit(request)
    if (request.entity === "account_move") saved.records = []
    return saved
  }
  options.readMoves = async () => [
    { ...moves[0]!, id: "600", companyId: "6" },
    ...moves,
  ]
  const ids = await runAccountMoveBundleImport(options)
  assert.equal(ids.get("source-electricity"), moves[0]!.id)
})

test("does not report completion for wrong-company or changed saved lines", async () => {
  const { options, lines } = fixture()
  options.readLines = async () => lines.map((line) => ({ ...line, companyId: "6" }))
  await assert.rejects(runAccountMoveBundleImport(options), /Could not verify the saved journals/)
  options.readLines = async () => lines.map((line) => ({ ...line, accountId: "92" }))
  await assert.rejects(runAccountMoveBundleImport(options), /does not match row/)
})

test("separate source references allow repeat transactions with identical amounts", async () => {
  const keys = new Set<string>()
  for (const reference of ["receipt-1", "receipt-2"]) {
    const { options } = fixture(reference)
    const submit = options.submit
    options.submit = async (request) => {
      keys.add(request.requestId)
      return submit(request)
    }
    assert.ok((await runAccountMoveBundleImport(options)).has(reference))
  }
  assert.equal(keys.size, 4)
})

test("does not start a new request after a partial line receipt", async () => {
  const { options, calls } = fixture()
  const submit = options.submit
  options.submit = async (request) => {
    const receipt = await submit(request)
    if (request.entity === "account_move_line") {
      receipt.status = "partial"
      receipt.rowsImported = 1
      receipt.errorRows = 1
      receipt.records = undefined
    }
    return receipt
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(runAccountMoveBundleImport(options), /partial with 1 of 2 rows saved/)
  }
  assert.deepEqual(calls, ["account_move", "account_move_line"])
})

test("retries a known rejected line stage after the reducer removed its empty drafts", async () => {
  const { options, calls, moves, lines } = fixture()
  let compensated = false
  let visible = true
  const submit = options.submit
  options.readMoves = async () => visible ? moves : []
  options.submit = async (request) => {
    if (request.entity === "account_move" && compensated) {
      visible = true
      moves[0]!.id = "33"
      lines.forEach((line) => { line.moveId = "33" })
    }
    const receipt = await submit(request)
    if (request.entity === "account_move_line" && !compensated) {
      receipt.status = "failed"
      receipt.rowsImported = 0
      receipt.errorRows = 2
      receipt.records = undefined
      compensated = true
      visible = false
    }
    return receipt
  }
  await assert.rejects(runAccountMoveBundleImport(options), /failed with 0 of 2 rows saved/)
  const ids = await runAccountMoveBundleImport(options)
  assert.equal(ids.get("source-electricity"), "33")
  assert.deepEqual(calls, ["account_move", "account_move_line", "account_move", "account_move_line"])
})
