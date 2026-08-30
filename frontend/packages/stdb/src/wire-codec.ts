/**
 * Target-neutral compact operation codec.
 *
 * The contract uses lossless JSON values at the BFF boundary: unsigned
 * integers and timestamps are decimal strings, identities are canonical
 * lower-case hex, and SATS values are only introduced by this codec.  Keeping
 * this module descriptor-driven makes it suitable for generated operations and
 * resources without maintaining a reducer-specific serializer.
 */

export type CompactType = {
  kind: string
  [key: string]: unknown
}

export type CompactCodecCase = {
  name: string
  type: CompactType
  input?: unknown
  wire?: unknown
  error?: string
}

const MAX_U64 = 18_446_744_073_709_551_615n
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_I64 = -(1n << 63n)
const MAX_I64 = (1n << 63n) - 1n

function fail(code: string, message: string): never {
  throw new Error(`compact-codec:${code}: ${message}`)
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(code, "expected an object")
  }
  return value as Record<string, unknown>
}

function decimal(value: unknown, code: string, min: bigint, max: bigint): string {
  let parsed: bigint
  if (typeof value === "bigint") {
    parsed = value
  } else if (typeof value === "string" && (value === "0" || /^-?[1-9]\d*$/.test(value))) {
    try {
      parsed = BigInt(value)
    } catch {
      fail(code, "invalid decimal")
    }
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value)
  } else {
    fail(code, "expected a decimal string or safe integer")
  }
  if (parsed < min || parsed > max) fail(code, "integer is out of range")
  return parsed.toString()
}

function identity(value: unknown): string {
  const obj = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  if (obj && (Object.keys(obj).length !== 1 || !("__identity__" in obj))) {
    fail("identity", "malformed identity object")
  }
  const raw = obj && typeof obj["__identity__"] === "string"
    ? obj["__identity__"]
    : value
  if (typeof raw !== "string") fail("identity", "expected a 64-character hex string")
  const hex = raw.replace(/^0x/i, "")
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) fail("identity", "expected a 64-character hex string")
  return `0x${hex.toLowerCase()}`
}

function timestamp(value: unknown): string {
  const obj = objectValue(value, "timestamp")
  if (Object.keys(obj).length !== 1 || !("microsSinceUnixEpoch" in obj)) {
    fail("timestamp", "malformed timestamp object")
  }
  return decimal(obj["microsSinceUnixEpoch"], "timestamp", MIN_I64, MAX_I64)
}

function variantKey(tag: string): string {
  return tag.length === 0 ? "" : tag.charAt(0).toLowerCase() + tag.slice(1)
}

function variants(type: CompactType): Record<string, unknown> {
  const value = type["variants"]
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("descriptor", "enum variants must be an object")
  }
  return value as Record<string, unknown>
}

function fields(type: CompactType): Record<string, Record<string, unknown>> {
  const raw = type["fields"]
  if (!Array.isArray(raw)) fail("descriptor", "struct fields must be an array")
  const result: Record<string, Record<string, unknown>> = {}
  for (const field of raw) {
    const item = objectValue(field, "descriptor")
    if (typeof item["name"] !== "string" || typeof item["wire"] !== "string") {
      fail("descriptor", "struct fields require name and wire")
    }
    if (result[item["name"] as string]) fail("descriptor", "duplicate struct field")
    result[item["name"] as string] = item
  }
  return result
}

function aliases(field: Record<string, unknown>): string[] {
  const value = field["aliases"]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("descriptor", "field aliases must be strings")
  }
  return value as string[]
}

