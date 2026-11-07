import {
  ACCOUNT_MOVE_BUNDLE_METADATA_KEY,
  buildAccountMoveLineCsv,
  markAccountMoveBundleLineCsv,
  parseAccountingImportNumber,
  parseCsvText,
  type ColumnMappingMap,
} from "@lumiere/erp-shared"
import { isoToDate, microsToDate, stdbTimestampToDate } from "@lumiere/erp-shared/timestamp-values"
import { variantTag } from "@lumiere/erp-workflows"
import {
  createCsvImportRequest,
  type CsvImportReceipt,
  type CsvImportRequest,
} from "@lumiere/query-hooks/hooks/csv-import-request"

type Id = bigint | number | string
type ScopedRecord = { id: Id; companyId: Id }
type Move = ScopedRecord & { journalId?: Id | null; date?: unknown; state?: unknown; metadata?: string | null }
type Line = ScopedRecord & { moveId: Id; accountId: Id; journalId?: Id | null; debit?: number | null; credit?: number | null }

type BundleImportArgs = {
  organizationId: bigint
  companyId: bigint
  fileNamePrefix: string
  bundleToken: string
  markedParentCsv: string
  headers: string[]
  lineRows: string[][]
  lineMapping: ColumnMappingMap
  resumeIds?: Map<string, string>
  lookup: (request: CsvImportRequest, contentSha256: string) => Promise<CsvImportReceipt | null>
  submit: (request: CsvImportRequest) => Promise<CsvImportReceipt>
  readMoves: () => Promise<Move[]>
  readLines: () => Promise<Line[]>
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function bundleRequest(
  args: BundleImportArgs,
  entity: "account_move" | "account_move_line",
  csv: string,
  previousJobId: string,
): Promise<{ request: CsvImportRequest; contentHash: string }> {
  const fileName = `${args.fileNamePrefix}-${entity === "account_move" ? "headers" : "lines"}.csv`
  const contentHash = await sha256(csv)
  const key = JSON.stringify([
    "accounting-csv-bundle-v1", String(args.organizationId), String(args.companyId),
    entity, fileName, previousJobId, contentHash,
  ])
  const requestId = (await sha256(key)).slice(0, 32)
  const request = createCsvImportRequest(args.organizationId, entity, csv, fileName, { companyId: args.companyId }, requestId)
  return { request, contentHash }
}

function assertSucceeded(receipt: CsvImportReceipt, stage: string, expectedRows: number): void {
  if (receipt.status === "success" && receipt.errorRows === 0 &&
    receipt.rowsImported === expectedRows && receipt.totalRows === expectedRows) return
  const detail = receipt.errors[0]?.errorMessage ?? "Review the import job before retrying."
  throw new Error(`${stage} import job #${receipt.jobId} returned ${receipt.status} with ${receipt.rowsImported} of ${expectedRows} rows saved. ${detail}`)
}

function rejected(receipt: CsvImportReceipt | null): receipt is CsvImportReceipt & { status: "failed" | "rolled_back" } {
  return receipt?.status === "failed" || receipt?.status === "rolled_back"
}

function markerFingerprint(metadata: string | null | undefined, token: string): string | undefined {
  try {
    const marker = JSON.parse(metadata ?? "")?.extra?.[ACCOUNT_MOVE_BUNDLE_METADATA_KEY]
    if (marker?.version === 1 && marker.token === token && typeof marker.fingerprint === "string") {
      return marker.fingerprint
    }
  } catch {
    // Ordinary moves may have text metadata and cannot identify bundle parents.
  }
}

async function resolveParentIds(
  args: BundleImportArgs,
  receipt: CsvImportReceipt,
  parsed: ReturnType<typeof parseCsvText>,
): Promise<Map<string, string>> {
  const byRow = new Map(receipt.records?.map(({ rowNumber, recordId }) => [rowNumber, recordId]))
  const previousMoves = byRow.size === parsed.rows.length ? [] : await args.readMoves()
  const refIndex = parsed.headers.indexOf("ref_")
  const metadataIndex = parsed.headers.indexOf("metadata")
  const ids = new Map<string, string>()
  for (const [index, row] of parsed.rows.entries()) {
    const reference = row[refIndex]?.trim()
    if (!reference || ids.has(reference)) throw new Error("Invalid journal import reference")
    let id = byRow.get(index + 2)
    if (!id) {
      // An interrupted bundle from an earlier client may be reused by the
      // reducer. Only newly inserted IDs belong to this receipt.
      const fingerprint = markerFingerprint(row[metadataIndex], args.bundleToken)
      const matches = previousMoves.filter((move) => String(move.companyId) === String(args.companyId) &&
        fingerprint !== undefined && markerFingerprint(move.metadata, args.bundleToken) === fingerprint)
      if (matches.length !== 1) throw new Error(`Could not verify the saved journal header for "${reference}"`)
      id = String(matches[0]!.id)
    }
    ids.set(reference, id)
  }
  if (new Set(ids.values()).size !== ids.size) throw new Error("Journal import resolved the same header more than once")
  return ids
}

function scopedById<Row extends ScopedRecord>(rows: Row[], companyId: bigint): Map<string, Row> {
  return new Map(rows.filter((row) => String(row.companyId) === String(companyId)).map((row) => [String(row.id), row]))
}

async function verifyBundle(
  args: BundleImportArgs,
  ids: Map<string, string>,
  receipt: CsvImportReceipt,
  parsed: ReturnType<typeof parseCsvText>,
  parents: ReturnType<typeof parseCsvText>,
): Promise<void> {
  const [moves, lines] = await Promise.all([args.readMoves(), args.readLines()])
  const movesById = scopedById(moves, args.companyId)
  const linesById = scopedById(lines, args.companyId)
  const moveIds = new Set(ids.values())
  const refIndex = parents.headers.indexOf("ref_")
  const journalIndex = parents.headers.indexOf("journal_id")
  const dateIndex = parents.headers.indexOf("date")
  const journalsMatch = parents.rows.every((row) => {
    const id = ids.get(row[refIndex]?.trim() ?? "")
    const saved = id && movesById.get(id)
    if (!saved || !sameId(saved.journalId, row[journalIndex])) return false
    const state = variantTag(saved.state).toLowerCase()
    const sourceDate = row[dateIndex]?.trim() ?? ""
    const expectedDate = /^[+-]?[0-9]+$/.test(sourceDate) ? microsToDate(sourceDate) : isoToDate(sourceDate)
    const savedDate = stdbTimestampToDate(saved.date) ?? (typeof saved.date === "string" ? isoToDate(saved.date) : null)
    return (state === "draft" || state === "posted") && expectedDate != null && savedDate?.getTime() === expectedDate.getTime()
  })
  const savedLineCount = [...linesById.values()].filter((line) => moveIds.has(String(line.moveId))).length
  if (!journalsMatch || savedLineCount !== parsed.rows.length || receipt.records?.length !== parsed.rows.length) {
    throw new Error(`Could not verify the saved journals for import job #${receipt.jobId}. Retry this file to check the same records.`)
  }
  const moveIndex = parsed.headers.indexOf("move_id")
  const accountIndex = parsed.headers.indexOf("account_id")
  const debitIndex = parsed.headers.indexOf("debit")
  const creditIndex = parsed.headers.indexOf("credit")
  for (const record of receipt.records) {
    const expected = parsed.rows[record.rowNumber - 2]
    const saved = linesById.get(record.recordId)
    if (!saved || !expected || !moveIds.has(String(saved.moveId)) ||
      !sameId(saved.moveId, expected[moveIndex]) ||
      !sameId(saved.accountId, expected[accountIndex]) ||
      String(saved.journalId) !== String(movesById.get(String(saved.moveId))?.journalId) ||
      saved.debit !== (parseAccountingImportNumber(expected[debitIndex] ?? "") ?? 0) ||
      saved.credit !== (parseAccountingImportNumber(expected[creditIndex] ?? "") ?? 0)) {
      throw new Error(`Saved journal line ${record.recordId} does not match row ${record.rowNumber} of import job #${receipt.jobId}.`)
    }
  }
}

function sameId(saved: Id | null | undefined, source: string | undefined): boolean {
  const value = source?.trim() ?? ""
  return /^\+?[0-9]+$/.test(value) && String(saved) === BigInt(value).toString()
}

/** An unknown response retains its exact request key. Only a known terminal failure permits a new attempt. */
export async function runAccountMoveBundleImport(args: BundleImportArgs): Promise<Map<string, string>> {
  const parents = parseCsvText(args.markedParentCsv)
  let previousParentJobId = ""
  let resumeIds = args.resumeIds
  for (let parentAttempt = 0; parentAttempt < 20; parentAttempt += 1) {
    let parent: CsvImportReceipt | null = null
    let ids = resumeIds
    if (!ids) {
      const { request, contentHash } = await bundleRequest(args, "account_move", args.markedParentCsv, previousParentJobId)
      const prior = await args.lookup(request, contentHash)
      if (rejected(prior)) {
        previousParentJobId = prior.jobId
        continue
      }
      parent = prior ?? await args.submit(request)
      assertSucceeded(parent, "Journal header", parents.rows.length)
      ids = await resolveParentIds(args, parent, parents)
    }
    const lineCsv = markAccountMoveBundleLineCsv(
      buildAccountMoveLineCsv(args.headers, args.lineRows, args.lineMapping, ids),
      args.bundleToken,
    )
    const lines = parseCsvText(lineCsv)
    let previousLineJobId = ""
    for (let lineAttempt = 0; lineAttempt < 20; lineAttempt += 1) {
      const { request, contentHash } = await bundleRequest(args, "account_move_line", lineCsv, previousLineJobId)
      const prior = await args.lookup(request, contentHash)
      if (rejected(prior)) {
        const moves = scopedById(await args.readMoves(), args.companyId)
        const present = [...ids.values()].filter((id) => moves.has(id)).length
        if (present === 0 && parent) {
          // Failed line import can compensate by removing all unchanged empty drafts.
          previousParentJobId = parent.jobId
          resumeIds = undefined
          break
        }
        if (present !== ids.size) throw new Error("Some journal headers are missing. Review the import job before retrying.")
        previousLineJobId = prior.jobId
        continue
      }
      const receipt = prior ?? await args.submit(request)
      assertSucceeded(receipt, "Journal line", lines.rows.length)
      await verifyBundle(args, ids, receipt, lines, parents)
      return ids
    }
    if (parent?.jobId !== previousParentJobId) break
  }
  throw new Error("The journal bundle exceeded its retry limit. Review the import jobs before continuing.")
}
