import { moduleHistoryTimestampMs } from "./module-history-filter"
import type { DashboardWidget, DiagnosticWidget, GridWidth } from "./dashboard-types"
import {
  resolveStoredDashboardDrillTarget,
  type StoredDashboardDrillTarget,
} from "./stored-dashboard-drill-target"

type DashboardRecord = { [key: string]: unknown }

export type StoredDashboardDataSources = Record<string, Record<string, unknown>[]>

export type StoredDashboardSourceStatus =
  | "loading"
  | "ready"
  | "empty"
  | "denied"
  | "unavailable"
  | "partial"

export interface StoredDashboardSourceState {
  status: StoredDashboardSourceStatus
  rowCount: number
  message?: string
}

export type StoredDashboardSourceStates = Record<string, StoredDashboardSourceState>

export interface StoredDashboardResolverOptions {
  startMs?: number
  endMs?: number
  sourceStates?: StoredDashboardSourceStates
  onDrillTarget?: (target: StoredDashboardDrillTarget) => void
}

export type StoredDashboardResolutionState =
  | "ready"
  | "empty"
  | "invalid-definition"
  | "denied"
  | "unavailable"
  | "partial"

export type StoredDashboardResolutionIssueKind =
  | "invalid-definition"
  | "source-loading"
  | "source-denied"
  | "source-unavailable"
  | "source-partial"
  | "missing-timestamp"
  | "missing-measure"

export interface StoredDashboardResolutionIssue {
  kind: StoredDashboardResolutionIssueKind
  widgetId: string
  model: string
  message: string
  rejectedRows?: number
}

export interface StoredDashboardResolution {
  widgets: DashboardWidget[]
  state: StoredDashboardResolutionState
  issues: StoredDashboardResolutionIssue[]
  sourceStates: StoredDashboardSourceStates
}

export interface StoredDashboardExportGate {
  allowed: boolean
  reason?: string
}

function scalarField(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
    if ("some" in obj) return scalarField(obj.some)
  }
  return String(value)
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function rowField(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key]
  const camel = snakeToCamel(key)
  if (camel in row) return row[camel]
  return undefined
}

function isRecord(value: unknown): value is DashboardRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

type DiagnosticCode = DiagnosticWidget["data"]["code"]
interface ResolutionFailure {
  code: DiagnosticCode
  message: string
  rejectedRows?: number
}
type ParseResult<T> =
  | { ok: true; value: T }
  | ({ ok: false } & ResolutionFailure)

const DOMAIN_OPERATORS = new Set(["$in", "$ne", "$gte", "$lte", "$gt", "$lt"])

function applyDomain(
  rows: Record<string, unknown>[],
  domain?: string | null,
): ParseResult<Record<string, unknown>[]> {
  if (!domain?.trim()) return { ok: true, value: rows }

  let parsed: unknown
  try {
    parsed = JSON.parse(domain)
  } catch {
    return { ok: false, code: "invalid-filter", message: "This widget has an invalid persisted filter definition." }
  }
  if (!isRecord(parsed)) {
    return { ok: false, code: "invalid-filter", message: "This widget has an invalid persisted filter definition." }
  }

  for (const [field, expected] of Object.entries(parsed)) {
    if (!field.trim()) return { ok: false, code: "invalid-filter", message: "This widget has an invalid persisted filter definition." }
    if (!isRecord(expected)) continue
    const entries = Object.entries(expected)
    if (entries.length === 0) {
      return { ok: false, code: "invalid-filter", message: `The filter for ${field} has no operator.` }
    }
    for (const [operator, operand] of entries) {
      if (!DOMAIN_OPERATORS.has(operator)) {
        return { ok: false, code: "invalid-operator", message: `This widget uses an unsupported filter operator: ${operator}.` }
      }
      if (operator === "$in" && !Array.isArray(operand)) {
        return { ok: false, code: "invalid-filter", message: `The $in filter for ${field} must use an array.` }
      }
      if (
        ["$gte", "$lte", "$gt", "$lt"].includes(operator) &&
        !Number.isFinite(Number(operand))
      ) {
        return {
          ok: false,
          code: "invalid-filter",
          message: `This widget has a non-numeric operand for ${operator}.`,
        }
      }
    }
  }

  return {
    ok: true,
    value: rows.filter((row) =>
      Object.entries(parsed).every(([key, expected]) => {
        const actual = scalarField(rowField(row, key))
        if (isRecord(expected)) {
          return Object.entries(expected).every(([operator, operand]) => {
            if (operator === "$in") {
              return (operand as unknown[]).map((value) => String(value)).includes(actual)
            }
            if (operator === "$ne") {
              return actual.toLowerCase() !== String(operand).toLowerCase()
            }
            const actualNumber = Number(actual)
            const operandNumber = Number(operand)
            if (!Number.isFinite(actualNumber) || !Number.isFinite(operandNumber)) return false
            if (operator === "$gte") return actualNumber >= operandNumber
            if (operator === "$lte") return actualNumber <= operandNumber
            if (operator === "$gt") return actualNumber > operandNumber
            return actualNumber < operandNumber
          })
        }
        return actual.toLowerCase() === String(expected).toLowerCase()
      }),
    ),
  }
}

