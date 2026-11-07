import { z } from "zod"

import type {
  QueryBuilderFilterOp,
  QueryBuilderFilterRow,
} from "./query-builder-semantics"

export interface QueryBuilderDraft {
  model: string
  kind: "kpi" | "chart" | "table"
  name: string
  aggregation: "count" | "sum" | "avg" | "min" | "max"
  measureField: string
  groupBy: string
  chartType: "bar" | "line" | "area" | "pie"
  fields: string[]
  filters: QueryBuilderFilterRow[]
  timeField: string
  sortField: string
  sortDirection: "asc" | "desc"
  limit: string
}

const widgetTypeSchema = z.union([
  z.enum(["Kpi", "Chart", "Table"]),
  z.object({ tag: z.enum(["Kpi", "Chart", "Table"]) }).strict(),
])

/** Project only editable settings; identity and layout never enter a copied draft. */
const storedWidgetSettingsSchema = z.object({
  name: z.string(),
  model: z.string(),
  widgetType: widgetTypeSchema.nullish(),
  widget_type: widgetTypeSchema.nullish(),
  aggregation: z.string().nullish(),
  chartType: z.string().nullish(),
  chart_type: z.string().nullish(),
  groupBy: z.string().nullish(),
  group_by: z.string().nullish(),
  fields: z.array(z.string()),
  configuration: z.string().nullish(),
  domain: z.string().nullish(),
  sortOrder: z.string().nullish(),
  sort_order: z.string().nullish(),
  refreshInterval: z.null().optional(),
  refresh_interval: z.null().optional(),
  limit: z.number().int().positive().max(0xffff_ffff).nullish(),
})

const bindingSchema = z
  .object({
    version: z.literal(1),
    timeField: z.string().nullish(),
    measureField: z.string().nullish(),
    missingTimestampPolicy: z.literal("reject"),
    missingMeasurePolicy: z.literal("reject"),
  })
  .strict()

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean()])
const fieldNameSchema = z
  .string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
  .refine((value) => value !== "__proto__")
const domainSchema = z.record(
  fieldNameSchema,
  z.union([
    scalarSchema,
    z.object({ $ne: scalarSchema }).strict(),
    z.object({ $gt: scalarSchema }).strict(),
    z.object({ $gte: scalarSchema }).strict(),
    z.object({ $lt: scalarSchema }).strict(),
    z.object({ $lte: scalarSchema }).strict(),
    z.object({ $in: z.array(scalarSchema).min(1) }).strict(),
  ]),
)
const sortSchema = z.record(fieldNameSchema, z.string())

function jsonSettings<Value>(
  value: unknown,
  schema: z.ZodType<Value>,
): Value | null {
  if (typeof value !== "string") return null
  try {
    const parsed: unknown = JSON.parse(value)
    const decoded = schema.safeParse(parsed)
    return decoded.success ? decoded.data : null
  } catch {
    return null
  }
}

function field(value: unknown): string | null {
  if (value == null || value === "") return ""
  return typeof value === "string" &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) &&
    value !== "__proto__"
    ? value
    : null
}

function scalar(value: unknown): string | null {
  if (typeof value === "string")
    return value && value.trim() === value ? value : null
  if (typeof value === "boolean") return String(value)
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  )
    return null
  return String(value)
}

/** The text editor trims scalar operands and splits $in values on commas. */
function decodeFilters(raw: unknown): QueryBuilderFilterRow[] | null {
  const domain =
    raw == null || raw === "" ? {} : jsonSettings(raw, domainSchema)
  if (!domain) return null
  const filters: QueryBuilderFilterRow[] = []
  for (const [name, operand] of Object.entries(domain)) {
    if (!field(name)) return null
    if (
      typeof operand === "string" ||
      typeof operand === "number" ||
      typeof operand === "boolean"
    ) {
      const value = scalar(operand)
      if (value === null) return null
      filters.push({ field: name, op: "eq", value })
      continue
    }
    if ("$in" in operand) {
      const values = operand.$in.map(scalar)
      if (values.some((item) => item === null || item.includes(",")))
        return null
      filters.push({ field: name, op: "in", value: values.join(", ") })
      continue
    }
    const [operator, value] = Object.entries(operand)[0]!
    const op = operator.slice(1) as Exclude<QueryBuilderFilterOp, "eq" | "in">
    const encoded = scalar(value)
    if (encoded === null) return null
    const numeric = Number(encoded)
    if (op !== "ne" && !Number.isFinite(numeric)) return null
    // The builder coerces numeric-looking $ne operands. Leading zeroes,
    // exponents and large decimal identifiers would otherwise change meaning.
    if (op === "ne" && Number.isFinite(numeric) && String(numeric) !== encoded)
      return null
    filters.push({ field: name, op, value: encoded })
  }
  return filters
}

