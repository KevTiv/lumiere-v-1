export type QueryBuilderFilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in"

export interface QueryBuilderFilterRow {
  field: string
  op: QueryBuilderFilterOp
  value: string
}

export type QueryBuilderFieldKind = "dimension" | "measure" | "timestamp"

export interface QueryBuilderFieldInfo {
  field: string
  label: string
  kind: QueryBuilderFieldKind
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function scalarish(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === "number" || typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if ("tag" in object && typeof object.tag === "string") return object.tag
    if ("some" in object) return scalarish(object.some)
  }
  return null
}

function timestampish(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (value == null) return false
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value))
  }
  if (typeof value !== "object" || Array.isArray(value)) return false
  const object = value as Record<string, unknown>
  if ("some" in object) return timestampish(object.some)
  if ("__timestamp_micros_since_unix_epoch__" in object) {
    return Number.isFinite(Number(object.__timestamp_micros_since_unix_epoch__))
  }
  return typeof (object as { toDate?: unknown }).toDate === "function"
}

function valueKind(value: unknown): QueryBuilderFieldKind | null {
  if (value == null) return null
  if (timestampish(value)) return "timestamp"
  const scalar = scalarish(value)
  if (scalar == null) return "dimension"
  return scalar !== "" && Number.isFinite(Number(scalar)) ? "measure" : "dimension"
}

export function discoverQueryBuilderFields(
  rows: Record<string, unknown>[],
): QueryBuilderFieldInfo[] {
  const kinds = new Map<string, QueryBuilderFieldKind>()

  for (const row of rows.slice(0, 50)) {
    for (const [key, raw] of Object.entries(row)) {
      const nextKind = valueKind(raw)
      if (nextKind == null) continue
      const currentKind = kinds.get(key)
      kinds.set(key, currentKind == null || currentKind === nextKind ? nextKind : "dimension")
    }
  }

  return [...kinds.entries()]
    .map(([key, kind]) => {
      const field = camelToSnake(key)
      return { field, label: humanize(field), kind }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function buildQueryBuilderDomain(
  filters: QueryBuilderFilterRow[],
): string | undefined {
  const domain: Record<string, unknown> = {}
  for (const { field, op, value } of filters) {
    if (!field || value.trim() === "") continue
    if (op === "eq") {
      domain[field] = value.trim()
    } else if (op === "in") {
      domain[field] = { $in: value.split(",").map((entry) => entry.trim()).filter(Boolean) }
    } else {
      const numericValue = Number(value)
      domain[field] = {
        [`$${op}`]: Number.isFinite(numericValue) ? numericValue : value.trim(),
      }
    }
  }
  return Object.keys(domain).length > 0 ? JSON.stringify(domain) : undefined
}

export function storedDashboardBindingConfiguration(
  timeField: string,
  measureField: string,
): string {
  return JSON.stringify({
    version: 1,
    timeField: timeField || null,
    measureField: measureField || null,
    missingTimestampPolicy: "reject",
    missingMeasurePolicy: "reject",
  })
}
