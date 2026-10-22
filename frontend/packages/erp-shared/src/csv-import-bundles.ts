import {
  buildCanonicalCsv,
  escapeCsvField,
  type ColumnMappingMap,
} from "./csv-import-transform"
import { parseCsvText } from "./csv-import-safety"
import {
  assertDebitCreditRowsBalanced,
  type DebitCreditReconciliationReport,
} from "./accounting-import-reconciliation"

export type ImportBundleDefinition = {
  key: string
  parentEntity: string
  lineEntity: string
  /** Canonical parent field used to group rows (e.g. client_order_ref). */
  parentLinkField: string
  /** Aliases for detecting the parent link source column in flat CSV. */
  parentLinkAliases: readonly string[]
  /** Line reducer field populated after parent import. Legacy property name retained for callers. */
  lineOrderIdField: string
}

export const SALE_ORDER_IMPORT_BUNDLE: ImportBundleDefinition = {
  key: "sale_order_bundle",
  parentEntity: "sale_order",
  lineEntity: "sale_order_line",
  parentLinkField: "client_order_ref",
  parentLinkAliases: [
    "client_order_ref",
    "reference",
    "order_ref",
    "orderref",
    "po",
    "so_number",
  ],
  lineOrderIdField: "order_id",
}

/**
 * Historical journal entries use the human-owned source reference while the
 * parent move is being created, then replace it with the generated move id on
 * every line. This avoids requiring users to know Lumiere database ids.
 */
export const ACCOUNT_MOVE_IMPORT_BUNDLE: ImportBundleDefinition = {
  key: "account_move_bundle",
  parentEntity: "account_move",
  lineEntity: "account_move_line",
  parentLinkField: "ref_",
  parentLinkAliases: [
    "ref_",
    "reference",
    "journal_reference",
    "journal_ref",
    "invoice_reference",
    "invoice_number",
    "source_reference",
    "external_reference",
  ],
  lineOrderIdField: "move_id",
}

/** Canonical fields required by the combined historical journal header/line import. */
export const ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS = [
  "journal_id",
  "ref_",
  "date",
  "account_id",
  "debit",
  "credit",
] as const

/** Distinct flat-file columns for fields that exist on both move and line rows. */
export const ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS = {
  moveName: "move_name",
  lineName: "line_name",
  moveOpeningResidual: "move_opening_residual",
  lineOpeningResidual: "line_opening_residual",
} as const

export const ACCOUNT_MOVE_BUNDLE_METADATA_KEY = "lumiere_account_move_bundle"

type JsonObject = { [key: string]: unknown }

function bundleFingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `v1-${hash.toString(16).padStart(16, "0")}`
}

function mergeAccountMoveBundleMetadata(
  raw: string,
  marker: JsonObject,
): string {
  let metadata: JsonObject = {}
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as JsonObject
      } else {
        metadata.lumiere_preserved_user_metadata = raw
      }
    } catch {
      metadata.lumiere_preserved_user_metadata = raw
    }
  }
  const originalExtraPresent = Object.prototype.hasOwnProperty.call(metadata, "extra")
  const originalExtra = metadata.extra
  const priorExtra =
    originalExtra && typeof originalExtra === "object" && !Array.isArray(originalExtra)
      ? (originalExtra as JsonObject)
      : {}
  if (Object.prototype.hasOwnProperty.call(priorExtra, ACCOUNT_MOVE_BUNDLE_METADATA_KEY)) {
    throw new Error(
      `metadata.extra.${ACCOUNT_MOVE_BUNDLE_METADATA_KEY} is reserved for journal bundle imports`,
    )
  }
  return JSON.stringify({
    ...metadata,
    extra: {
      ...priorExtra,
      [ACCOUNT_MOVE_BUNDLE_METADATA_KEY]: {
        ...marker,
        original_extra_present: originalExtraPresent,
        original_extra: originalExtraPresent ? originalExtra : null,
      },
    },
  })
}