function decodeBinding(
  raw: unknown,
): { timeField: string; measureField: string } | null {
  if (raw == null || raw === "") return { timeField: "", measureField: "" }
  const binding = jsonSettings(raw, bindingSchema)
  if (!binding) return null
  const timeField = field(
    typeof binding.timeField === "string"
      ? binding.timeField.trim()
      : binding.timeField,
  )
  const measureField = field(
    typeof binding.measureField === "string"
      ? binding.measureField.trim()
      : binding.measureField,
  )
  return timeField === null || measureField === null
    ? null
    : { timeField, measureField }
}

/**
 * Decode only settings the editor can faithfully save as an independent widget.
 * Unsupported or lossy definitions stay unchanged and cannot be configured here.
 */
export function queryBuilderDraftFromWidget(
  value: unknown,
): QueryBuilderDraft | null {
  const decoded = storedWidgetSettingsSchema.safeParse(value)
  if (!decoded.success) return null
  const row = decoded.data
  const model = field(row.model)
  const rawType = row.widgetType ?? row.widget_type
  const type = typeof rawType === "object" && rawType ? rawType.tag : rawType
  const kind =
    type === "Kpi"
      ? "kpi"
      : type === "Chart"
        ? "chart"
        : type === "Table"
          ? "table"
          : null
  const rawAggregation = row.aggregation ?? "count"
  const normalizedAggregation =
    typeof rawAggregation === "string" ? rawAggregation.toLowerCase() : ""
  const aggregation =
    normalizedAggregation === "average" ? "avg" : normalizedAggregation
  const rawChartType = row.chartType ?? row.chart_type ?? "bar"
  const chartType =
    typeof rawChartType === "string" ? rawChartType.toLowerCase() : ""
  const groupBy = field(row.groupBy ?? row.group_by)
  if (
    !model ||
    !kind ||
    row.name.trim() !== row.name ||
    !["count", "sum", "avg", "min", "max"].includes(aggregation) ||
    !["bar", "line", "area", "pie"].includes(chartType) ||
    groupBy === null ||
    (kind === "chart" && !groupBy) ||
    row.fields.some((value) => !field(value)) ||
    new Set(row.fields).size !== row.fields.length
  )
    return null
  const fields = [...row.fields]
  const binding = decodeBinding(row.configuration)
  if (
    !binding ||
    (aggregation === "count"
      ? binding.measureField !== ""
      : binding.measureField !== (fields[0] ?? "id")) ||
    (kind !== "table" && fields.length > (aggregation === "count" ? 0 : 1))
  )
    return null
  const filters = decodeFilters(row.domain)
  if (!filters) return null
  const rawSort = row.sortOrder ?? row.sort_order
  const sort =
    rawSort == null || rawSort === ""
      ? undefined
      : jsonSettings(rawSort, sortSchema)
  if (sort === null || (sort && Object.keys(sort).length !== 1)) return null
  const [sortField, rawDirection] = sort
    ? Object.entries(sort)[0]!
    : ["", "desc"]
  const sortDirection =
    typeof rawDirection === "string" ? rawDirection.toLowerCase() : ""
  if (sort && !field(sortField)) return null
  if (sortDirection !== "asc" && sortDirection !== "desc") return null
  const limit = row.limit ?? (kind === "chart" ? 12 : 10)
  return {
    model,
    kind,
    name: row.name,
    aggregation: aggregation as QueryBuilderDraft["aggregation"],
    measureField: binding.measureField,
    groupBy,
    chartType: chartType as QueryBuilderDraft["chartType"],
    fields: kind === "table" && fields.length === 0 ? ["name"] : fields,
    filters,
    timeField: binding.timeField,
    sortField,
    sortDirection,
    limit: String(limit),
  }
}