interface StoredDashboardBindingV1 {
  version: 1
  timeField: string | null
  measureField: string | null
  missingTimestampPolicy: "reject"
  missingMeasurePolicy: "reject"
}

function parseBinding(raw: unknown): ParseResult<StoredDashboardBindingV1 | null> {
  const encoded = scalarField(raw).trim()
  if (!encoded) return { ok: true, value: null }
  try {
    const parsed = JSON.parse(encoded) as Partial<StoredDashboardBindingV1>
    if (
      parsed.version !== 1 ||
      (parsed.timeField != null && typeof parsed.timeField !== "string") ||
      (parsed.measureField != null && typeof parsed.measureField !== "string") ||
      parsed.missingTimestampPolicy !== "reject" ||
      parsed.missingMeasurePolicy !== "reject"
    ) {
      throw new Error("invalid binding")
    }
    return {
      ok: true,
      value: {
        version: 1,
        timeField: parsed.timeField?.trim() || null,
        measureField: parsed.measureField?.trim() || null,
        missingTimestampPolicy: "reject",
        missingMeasurePolicy: "reject",
      },
    }
  } catch {
    return {
      ok: false,
      code: "invalid-binding",
      message: "This widget has an invalid time or measure binding.",
    }
  }
}

interface SortOrder {
  field: string
  direction: "asc" | "desc"
}

function parseSortOrder(raw: unknown): ParseResult<SortOrder | null> {
  if (raw == null || raw === "") return { ok: true, value: null }
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, code: "invalid-sort", message: "The widget sort order must be a JSON string." }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || Object.keys(parsed).length !== 1) {
      return { ok: false, code: "invalid-sort", message: "The widget sort order must contain one field." }
    }
    const [field, direction] = Object.entries(parsed)[0]!
    const normalized = String(direction).toLowerCase()
    if (!field.trim() || (normalized !== "asc" && normalized !== "desc")) {
      return { ok: false, code: "invalid-sort", message: "The widget sort direction must be asc or desc." }
    }
    return { ok: true, value: { field, direction: normalized } }
  } catch {
    return { ok: false, code: "invalid-sort", message: "The widget sort order is not valid JSON." }
  }
}

function sortRowsByField(
  rows: Record<string, unknown>[],
  sortOrder: SortOrder,
): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const av = rowField(a, sortOrder.field)
    const bv = rowField(b, sortOrder.field)
    const an = Number(av)
    const bn = Number(bv)
    const comparison =
      Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn
        : scalarField(av).localeCompare(scalarField(bv))
    return sortOrder.direction === "asc" ? comparison : -comparison
  })
}