/** Encode canonical operation/resource values to strict SATS JSON wire values. */
export function encodeCompact(type: CompactType, value: unknown): unknown {
  switch (type.kind) {
    case "alias":
      return encodeCompact(objectValue(type["target"], "descriptor") as CompactType, value)
    case "u64":
      return decimal(value, "u64", 0n, MAX_U64)
    case "timestamp":
      return { __timestamp_micros_since_unix_epoch__: timestamp(value) }
    case "identity":
      return { __identity__: identity(value) }
    case "string":
      if (typeof value !== "string") fail("string", "expected a string")
      return value
    case "bool":
      if (typeof value !== "boolean") fail("bool", "expected a boolean")
      return value
    case "option": {
      const inner = objectValue(type["inner"], "descriptor") as CompactType
      return value === null || value === undefined
        ? { none: [] }
        : { some: encodeCompact(inner, value) }
    }
    case "array": {
      if (!Array.isArray(value)) fail("array", "expected an array")
      const inner = objectValue(type["items"], "descriptor") as CompactType
      return value.map((item) => encodeCompact(inner, item))
    }
    case "enum": {
      const input = objectValue(value, "enum")
      if (typeof input["tag"] !== "string") fail("enum", "tag is required")
      const tag = input["tag"]
      const definition = variants(type)[tag]
      if (definition === undefined) fail("enum", `unknown tag ${tag}`)
      const keys = Object.keys(input)
      const hasValue = Object.prototype.hasOwnProperty.call(input, "value")
      if (definition === null) {
        if (hasValue || keys.length !== 1) fail("enum", "unit variant cannot carry a value")
        return { [variantKey(tag)]: [] }
      }
      if (!hasValue || keys.length !== 2) fail("enum", "payload variant requires value")
      return { [variantKey(tag)]: encodeCompact(objectValue(definition, "descriptor") as CompactType, input["value"]) }
    }
    case "struct": {
      const input = objectValue(value, "struct")
      const known = fields(type)
      const output: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(known)) {
        const accepted = [name, ...aliases(field)]
        const present = accepted.filter((key) => Object.prototype.hasOwnProperty.call(input, key))
        if (present.length > 1) fail("alias", `multiple aliases supplied for ${name}`)
        if (present.length === 1) {
          output[field["wire"] as string] = encodeCompact(
            objectValue(field["type"], "descriptor") as CompactType,
            input[present[0]!],
          )
        }
      }
      const accepted = new Set(Object.entries(known).flatMap(([name, field]) => [name, ...aliases(field)]))
      for (const key of Object.keys(input)) {
        if (!accepted.has(key)) fail("field", `unknown field ${key}`)
      }
      return output
    }
    default:
      fail("descriptor", `unsupported type ${type.kind}`)
  }
}

/** Decode strict SATS JSON wire values to canonical, lossless contract values. */
export function decodeCompact(type: CompactType, value: unknown): unknown {
  switch (type.kind) {
    case "alias":
      return decodeCompact(objectValue(type["target"], "descriptor") as CompactType, value)
    case "u64":
      return decimal(value, "u64", 0n, MAX_U64)
    case "timestamp": {
      const input = objectValue(value, "timestamp")
      if (Object.keys(input).length !== 1 || !("__timestamp_micros_since_unix_epoch__" in input)) {
        fail("timestamp", "malformed wire timestamp")
      }
      return { microsSinceUnixEpoch: decimal(input["__timestamp_micros_since_unix_epoch__"], "timestamp", MIN_I64, MAX_I64) }
    }
    case "identity": {
      const input = objectValue(value, "identity")
      if (Object.keys(input).length !== 1 || typeof input["__identity__"] !== "string") fail("identity", "malformed wire identity")
      return identity(input["__identity__"])
    }
    case "string":
      if (typeof value !== "string") fail("string", "expected a string")
      return value
    case "bool":
      if (typeof value !== "boolean") fail("bool", "expected a boolean")
      return value
    case "option": {
      const input = objectValue(value, "option")
      if (Object.keys(input).length !== 1) fail("option", "option must have one variant")
      if ("none" in input) {
        if (!Array.isArray(input["none"]) || (input["none"] as unknown[]).length !== 0) fail("option", "malformed none payload")
        return null
      }
      if (!("some" in input)) fail("option", "unknown option variant")
      return decodeCompact(objectValue(type["inner"], "descriptor") as CompactType, input["some"])
    }
    case "array": {
      if (!Array.isArray(value)) fail("array", "expected an array")
      return value.map((item) => decodeCompact(objectValue(type["items"], "descriptor") as CompactType, item))
    }
    case "enum": {
      const input = objectValue(value, "enum")
      if (Object.keys(input).length !== 1) fail("enum", "enum must have one variant")
      const wire = Object.keys(input)[0]!
      const tag = Object.keys(variants(type)).find((candidate) => variantKey(candidate) === wire)
      if (!tag) fail("enum", `unknown wire tag ${wire}`)
      const definition = variants(type)[tag]
      const payload = input[wire]
      if (definition === null) {
        if (!Array.isArray(payload) || payload.length !== 0) fail("enum", "malformed unit payload")
        return { tag }
      }
      return { tag, value: decodeCompact(objectValue(definition, "descriptor") as CompactType, payload) }
    }
    case "struct": {
      const input = objectValue(value, "struct")
      const output: Record<string, unknown> = {}
      for (const [name, field] of Object.entries(fields(type))) {
        const wire = field["wire"] as string
        if (Object.prototype.hasOwnProperty.call(input, wire)) {
          output[name] = decodeCompact(objectValue(field["type"], "descriptor") as CompactType, input[wire])
        }
      }
      const wires = new Set(Object.values(fields(type)).map((field) => field["wire"] as string))
      for (const key of Object.keys(input)) if (!wires.has(key)) fail("field", `unknown wire field ${key}`)
      return output
    }
    default:
      fail("descriptor", `unsupported type ${type.kind}`)
  }
}

// Prevent accidental removal of the range constants when the implementation
// is tree-shaken in a generated-only build; these are part of the contract.
export const COMPACT_CODEC_VERSION = 1
export const COMPACT_CODEC_MAX_SAFE_INTEGER = MAX_SAFE