/** Mark bundle parents so the server can compensate a failed line stage and reuse interrupted drafts. */
export function markAccountMoveBundleParentCsv(csv: string): string {
  const parsed = parseCsvText(csv)
  const token = accountMoveBundleToken(csv)
  const headers = [...parsed.headers]
  let metadataIndex = headers.indexOf("metadata")
  if (metadataIndex < 0) {
    metadataIndex = headers.length
    headers.push("metadata")
  }
  const refIndex = headers.indexOf("ref_")
  if (refIndex < 0) throw new Error("Journal bundle parent CSV is missing ref_")

  const rows = parsed.rows.map((inputRow) => {
    const row = [...inputRow]
    while (row.length < headers.length) row.push("")
    const rawMetadata = row[metadataIndex] ?? ""
    const fingerprint = bundleFingerprint(
      JSON.stringify({ ref: row[refIndex] ?? "", headers: parsed.headers, row: inputRow }),
    )
    row[metadataIndex] = mergeAccountMoveBundleMetadata(rawMetadata, {
      version: 1,
      token,
      fingerprint,
    })
    return row
  })
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvField(value)).join(","))
    .join("\n")
}

export function accountMoveBundleToken(parentCsv: string): string {
  return bundleFingerprint(parentCsv)
}

/** Carry the request token into line metadata so only this bundle can consume its parents. */
export function markAccountMoveBundleLineCsv(csv: string, token: string): string {
  const parsed = parseCsvText(csv)
  const headers = [...parsed.headers]
  let metadataIndex = headers.indexOf("metadata")
  if (metadataIndex < 0) {
    metadataIndex = headers.length
    headers.push("metadata")
  }
  const rows = parsed.rows.map((inputRow) => {
    const row = [...inputRow]
    while (row.length < headers.length) row.push("")
    row[metadataIndex] = mergeAccountMoveBundleMetadata(row[metadataIndex] ?? "", {
      version: 1,
      token,
    })
    return row
  })
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvField(value)).join(","))
    .join("\n")
}

/** Combined historical journal template contract. Required and optional are disjoint. */
export const ACCOUNT_MOVE_BUNDLE_COLUMNS = {
  required: ACCOUNT_MOVE_BUNDLE_REQUIRED_FIELDS,
  optional: [
    "currency_id",
    "move_type",
    ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveName,
    "invoice_date",
    "invoice_date_due",
    "invoice_payment_term_id",
    "invoice_origin",
    "payment_reference",
    "partner_id",
    "amount_untaxed",
    "amount_tax",
    "amount_total",
    "metadata",
    "sequence",
    ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineName,
    "quantity",
    "price_unit",
    "tax_ids",
    "analytic_account_id",
    "product_id",
    "product_uom_id",
    "cogs_amount",
  ] as const,
} as const

const ACCOUNT_MOVE_PARENT_SOURCE_FIELDS = [
  "journal_id",
  "ref_",
  "date",
  "currency_id",
  "move_type",
  "invoice_date",
  "invoice_date_due",
  "invoice_payment_term_id",
  "invoice_origin",
  "payment_reference",
  "partner_id",
  "amount_untaxed",
  "amount_tax",
  "amount_total",
  "metadata",
] as const

const ACCOUNT_MOVE_LINE_SOURCE_FIELDS = [
  "account_id",
  "debit",
  "credit",
  "currency_id",
  "date",
  "ref_",
  "sequence",
  "quantity",
  "price_unit",
  "tax_ids",
  "partner_id",
  "analytic_account_id",
  "product_id",
  "product_uom_id",
  "cogs_amount",
  "metadata",
] as const

/** Map the bundle-only name columns to each reducer's canonical `name` field. */
export function accountMoveBundleMappings(headers: readonly string[]): {
  parentMapping: ColumnMappingMap
  lineMapping: ColumnMappingMap
} {
  const available = new Set(headers)
  const mappingFor = (fields: readonly string[]): ColumnMappingMap =>
    Object.fromEntries(
      fields.filter((field) => available.has(field)).map((field) => [field, field]),
    )
  const parentMapping = mappingFor(ACCOUNT_MOVE_PARENT_SOURCE_FIELDS)
  const lineMapping = mappingFor(ACCOUNT_MOVE_LINE_SOURCE_FIELDS)
  if (available.has(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveName)) {
    parentMapping[ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveName] = "name"
  }
  if (available.has(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineName)) {
    lineMapping[ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineName] = "name"
  }
  if (available.has(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveOpeningResidual)) {
    parentMapping[ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.moveOpeningResidual] = "opening_residual"
  }
  if (available.has(ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineOpeningResidual)) {
    lineMapping[ACCOUNT_MOVE_BUNDLE_SOURCE_COLUMNS.lineOpeningResidual] = "opening_residual"
  }
  return { parentMapping, lineMapping }
}

