/** Read only the versioned source evidence already present in an authorized record. */
export interface RecordImportSource {
  file: string
  row: number
  rowBasis: "source_line" | "import_row"
  sha256: string
  batchId: string
  itemId: string
  revision: number
  reason: string | null
}

interface SourceEnvelope {
  some?: unknown
  source_review?: unknown
}

interface SourceCandidate {
  version?: unknown
  source_file?: unknown
  source_row?: unknown
  source_sha256?: unknown
  row_basis?: unknown
  batch_id?: unknown
  item_id?: unknown
  revision?: unknown
  decision_reason?: unknown
}

function sourceEnvelope(value: unknown): value is SourceEnvelope {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sourceCandidate(value: unknown): value is SourceCandidate {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function positiveReviewId(value: unknown): value is string {
  // Review batch/item IDs are PostgreSQL bigint values serialized as decimal text.
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

export function parseRecordImportSource(metadata: unknown): RecordImportSource | null {
  // HTTP rows normally contain a string; tolerate the native Option wrapper too.
  let raw = metadata
  if (sourceEnvelope(raw) && Object.keys(raw).length === 1 && "some" in raw) raw = raw.some
  if (typeof raw === "string") {
    if (raw.length > 131_072) return null
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!sourceEnvelope(raw) || !Object.hasOwn(raw, "source_review")) return null
  const source = raw.source_review
  if (
    !sourceCandidate(source) ||
    source.version !== 1 ||
    typeof source.source_file !== "string" ||
    !source.source_file.trim() ||
    source.source_file.length > 4096 ||
    !positiveInteger(source.source_row) ||
    !positiveReviewId(source.batch_id) ||
    !positiveReviewId(source.item_id) ||
    !positiveInteger(source.revision) ||
    typeof source.source_sha256 !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(source.source_sha256) ||
    (source.row_basis !== "source_line" && source.row_basis !== "import_row")
  ) return null

  return {
    file: source.source_file,
    row: source.source_row,
    rowBasis: source.row_basis,
    sha256: source.source_sha256,
    batchId: source.batch_id,
    itemId: source.item_id,
    revision: source.revision,
    reason: typeof source.decision_reason === "string" && source.decision_reason.trim() && source.decision_reason.length <= 4096
      ? source.decision_reason
      : null,
  }
}
