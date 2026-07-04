/**
 * JSON-safe serialization for SpacetimeDB HTTP reducer bodies.
 *
 * SpacetimeDB HTTP expects snake_case keys, SATS sum JSON for Option/enum fields,
 * and timestamps as `{ __timestamp_micros_since_unix_epoch__: ... }`.
 */

import optionFieldsJson from "./stdb-http-option-fields.json" with { type: "json" }

type OptionFieldMap = Record<string, readonly string[]>
const OPTION_FIELDS = optionFieldsJson as OptionFieldMap

const STDB_TIMESTAMP_KEY = "__timestamp_micros_since_unix_epoch__"

/** SpacetimeDB HTTP reducer params use Rust snake_case field names, not TS camelCase. */
export function camelToSnakeIdentifier(s: string): string {
  const relation = s.match(/^(.*)(M2O|M2M|O2M)$/)
  if (relation) {
    const base = relation[1]
      .replace(/([a-z])(\d)/g, "$1_$2")
      .replace(/(\d)([A-Z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
    return `${base}_${relation[2].toLowerCase()}`
  }

  return s
    .replace(/([a-z])(\d)/g, "$1_$2")
    .replace(/(\d)([A-Z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

/** SATS unit-variant sum JSON for SpacetimeDB HTTP (e.g. `{ "percent": [] }`). */
export function encodeTaggedUnitEnum(v: { tag: string }): Record<string, unknown> {
  const key = v.tag.charAt(0).toLowerCase() + v.tag.slice(1)
  return { [key]: [] }
}

/** Match `@lumiere/api-client` `stringifyReducerCallBody`: STDB HTTP expects JSON numbers for `u64`. */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function isTimestampLike(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return STDB_TIMESTAMP_KEY in o || "microsSinceUnixEpoch" in o
}

function encodeTimestamp(v: unknown): Record<string, string | number> {
  const o = v as Record<string, unknown>
  const raw = o[STDB_TIMESTAMP_KEY] ?? o.microsSinceUnixEpoch
  if (typeof raw === "bigint") {
    if (raw > MAX_SAFE_BIGINT) {
      return { [STDB_TIMESTAMP_KEY]: raw.toString() }
    }
    return { [STDB_TIMESTAMP_KEY]: Number(raw) }
  }
  if (typeof raw === "number") {
    return { [STDB_TIMESTAMP_KEY]: raw }
  }
  if (typeof raw === "string") {
    return { [STDB_TIMESTAMP_KEY]: raw }
  }
  throw new Error("stdbParamsToJson: invalid timestamp value")
}

function isTaggedEnum(v: unknown): v is { tag: string } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 1 &&
    typeof (v as { tag?: unknown }).tag === "string"
  )
}

function isSatsOption(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const keys = Object.keys(v as object)
  return keys.length === 1 && (keys[0] === "some" || keys[0] === "none")
}

function bigintToJson(v: bigint): number {
  if (v < 0n) {
    throw new Error("stdbParamsToJson: negative bigint is not valid as u64 in JSON")
  }
  if (v > MAX_SAFE_BIGINT) {
    throw new Error(
      `stdbParamsToJson: bigint ${v} exceeds Number.MAX_SAFE_INTEGER; use a different encoding for this field`,
    )
  }
  return Number(v)
}

function encodeValue(
  value: unknown,
  optionFields: ReadonlySet<string> | undefined,
  fieldKey?: string,
): unknown {
  if (value === undefined) return undefined

  if (isTimestampLike(value)) {
    return encodeTimestamp(value)
  }

  if (isTaggedEnum(value)) {
    return encodeTaggedUnitEnum(value)
  }

  if (isSatsOption(value)) {
    const obj = value as Record<string, unknown>
    if ("none" in obj) return { none: [] }
    return { some: encodeValue(obj.some, optionFields) }
  }

  if (value === null) {
    if (fieldKey && optionFields?.has(fieldKey)) {
      return { none: [] }
    }
    return null
  }

  if (typeof value === "bigint") {
    if (fieldKey && optionFields?.has(fieldKey)) {
      if (value <= 0n) return { none: [] }
      return { some: bigintToJson(value) }
    }
    return bigintToJson(value)
  }

  if (typeof value === "number" && fieldKey && optionFields?.has(fieldKey)) {
    if (value <= 0) return { none: [] }
    return { some: value }
  }

  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item, optionFields))
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const snakeKey = camelToSnakeIdentifier(key)
      const encoded = encodeValue(nested, optionFields, snakeKey)
      if (encoded !== undefined) {
        out[snakeKey] = encoded
      }
    }
    return out
  }

  if (fieldKey && optionFields?.has(fieldKey)) {
    return { some: value }
  }

  return value
}

/** SATS `Option<u64>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalU64(
  value: bigint | number | null | undefined,
): { none: [] } | { some: number } {
  if (value === null || value === undefined) return { none: [] }
  const n = typeof value === "bigint" ? bigintToJson(value) : value
  if (n === 0) return { none: [] }
  return { some: n }
}

/** SATS `Option<String>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalString(
  value: string | null | undefined,
): { none: [] } | { some: string } {
  if (value == null) return { none: [] }
  const s = String(value).trim()
  if (s === "") return { none: [] }
  return { some: s }
}

/** SATS `Option<Timestamp>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalTimestamp(
  value: Date | string | null | undefined,
): { none: [] } | { some: Record<string, string | number> } {
  if (value == null || value === "") return { none: [] }
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return { none: [] }
  const micros = BigInt(d.getTime()) * 1000n
  return { some: encodeTimestamp({ microsSinceUnixEpoch: micros }) }
}

/**
 * Encode generated TS reducer param structs for `POST /api/call/:reducer`.
 *
 * @param structName - Generated params type name (e.g. `CreateLeadParams`) so
 *   `Option<T>` fields are wrapped as `{ some: v }` / `{ none: [] }`.
 */
export function stdbParamsToJson(
  params: object,
  structName?: keyof OptionFieldMap & string,
): Record<string, unknown> {
  const optionFieldList = structName ? (OPTION_FIELDS[structName] ?? []) : []
  const optionFields = structName ? new Set(optionFieldList) : undefined
  const encoded = encodeValue(params, optionFields)
  const out = { ...((encoded ?? {}) as Record<string, unknown>) }

  // SpacetimeDB HTTP requires every Option field in the struct JSON body.
  if (structName) {
    for (const fieldSnake of optionFieldList) {
      if (!(fieldSnake in out)) {
        out[fieldSnake] = { none: [] }
      }
    }
  }

  return out
}

/** Last-arg struct names for `POST /api/call/:reducer` bodies in Playwright / scripts. */
const REDUCER_PARAM_STRUCTS: Partial<Record<string, keyof OptionFieldMap & string>> = {
  create_lead: "CreateLeadParams",
  create_contact: "CreateContactParams",
  convert_lead_to_customer: "ConvertLeadParams",
  convert_opportunity_to_sale_order: "ConvertOpportunityParams",
  create_opportunity_line: "CreateOpportunityLineParams",
  create_sale_order_line: "CreateSaleOrderLineParams",
  create_invoice_from_sale_order: "CreateInvoiceFromSaleOrderParams",
  create_bill_from_purchase_order: "CreateBillFromPurchaseOrderParams",
  create_ai_action_draft: "CreateAiActionDraftParams",
  update_ai_action_draft_params: "UpdateAiActionDraftParamsParams",
  post_account_move: undefined,
}

/** Flat `Option<T>` arg indices for reducers without a trailing params struct. */
const FLAT_OPTION_ARG_INDICES: Partial<Record<string, readonly number[]>> = {
  create_proposal: [4, 5, 6],
}

function encodeFlatOptionalArg(value: unknown, argIndex: number, reducer: string): unknown {
  if (reducer !== "create_proposal") return value
  switch (argIndex) {
    case 4:
      return encodeOptionalTimestamp(
        value instanceof Date ? value : (value as string | null | undefined),
      )
    case 5:
      return encodeOptionalString(value as string | null | undefined)
    case 6:
      return encodeOptionalU64(value as number | null | undefined)
    default:
      return value
  }
}

/**
 * Encode the trailing params object in a reducer arg list for SpacetimeDB HTTP.
 * Top-level org / id args are left unchanged.
 */
export function encodeReducerCallArgs(reducer: string, args: unknown[]): unknown[] {
  const flatOptionIndices = FLAT_OPTION_ARG_INDICES[reducer]
  if (flatOptionIndices?.length) {
    return args.map((arg, index) => encodeFlatOptionalArg(arg, index, reducer))
  }

  const structName = REDUCER_PARAM_STRUCTS[reducer]
  if (!structName || args.length === 0) return args
  const lastIdx = args.length - 1
  const last = args[lastIdx]
  if (last === null || typeof last !== "object" || Array.isArray(last)) return args
  const encoded = [...args]
  encoded[lastIdx] = stdbParamsToJson(last as object, structName)
  return encoded
}