export const IMPORT_BUNDLES: readonly ImportBundleDefinition[] = [
  SALE_ORDER_IMPORT_BUNDLE,
  ACCOUNT_MOVE_IMPORT_BUNDLE,
]

export function importBundleForParentEntity(
  parentEntity: string,
): ImportBundleDefinition | undefined {
  return IMPORT_BUNDLES.find((bundle) => bundle.parentEntity === parentEntity)
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

export function detectParentLinkSourceColumn(
  headers: string[],
  mapping: ColumnMappingMap,
  bundle: ImportBundleDefinition,
): string | undefined {
  for (const [source, target] of Object.entries(mapping)) {
    if (target === bundle.parentLinkField) return source
  }
  for (const header of headers) {
    const normalized = normalizeHeader(header)
    if (
      bundle.parentLinkAliases.some(
        (alias) => normalizeHeader(alias) === normalized,
      )
    ) {
      return header
    }
  }
  return undefined
}

export type SplitImportBundleArgs = {
  headers: string[]
  rows: string[][]
  parentMapping: ColumnMappingMap
  lineMapping: ColumnMappingMap
  parentLinkSourceColumn: string
  /** Fail on blank references and conflicting parent data instead of skipping them. */
  strictParentReferences?: boolean
}

export type SplitImportBundleResult = {
  parentHeaders: string[]
  parentRows: string[][]
  lineHeaders: string[]
  lineRows: string[][]
  parentLinkValues: string[]
}

export type SplitAccountMoveImportResult = SplitImportBundleResult & {
  reconciliation: DebitCreditReconciliationReport
}

export type ImportBundleValidationIssue = {
  code:
    | "missing_parent_reference"
    | "conflicting_parent_reference"
    | "existing_parent_reference"
    | "unresolved_parent_reference"
    | "duplicate_resolved_parent_reference"
    | "missing_resolved_parent_reference"
  message: string
  reference?: string
  rowNumbers?: number[]
}

export class ImportBundleValidationError extends Error {
  readonly issues: readonly ImportBundleValidationIssue[]

  constructor(issues: readonly ImportBundleValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "))
    this.name = "ImportBundleValidationError"
    this.issues = issues
  }
}

function mappedParentSignature(
  row: readonly string[],
  headerIndex: Record<string, number>,
  parentMapping: ColumnMappingMap,
): string {
  const values = Object.entries(parentMapping)
    .filter(([, target]) => Boolean(target) && target !== "__skip__")
    .map(
      ([source, target]) =>
        [
          target.toLowerCase(),
          (row[headerIndex[source] ?? -1] ?? "").trim(),
        ] as const,
    )
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(values)
}

/** Split a flat CSV into deduplicated parent rows and line rows linked by parent ref. */
export function splitImportBundleCsv(
  args: SplitImportBundleArgs,
): SplitImportBundleResult {
  const {
    headers,
    rows,
    parentMapping,
    lineMapping,
    parentLinkSourceColumn,
    strictParentReferences = false,
  } = args
  const headerIndex = Object.fromEntries(
    headers.map((header, index) => [header, index]),
  )
  const linkIndex = headerIndex[parentLinkSourceColumn]
  if (linkIndex == null) {
    throw new Error(
      `Parent link column "${parentLinkSourceColumn}" not found in CSV headers`,
    )
  }

  const parentHeaders = [...headers]
  const parentRows: string[][] = []
  const lineHeaders = [...headers, "__parent_ref"]
  const lineRows: string[][] = []
  const parentLinkValues: string[] = []
  const seenParentKeys = new Set<string>()
  const parentSignatureByKey = new Map<
    string,
    { signature: string; firstRowNumber: number }
  >()
  const issues: ImportBundleValidationIssue[] = []

  for (const [rowIndex, row] of rows.entries()) {
    const rowNumber = rowIndex + 2
    const linkValue = (row[linkIndex] ?? "").trim()
    if (!linkValue) {
      if (strictParentReferences) {
        issues.push({
          code: "missing_parent_reference",
          message: `Row ${rowNumber} is missing a parent reference in "${parentLinkSourceColumn}"`,
          rowNumbers: [rowNumber],
        })
      }
      continue
    }

    if (!seenParentKeys.has(linkValue)) {
      seenParentKeys.add(linkValue)
      parentLinkValues.push(linkValue)
      parentRows.push([...row])
      if (strictParentReferences) {
        parentSignatureByKey.set(linkValue, {
          signature: mappedParentSignature(row, headerIndex, parentMapping),
          firstRowNumber: rowNumber,
        })
      }
    } else if (strictParentReferences) {
      const previous = parentSignatureByKey.get(linkValue)
      const signature = mappedParentSignature(row, headerIndex, parentMapping)
      if (previous && previous.signature !== signature) {
        issues.push({
          code: "conflicting_parent_reference",
          message: `Rows ${previous.firstRowNumber} and ${rowNumber} contain conflicting parent values for reference "${linkValue}"`,
          reference: linkValue,
          rowNumbers: [previous.firstRowNumber, rowNumber],
        })
      }
    }

    if (Object.keys(lineMapping).length > 0) {
      lineRows.push([...row, linkValue])
    }
  }

  if (issues.length > 0) throw new ImportBundleValidationError(issues)

  return { parentHeaders, parentRows, lineHeaders, lineRows, parentLinkValues }
}

/** Strictly split and reconcile a flat historical journal CSV. */
export function splitAccountMoveImportCsv(
  args: Omit<SplitImportBundleArgs, "strictParentReferences"> & {
    tolerance?: number
  },
): SplitAccountMoveImportResult {
  const split = splitImportBundleCsv({ ...args, strictParentReferences: true })
  const reconciliation = assertDebitCreditRowsBalanced({
    headers: args.headers,
    rows: args.rows,
    lineMapping: args.lineMapping,
    parentReferenceSourceColumn: args.parentLinkSourceColumn,
    tolerance: args.tolerance,
  })
  return { ...split, reconciliation }
}

export function buildBundleParentCsv(
  headers: string[],
  rows: string[][],
  parentMapping: ColumnMappingMap,
): string {
  return buildCanonicalCsv(headers, rows, parentMapping)
}

export function buildBundleLineCsv(
  headers: string[],
  lineRows: string[][],
  lineMapping: ColumnMappingMap,
  orderIdByRef: Map<string, string>,
  bundle: ImportBundleDefinition,
  options: { requireAllParentReferences?: boolean } = {},
): string {
  const augmentedHeaders = [...headers, bundle.lineOrderIdField]
  const augmentedRows: string[][] = []
  const unresolved = new Map<string, number[]>()

  for (const [rowIndex, row] of lineRows.entries()) {
    const ref = (row[headers.length] ?? "").trim()
    const orderId = orderIdByRef.get(ref)
    if (!orderId) {
      if (options.requireAllParentReferences) {
        const rowNumbers = unresolved.get(ref) ?? []
        rowNumbers.push(rowIndex + 2)
        unresolved.set(ref, rowNumbers)
      }
      continue
    }
    augmentedRows.push([...row.slice(0, headers.length), orderId])
  }

  if (unresolved.size > 0) {
    throw new ImportBundleValidationError(
      [...unresolved.entries()].map(([reference, rowNumbers]) => ({
        code: "unresolved_parent_reference" as const,
        message: `No imported parent id was found for reference "${reference}" (line rows ${rowNumbers.join(", ")})`,
        reference,
        rowNumbers,
      })),
    )
  }

  return buildCanonicalCsv(augmentedHeaders, augmentedRows, {
    ...lineMapping,
    [bundle.lineOrderIdField]: bundle.lineOrderIdField,
  })
}

export type SaleOrderLinkRow = {
  id?: number | string
  clientOrderRef?: string | null
  client_order_ref?: string | null
}

export type AccountMoveLinkRow = {
  id?: bigint | number | string
  ref?: string | null
  ref_?: string | null
}

/** Query routes expose `ref`; accept `ref_` only as a legacy/raw-row fallback. */
export function accountMoveReference(move: AccountMoveLinkRow): string {
  const routeReference = String(move.ref ?? "").trim()
  return routeReference || String(move.ref_ ?? "").trim()
}

function moveIdsByReference(
  moves: readonly AccountMoveLinkRow[],
  refs: ReadonlySet<string>,
): Map<string, Set<string>> {
  const idsByRef = new Map<string, Set<string>>()
  for (const move of moves) {
    const ref = accountMoveReference(move)
    if (!refs.has(ref) || move.id == null) continue
    const ids = idsByRef.get(ref) ?? new Set<string>()
    ids.add(String(move.id))
    idsByRef.set(ref, ids)
  }
  return idsByRef
}

/** Refuse a bundle whose source references already belong to persisted moves. */
export function assertAccountMoveReferencesAvailable(
  moves: readonly AccountMoveLinkRow[],
  refs: readonly string[],
): void {
  const requested = new Set(refs.map((ref) => ref.trim()))
  const existing = moveIdsByReference(moves, requested)
  if (existing.size === 0) return
  throw new ImportBundleValidationError(
    [...existing].map(([reference, ids]) => ({
      code: "existing_parent_reference" as const,
      message: `Journal reference "${reference}" already belongs to move ${[...ids].join(", ")}`,
      reference,
    })),
  )
}

/**
 * Resolve imported moves strictly. Every requested reference must resolve to
 * exactly one generated id; ambiguous or missing references stop line import.
 */
export function buildMoveIdMapFromAccountMoves(
  moves: readonly AccountMoveLinkRow[],
  refs: readonly string[],
): Map<string, string> {
  const requested = new Set<string>()
  const issues: ImportBundleValidationIssue[] = []
  for (const rawRef of refs) {
    const ref = rawRef.trim()
    if (requested.has(ref)) {
      issues.push({
        code: "duplicate_resolved_parent_reference",
        message: `Parent reference "${ref}" was requested more than once`,
        reference: ref,
      })
    }
    requested.add(ref)
  }

  const idsByRef = moveIdsByReference(moves, requested)

  const out = new Map<string, string>()
  for (const ref of requested) {
    const ids = [...(idsByRef.get(ref) ?? [])]
    if (ids.length === 0) {
      issues.push({
        code: "missing_resolved_parent_reference",
        message: `Imported parent reference "${ref}" could not be resolved`,
        reference: ref,
      })
    } else if (ids.length > 1) {
      issues.push({
        code: "duplicate_resolved_parent_reference",
        message: `Imported parent reference "${ref}" resolved to multiple ids: ${ids.join(", ")}`,
        reference: ref,
      })
    } else {
      out.set(ref, ids[0])
    }
  }

  if (issues.length > 0) throw new ImportBundleValidationError(issues)
  return out
}

/** Resolve bundle parents only from ids that appeared after the preflight snapshot. */
export function buildNewMoveIdMapFromAccountMoves(
  before: readonly AccountMoveLinkRow[],
  after: readonly AccountMoveLinkRow[],
  refs: readonly string[],
): Map<string, string> {
  assertAccountMoveReferencesAvailable(before, refs)
  const previousIds = new Set(
    before.flatMap((move) => (move.id == null ? [] : [String(move.id)])),
  )
  return buildMoveIdMapFromAccountMoves(
    after.filter((move) => move.id != null && !previousIds.has(String(move.id))),
    refs,
  )
}

/** Build accounting line CSV only when every source reference has resolved. */
export function buildAccountMoveLineCsv(
  headers: string[],
  lineRows: string[][],
  lineMapping: ColumnMappingMap,
  moveIdByRef: Map<string, string>,
): string {
  return buildBundleLineCsv(
    headers,
    lineRows,
    lineMapping,
    moveIdByRef,
    ACCOUNT_MOVE_IMPORT_BUNDLE,
    { requireAllParentReferences: true },
  )
}

export function buildOrderIdMapFromSaleOrders(
  orders: SaleOrderLinkRow[],
  refs: readonly string[],
): Map<string, string> {
  const refToId = new Map<string, string>()
  for (const order of orders) {
    const ref = String(
      order.clientOrderRef ?? order.client_order_ref ?? "",
    ).trim()
    const id = order.id
    if (ref && id != null) refToId.set(ref, String(id))
  }

  const out = new Map<string, string>()
  for (const ref of refs) {
    const id = refToId.get(ref)
    if (id) out.set(ref, id)
  }
  return out
}

export function partitionMappingsByEntity(
  headers: string[],
  parentMapping: ColumnMappingMap,
  lineMapping: ColumnMappingMap,
): { parentHeaders: string[]; lineHeaders: string[] } {
  const parentHeaders: string[] = []
  const lineHeaders: string[] = []
  for (const header of headers) {
    if (parentMapping[header] && !lineMapping[header])
      parentHeaders.push(header)
    else if (lineMapping[header]) lineHeaders.push(header)
    else if (parentMapping[header]) parentHeaders.push(header)
  }
  return { parentHeaders, lineHeaders }
}
