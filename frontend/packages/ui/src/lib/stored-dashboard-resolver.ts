import type { DashboardWidget, GridWidth } from "./dashboard-types"

export type StoredDashboardDataSources = Record<string, Record<string, unknown>[]>

export interface StoredDashboardResolverOptions {
  startMs?: number
  endMs?: number
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

function applyDomain(
  rows: Record<string, unknown>[],
  domain?: string | null,
): Record<string, unknown>[] {
  if (!domain?.trim()) return rows
  try {
    const parsed = JSON.parse(domain) as Record<string, unknown>
    return rows.filter((row) =>
      Object.entries(parsed).every(([key, expected]) => {
        const actual = scalarField(rowField(row, key))
        if (expected && typeof expected === "object" && !Array.isArray(expected)) {
          const ops = expected as Record<string, unknown>
          return Object.entries(ops).every(([op, operand]) => {
            if (op === "$in") {
              return Array.isArray(operand) && operand.map((v) => String(v)).includes(actual)
            }
            if (op === "$ne") {
              return actual.toLowerCase() !== String(operand).toLowerCase()
            }
            if (op === "$gte" || op === "$lte" || op === "$gt" || op === "$lt") {
              const a = Number(actual)
              const b = Number(operand)
              if (!Number.isFinite(a) || !Number.isFinite(b)) return false
              if (op === "$gte") return a >= b
              if (op === "$lte") return a <= b
              if (op === "$gt") return a > b
              return a < b
            }
            return true
          })
        }
        return actual.toLowerCase() === String(expected).toLowerCase()
      }),
    )
  } catch {
    return rows
  }
}

interface SortOrder {
  field: string
  direction: "asc" | "desc"
}

function parseSortOrder(raw: unknown): SortOrder | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entry = Object.entries(parsed)[0]
    if (!entry) return null
    const [field, dir] = entry
    if (!field) return null
    return {
      field,
      direction: String(dir).toLowerCase() === "asc" ? "asc" : "desc",
    }
  } catch {
    return null
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
    const cmp =
      Number.isFinite(an) && Number.isFinite(bn)
        ? an - bn
        : scalarField(av).localeCompare(scalarField(bv))
    return sortOrder.direction === "asc" ? cmp : -cmp
  })
}

const TIMESTAMP_FIELDS = ["date_order", "date", "create_date"]

function timestampToMs(raw: unknown): number | null {
  if (raw == null) return null
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    if ("some" in obj) return timestampToMs(obj.some)
    const toDate = (obj as { toDate?: () => Date }).toDate
    if (typeof toDate === "function") {
      const date = toDate.call(raw)
      return date instanceof Date ? date.getTime() : null
    }
    if ("__timestamp_micros_since_unix_epoch__" in obj) {
      return timestampToMs(obj.__timestamp_micros_since_unix_epoch__)
    }
    return null
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e15 ? n / 1000 : n
}

function applyTimeRange(
  rows: Record<string, unknown>[],
  startMs?: number,
  endMs?: number,
): Record<string, unknown>[] {
  if (startMs == null && endMs == null) return rows
  return rows.filter((row) => {
    let ms: number | null = null
    for (const field of TIMESTAMP_FIELDS) {
      ms = timestampToMs(rowField(row, field))
      if (ms != null) break
    }
    if (ms == null) return true
    if (startMs != null && ms < startMs) return false
    if (endMs != null && ms > endMs) return false
    return true
  })
}