function timestampToMs(raw: unknown): number | null {
  if (raw !== null && typeof raw === "object" && "toDate" in raw && typeof raw.toDate === "function") {
    return moduleHistoryTimestampMs(raw.toDate())
  }
  // Preserve the legacy bare-microsecond representation; typed STDB timestamps
  // and date strings have explicit units and support pre-1970 dates without guessing.
  const legacyNumeric = typeof raw === "number" || typeof raw === "bigint" ||
    (typeof raw === "string" && /^-?\d+(?:\.\d+)?$/.test(raw))
  return moduleHistoryTimestampMs(raw, "UTC", legacyNumeric && Math.abs(Number(raw)) > 1e15 ? "microseconds" : "milliseconds")
}

function applyTimeRange(
  rows: Record<string, unknown>[],
  timeField: string | null,
  startMs?: number,
  endMs?: number,
): ParseResult<Record<string, unknown>[]> {
  if (startMs == null && endMs == null) return { ok: true, value: rows }
  if (!timeField) {
    return {
      ok: false,
      code: "missing-time-field",
      message: "This widget does not declare a time field for the selected date range.",
    }
  }
  const timestamps = rows.map((row) => timestampToMs(rowField(row, timeField)))
  const rejectedRows = timestamps.filter((value) => value == null).length
  if (rejectedRows > 0) {
    return {
      ok: false,
      code: "invalid-timestamp",
      message: `This widget has incomplete timestamp data in ${timeField}.`,
      rejectedRows,
    }
  }
  return {
    ok: true,
    value: rows.filter((_row, index) => {
      const timestamp = timestamps[index]!
      if (startMs != null && timestamp < startMs) return false
      if (endMs != null && timestamp >= endMs) return false
      return true
    }),
  }
}

const AGGREGATIONS = new Set(["count", "sum", "average", "avg", "min", "max"])

function normalizeAggregation(raw: unknown): ParseResult<string> {
  const aggregation = String(raw ?? "count").toLowerCase()
  return AGGREGATIONS.has(aggregation)
    ? { ok: true, value: aggregation }
    : { ok: false, code: "invalid-aggregation", message: `The aggregation ${aggregation} is not supported.` }
}

function applyMeasureCompleteness(
  rows: Record<string, unknown>[],
  field: string,
  aggregation: string,
  binding: StoredDashboardBindingV1 | null,
): ParseResult<Record<string, unknown>[]> {
  if (aggregation === "count") return { ok: true, value: rows }
  if (!binding?.measureField || binding.measureField !== field) {
    return {
      ok: false,
      code: "missing-measure",
      message: "This widget does not declare the measure used by its aggregation.",
    }
  }
  const rejectedRows = rows.filter((row) => {
    const encoded = scalarField(rowField(row, field)).trim()
    return encoded === "" || !Number.isFinite(Number(encoded))
  }).length
  if (rejectedRows > 0) {
    return {
      ok: false,
      code: "missing-measure",
      message: `This widget has incomplete numeric data in ${field}.`,
      rejectedRows,
    }
  }
  return { ok: true, value: rows }
}

function aggregateValue(
  rows: Record<string, unknown>[],
  field: string,
  aggregation: string,
): number {
  if (aggregation === "count") return rows.length
  const values = rows.map((row) => Number(scalarField(rowField(row, field))))
  if (values.length === 0) return 0
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0)
  if (aggregation === "average" || aggregation === "avg") {
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  if (aggregation === "min") return Math.min(...values)
  return Math.max(...values)
}

function gridWidthFromColumns(width: number): GridWidth {
  if (width >= 10) return "full"
  if (width >= 8) return "2/3"
  if (width >= 6) return "1/2"
  return "1/3"
}

function widgetTypeTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag: string }).tag)
  }
  return String(value)
}

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4"]

function diagnosticWidget(
  widgetId: string,
  title: string,
  width: GridWidth,
  failure: ResolutionFailure,
): DiagnosticWidget {
  return {
    id: widgetId,
    type: "diagnostic",
    title,
    width,
    data: {
      code: failure.code,
      message: failure.message,
      ...(failure.rejectedRows == null ? {} : { rejectedRows: failure.rejectedRows }),
    },
  }
}