function aggregateValue(
  rows: Record<string, unknown>[],
  field: string,
  aggregation?: string | null,
): number {
  const agg = (aggregation ?? "count").toLowerCase()
  if (agg === "count") return rows.length
  const values = rows
    .map((row) => Number(rowField(row, field) ?? 0))
    .filter((n) => Number.isFinite(n))
  if (values.length === 0) return 0
  if (agg === "sum") return values.reduce((sum, n) => sum + n, 0)
  if (agg === "average" || agg === "avg") return values.reduce((sum, n) => sum + n, 0) / values.length
  if (agg === "min") return Math.min(...values)
  if (agg === "max") return Math.max(...values)
  return rows.length
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

export function resolveStoredDashboardWidgets(
  widgetRows: Record<string, unknown>[],
  widgetIds: Array<bigint | number>,
  dataSources: StoredDashboardDataSources,
  options?: StoredDashboardResolverOptions,
): DashboardWidget[] {
  const idSet = new Set(widgetIds.map((id) => String(id)))
  const widgets = widgetRows
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

  const resolved: DashboardWidget[] = []

  widgets.forEach((row, index) => {
    const model = String(row.model ?? "")
    const sourceRows = applyTimeRange(
      applyDomain(
        dataSources[model] ?? [],
        (row.domain as string | null | undefined) ?? null,
      ),
      options?.startMs,
      options?.endMs,
    )
    const sortOrder = parseSortOrder(row.sortOrder ?? row.sort_order)
    const fields = Array.isArray(row.fields)
      ? row.fields.map((f) => String(f))
      : []
    const primaryField = fields[0] ?? "id"
    const groupBy = String(row.groupBy ?? row.group_by ?? "")
    const aggregation = String(row.aggregation ?? "count")
    const chartType = String(row.chartType ?? row.chart_type ?? "bar").toLowerCase()
    const widgetType = widgetTypeTag(row.widgetType ?? row.widget_type)
    const title = String(row.name ?? "Widget")
    const width = gridWidthFromColumns(Number(row.width ?? 6))
    const id = String(row.id ?? index)

    if (widgetType === "Kpi") {
      const value = aggregateValue(sourceRows, primaryField, aggregation)
      const isCurrency = primaryField.includes("amount") || primaryField.includes("revenue")
      resolved.push({
        id,
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

    if (widgetType === "Chart" && groupBy) {
        const groups = new Map<string, Record<string, unknown>[]>()
        for (const sourceRow of sourceRows) {
          const key = scalarField(rowField(sourceRow, groupBy)) || "—"
          const bucket = groups.get(key) ?? []
          bucket.push(sourceRow)
          groups.set(key, bucket)
        }
        const unsorted = [...groups.entries()].map(([name, grouped]) => ({
          name,
          value: aggregateValue(grouped, primaryField, aggregation),
        }))
        if (sortOrder && sortOrder.field === groupBy) {
          unsorted.sort((a, b) =>
            sortOrder.direction === "asc"
              ? a.name.localeCompare(b.name)
              : b.name.localeCompare(a.name),
          )
        } else if (sortOrder && sortOrder.field === "value") {
          unsorted.sort((a, b) =>
            sortOrder.direction === "asc" ? a.value - b.value : b.value - a.value,
          )
        } else {
          unsorted.sort((a, b) => b.value - a.value)
        }
        const entries = unsorted.slice(0, Number(row.limit ?? 12))

        if (chartType === "pie" || chartType === "donut") {
          resolved.push({
            id,
            type: "donut-chart",
            title,
            width,
            data: {
              segments: entries.map((entry, i) => ({
                name: entry.name,
                value: entry.value,
                color: CHART_COLORS[i % CHART_COLORS.length],
              })),
            },
          })
          return
        }

        if (chartType === "line" || chartType === "area") {
          resolved.push({
            id,
            type: chartType === "area" ? "area-chart" : "line-chart",
            title,
            width,
            data: {
              xAxisKey: "category",
              series: [{ name: primaryField, color: CHART_COLORS[0] }],
              values: entries.map((entry) => ({
                category: entry.name,
                [primaryField]: entry.value,
              })),
            },
          })
          return
        }

        resolved.push({
          id,
          type: "bar-chart",
          title,
          width,
          data: {
            categoryKey: "category",
            layout: "horizontal",
            series: [{ name: "Value", color: CHART_COLORS[0] }],
            values: entries.map((entry) => ({
              category: entry.name,
              Value: entry.value,
            })),
          },
        })
      return
    }

    if (widgetType === "Table" || widgetType === "List") {
      const limit = Number(row.limit ?? 10)
      const displayFields = fields.length > 0 ? fields : ["name"]
      const orderedRows = sortOrder ? sortRowsByField(sourceRows, sortOrder) : sourceRows
      resolved.push({
        id,
        type: "table",
        title,
        width,
        data: {
          columns: displayFields.map((field) => ({
            key: snakeToCamel(field),
            label: field.replace(/_/g, " "),
          })),
          rows: orderedRows.slice(0, limit).map((sourceRow) => {
            const out: Record<string, string | number> = {}
            for (const field of displayFields) {
              const camel = snakeToCamel(field)
              const raw = rowField(sourceRow, field)
              out[camel] =
                typeof raw === "number" ? raw : scalarField(raw) || "—"
            }
            return out
          }),
        },
      })
    }
  })

  return resolved
}

export function widgetModelsForDashboard(
  dashboard: Record<string, unknown>,
  widgetRows: Record<string, unknown>[],
): string[] {
  const widgetIds = (dashboard.widgetIds ?? dashboard.widget_ids) as
    | Array<bigint | number>
    | undefined
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