function failureIssue(
  widgetId: string,
  model: string,
  failure: ResolutionFailure,
): StoredDashboardResolutionIssue {
  const kind = failure.code === "invalid-timestamp"
    ? "missing-timestamp"
    : failure.code === "missing-measure"
      ? "missing-measure"
      : "invalid-definition"
  return {
    kind,
    widgetId,
    model,
    message: failure.message,
    ...(failure.rejectedRows == null ? {} : { rejectedRows: failure.rejectedRows }),
  }
}

function sourceIssue(
  widgetId: string,
  model: string,
  state: StoredDashboardSourceState,
): StoredDashboardResolutionIssue | null {
  if (state.status === "loading") {
    return { kind: "source-loading", widgetId, model, message: state.message ?? `Source ${model} is loading.` }
  }
  if (state.status === "denied") {
    return { kind: "source-denied", widgetId, model, message: state.message ?? `Access to source ${model} was denied.` }
  }
  if (state.status === "unavailable") {
    return { kind: "source-unavailable", widgetId, model, message: state.message ?? `Source ${model} is unavailable.` }
  }
  if (state.status === "partial") {
    return { kind: "source-partial", widgetId, model, message: state.message ?? `Source ${model} is partial.` }
  }
  return null
}

function resolutionState(
  widgets: DashboardWidget[],
  issues: StoredDashboardResolutionIssue[],
  hasSourceRows: boolean,
): StoredDashboardResolutionState {
  if (issues.some((issue) => issue.kind === "invalid-definition")) return "invalid-definition"
  const denied = issues.some((issue) => issue.kind === "source-denied")
  const unavailable = issues.some((issue) => issue.kind === "source-unavailable")
  const incomplete = issues.some((issue) =>
    issue.kind === "source-partial" ||
    issue.kind === "missing-timestamp" ||
    issue.kind === "missing-measure" ||
    issue.kind === "source-loading",
  )
  if (widgets.length > 0 && (denied || unavailable || incomplete)) return "partial"
  if (denied) return "denied"
  if (unavailable || issues.some((issue) => issue.kind === "source-loading")) return "unavailable"
  if (incomplete) return "partial"
  return hasSourceRows ? "ready" : "empty"
}

export function resolveStoredDashboard(
  widgetRows: Record<string, unknown>[],
  widgetIds: Array<bigint | number>,
  dataSources: StoredDashboardDataSources,
  options?: StoredDashboardResolverOptions,
): StoredDashboardResolution {
  const idSet = new Set(widgetIds.map((id) => String(id)))
  const storedWidgets = widgetRows
    .filter((row) => idSet.has(String(row.id ?? "")))
    .filter((row) => row.isActive !== false && row.is_active !== false)
    .sort((a, b) => {
      const ay = Number(a.positionY ?? a.position_y ?? 0)
      const by = Number(b.positionY ?? b.position_y ?? 0)
      if (ay !== by) return ay - by
      const ax = Number(a.positionX ?? a.position_x ?? 0)
      const bx = Number(b.positionX ?? b.position_x ?? 0)
      return ax - bx
    })

  const widgets: DashboardWidget[] = []
  const issues: StoredDashboardResolutionIssue[] = []
  const usedSourceStates: StoredDashboardSourceStates = {}
  let hasSourceRows = false

  storedWidgets.forEach((row, index) => {
    const widgetId = String(row.id ?? index)
    const model = String(row.model ?? "").trim()
    const title = String(row.name ?? "Widget")
    const width = gridWidthFromColumns(Number(row.width ?? 6))
    const pushDiagnostic = (failure: ResolutionFailure) => {
      widgets.push(diagnosticWidget(widgetId, title, width, failure))
      issues.push(failureIssue(widgetId, model, failure))
    }

    if (!model) {
      pushDiagnostic({
        code: "missing-model",
        message: "The widget has no data source.",
      })
      return
    }

    const rawRows = dataSources[model] ?? []
    const state = options?.sourceStates?.[model] ?? {
      status: rawRows.length === 0 ? "empty" : "ready",
      rowCount: rawRows.length,
    }
    usedSourceStates[model] = state
    hasSourceRows ||= rawRows.length > 0
    const currentSourceIssue = sourceIssue(widgetId, model, state)
    if (currentSourceIssue) issues.push(currentSourceIssue)
    if (state.status === "loading" || state.status === "denied" || state.status === "unavailable") return

    const bindingResult = parseBinding(row.configuration)
    if (!bindingResult.ok) {
      pushDiagnostic(bindingResult)
      return
    }
    const binding = bindingResult.value

    const domainResult = applyDomain(rawRows, (row.domain as string | null | undefined) ?? null)
    if (!domainResult.ok) {
      pushDiagnostic(domainResult)
      return
    }

    const timeResult = applyTimeRange(
      domainResult.value,
      binding?.timeField ?? null,
      options?.startMs,
      options?.endMs,
    )
    if (!timeResult.ok) {
      pushDiagnostic(timeResult)
      return
    }

    const sortResult = parseSortOrder(row.sortOrder ?? row.sort_order)
    if (!sortResult.ok) {
      pushDiagnostic(sortResult)
      return
    }

    const fields = Array.isArray(row.fields) ? row.fields.map((field) => String(field)) : []
    const primaryField = fields[0] ?? "id"
    const groupBy = String(row.groupBy ?? row.group_by ?? "")
    const aggregationResult = normalizeAggregation(row.aggregation)
    if (!aggregationResult.ok) {
      pushDiagnostic(aggregationResult)
      return
    }
    const measureResult = applyMeasureCompleteness(
      timeResult.value,
      primaryField,
      aggregationResult.value,
      binding,
    )
    if (!measureResult.ok) {
      pushDiagnostic(measureResult)
      return
    }

    const sourceRows = measureResult.value
    const chartType = String(row.chartType ?? row.chart_type ?? "bar").toLowerCase()
    const widgetType = widgetTypeTag(row.widgetType ?? row.widget_type)

    if (widgetType === "Kpi") {
      const value = aggregateValue(sourceRows, primaryField, aggregationResult.value)
      const isCurrency = primaryField.includes("amount") || primaryField.includes("revenue")
      widgets.push({
        id: widgetId,
        type: "kpi",
        title,
        width,
        data: {
          value: isCurrency ? `$${Math.round(value).toLocaleString()}` : value.toLocaleString(),
          label: title,
        },
      })
      return
    }

    if (widgetType === "Chart") {
      if (!groupBy) {
        pushDiagnostic({
          code: "missing-group-by",
          message: "A chart widget requires a group-by field.",
        })
        return
      }
      const groups = new Map<string, Record<string, unknown>[]>()
      for (const sourceRow of sourceRows) {
        const rawKey = rowField(sourceRow, groupBy)
        const timestamp = binding?.timeField === groupBy ? timestampToMs(rawKey) : null
        const key = timestamp == null
          ? scalarField(rawKey) || "—"
          : new Date(timestamp).toISOString().slice(0, 10)
        const bucket = groups.get(key) ?? []
        bucket.push(sourceRow)
        groups.set(key, bucket)
      }
      const groupedValues = [...groups.entries()].map(([name, grouped]) => ({
        name,
        value: aggregateValue(grouped, primaryField, aggregationResult.value),
      }))
      if (sortResult.value?.field === groupBy) {
        groupedValues.sort((a, b) =>
          sortResult.value!.direction === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name),
        )
      } else if (sortResult.value?.field === "value") {
        groupedValues.sort((a, b) =>
          sortResult.value!.direction === "asc" ? a.value - b.value : b.value - a.value,
        )
      } else {
        groupedValues.sort((a, b) => b.value - a.value)
      }
      const entries = groupedValues.slice(0, Number(row.limit ?? 12))
      const admittedDrillTarget = entries.some((entry) =>
        resolveStoredDashboardDrillTarget(model, groupBy, entry.name) !== null,
      )
      const onDrill = admittedDrillTarget && options?.onDrillTarget
        ? (value: string) => {
            const target = resolveStoredDashboardDrillTarget(model, groupBy, value)
            if (target) options.onDrillTarget?.(target)
          }
        : undefined

      if (chartType === "pie" || chartType === "donut") {
        widgets.push({
          id: widgetId,
          type: "donut-chart",
          title,
          width,
          data: {
            segments: entries.map((entry, colorIndex) => ({
              name: entry.name,
              value: entry.value,
              color: CHART_COLORS[colorIndex % CHART_COLORS.length],
            })),
            onSegmentClick: onDrill,
          },
        })
        return
      }
      if (chartType === "line" || chartType === "area") {
        widgets.push({
          id: widgetId,
          type: chartType === "area" ? "area-chart" : "line-chart",
          title,
          width,
          data: {
            xAxisKey: "category",
            series: [{ name: primaryField, color: CHART_COLORS[0] }],
            values: entries.map((entry) => ({ category: entry.name, [primaryField]: entry.value })),
          },
        })
        return
      }
      if (chartType !== "bar") {
        pushDiagnostic({
          code: "invalid-chart-type",
          message: `The chart type ${chartType} is not supported.`,
        })
        return
      }
      widgets.push({
        id: widgetId,
        type: "bar-chart",
        title,
        width,
        data: {
          categoryKey: "category",
          layout: "horizontal",
          series: [{ name: "Value", color: CHART_COLORS[0] }],
          values: entries.map((entry) => ({ category: entry.name, Value: entry.value })),
          onCategoryClick: onDrill,
        },
      })
      return
    }

    if (widgetType === "Table" || widgetType === "List") {
      const limit = Number(row.limit ?? 10)
      const displayFields = fields.length > 0 ? fields : ["name"]
      const orderedRows = sortResult.value ? sortRowsByField(sourceRows, sortResult.value) : sourceRows
      widgets.push({
        id: widgetId,
        type: "table",
        title,
        width,
        data: {
          columns: displayFields.map((field) => ({ key: snakeToCamel(field), label: field.replace(/_/g, " ") })),
          rows: orderedRows.slice(0, limit).map((sourceRow) => {
            const output: Record<string, string | number> = {}
            for (const field of displayFields) {
              const raw = rowField(sourceRow, field)
              output[snakeToCamel(field)] = typeof raw === "number" ? raw : scalarField(raw) || "—"
            }
            return output
          }),
        },
      })
      return
    }

    pushDiagnostic({
      code: "invalid-widget-type",
      message: `The widget type ${widgetType || "(empty)"} is not supported.`,
    })
  })

  return {
    widgets,
    issues,
    sourceStates: usedSourceStates,
    state: resolutionState(widgets, issues, hasSourceRows),
  }
}

/** Compatibility helper that preserves safe diagnostic cards. */
export function resolveStoredDashboardWidgets(
  widgetRows: Record<string, unknown>[],
  widgetIds: Array<bigint | number>,
  dataSources: StoredDashboardDataSources,
  options?: StoredDashboardResolverOptions,
): DashboardWidget[] {
  return resolveStoredDashboard(widgetRows, widgetIds, dataSources, options).widgets
}

export function storedDashboardExportGate(
  resolution: StoredDashboardResolution,
): StoredDashboardExportGate {
  if (resolution.state === "ready" || resolution.state === "empty") return { allowed: true }
  return {
    allowed: false,
    reason: resolution.issues[0]?.message ?? `Dashboard export is blocked while data is ${resolution.state}.`,
  }
}

export function widgetModelsForDashboard(
  dashboard: Record<string, unknown>,
  widgetRows: Record<string, unknown>[],
): string[] {
  const widgetIds = (dashboard.widgetIds ?? dashboard.widget_ids) as Array<bigint | number> | undefined
  if (!widgetIds?.length) return []

  const idSet = new Set(widgetIds.map((id) => String(id)))
  const models = new Set<string>()
  for (const row of widgetRows) {
    if (!idSet.has(String(row.id ?? ""))) continue
    const model = String(row.model ?? "").trim()
    if (model) models.add(model)
  }
  return [...models]
}
