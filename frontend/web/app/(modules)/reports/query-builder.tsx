"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button, Input, Label, DashboardWidgetRenderer, resolveStoredDashboardWidgets } from "@lumiere/ui"
import { Checkbox } from "@lumiere/ui/components/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import {
  QUERY_RESOURCE_KEYS,
  RESOURCE_REGISTRY,
} from "@lumiere/stdb/generated/query-registry"
import {
  useAddWidgetToDashboard,
  useCreateDashboardWidget,
} from "@lumiere/query-hooks/hooks/reports"
import { apiFetch } from "@lumiere/query-hooks/http"
import { useStoredDashboardDataSources } from "@/hooks/use-stored-dashboard-data-sources"
import { Plus, Save, Trash2 } from "lucide-react"

type QueryBuilderProps = {
  organizationId: bigint
  dashboards: Record<string, unknown>[]
}

type WidgetKind = "kpi" | "chart" | "table"
type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in"

interface FilterRow {
  field: string
  op: FilterOp
  value: string
}

const FILTER_OPS: Array<{ value: FilterOp; label: string }> = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "in", label: "in (comma-separated)" },
]

const AGGREGATIONS = ["count", "sum", "avg", "min", "max"] as const
const CHART_TYPES = ["bar", "line", "area", "pie"] as const

/** Tables that make no sense as self-serve widget sources. */
const EXCLUDED_TABLES = new Set(["casbin_rule", "ai_reducer_allowlist"])

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Scalar value extraction matching the stored-dashboard resolver conventions. */
function scalarish(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === "number" || typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("tag" in obj && typeof obj.tag === "string") return obj.tag
    if ("some" in obj) return scalarish(obj.some)
  }
  return null
}

interface FieldInfo {
  /** snake_case field name persisted on the widget row */
  field: string
  label: string
  numeric: boolean
}

function discoverFields(rows: Record<string, unknown>[]): FieldInfo[] {
  const sample = rows.slice(0, 50)
  const numeric = new Map<string, boolean>()

  for (const row of sample) {
    for (const [key, raw] of Object.entries(row)) {
      const value = scalarish(raw)
      if (value == null) {
        if (!numeric.has(key) && raw != null) continue
        if (!numeric.has(key)) numeric.set(key, true)
        continue
      }
      const isNum = typeof value === "number" || (value !== "" && Number.isFinite(Number(value)))
      numeric.set(key, (numeric.get(key) ?? true) && isNum)
    }
  }

  return [...numeric.entries()]
    .map(([key, isNumeric]) => {
      const snake = camelToSnake(key)
      return { field: snake, label: humanize(snake), numeric: isNumeric }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

function buildDomain(filters: FilterRow[]): string | undefined {
  const domain: Record<string, unknown> = {}
  for (const { field, op, value } of filters) {
    if (!field || value.trim() === "") continue
    if (op === "eq") {
      domain[field] = value.trim()
    } else if (op === "in") {
      domain[field] = { $in: value.split(",").map((v) => v.trim()).filter(Boolean) }
    } else {
      const n = Number(value)
      domain[field] = { [`$${op}`]: Number.isFinite(n) ? n : value.trim() }
    }
  }
  return Object.keys(domain).length > 0 ? JSON.stringify(domain) : undefined
}

export function QueryBuilder({ organizationId, dashboards }: QueryBuilderProps) {
  const { t } = useTranslation()

  const [model, setModel] = useState("")
  const [widgetKind, setWidgetKind] = useState<WidgetKind>("chart")
  const [aggregation, setAggregation] = useState<string>("count")
  const [aggField, setAggField] = useState("")
  const [groupBy, setGroupBy] = useState("")
  const [chartType, setChartType] = useState<string>("bar")
  const [displayFields, setDisplayFields] = useState<string[]>([])
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [sortField, setSortField] = useState("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [limit, setLimit] = useState("10")
  const [name, setName] = useState("")
  const [attachDashboardId, setAttachDashboardId] = useState("")
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null)

  const createWidget = useCreateDashboardWidget(organizationId)
  const addWidgetToDashboard = useAddWidgetToDashboard(organizationId)

  const modelOptions = useMemo(
    () =>
      QUERY_RESOURCE_KEYS.map((key) => RESOURCE_REGISTRY[key]?.table ?? "")
        .filter((table) => table && !EXCLUDED_TABLES.has(table))
        .sort()
        .map((table) => ({ value: table, label: humanize(table) })),
    [],
  )

  const models = useMemo(() => (model ? [model] : []), [model])
  const { dataSources, isLoading } = useStoredDashboardDataSources(organizationId, models)
  const rows = useMemo(() => (model ? dataSources[model] ?? [] : []), [dataSources, model])

  const fields = useMemo(() => discoverFields(rows), [rows])
  const numericFields = useMemo(() => fields.filter((f) => f.numeric), [fields])

  const domain = useMemo(() => buildDomain(filters), [filters])

  const sortOrder = useMemo(() => {
    if (!sortField) return undefined
    return JSON.stringify({ [sortField]: sortDir })
  }, [sortField, sortDir])

  const widgetFields = useMemo(() => {
    if (widgetKind === "table") return displayFields
    if (aggregation !== "count" && aggField) return [aggField]
    return []
  }, [widgetKind, displayFields, aggregation, aggField])

  const previewWidget = useMemo(() => {
    if (!model) return null
    if (widgetKind === "chart" && !groupBy) return null
    if (widgetKind === "table" && displayFields.length === 0) return null

    const syntheticRow: Record<string, unknown> = {
      id: 0,
      name: name.trim() || t("reports.queryBuilder.preview"),
      widgetType: widgetKind === "kpi" ? "Kpi" : widgetKind === "chart" ? "Chart" : "Table",
      model,
      fields: widgetFields,
      groupBy: groupBy || undefined,
      aggregation,
      chartType: widgetKind === "chart" ? chartType : undefined,
      domain,
      sortOrder,
      limit: Number(limit) > 0 ? Number(limit) : 10,
      width: 12,
      positionX: 0,
      positionY: 0,
      isActive: true,
    }

    const resolved = resolveStoredDashboardWidgets([syntheticRow], [0], dataSources)
    return resolved[0] ?? null
  }, [
    model,
    widgetKind,
    groupBy,
    displayFields,
    name,
    widgetFields,
    aggregation,
    chartType,
    domain,
    sortOrder,
    limit,
    dataSources,
    t,
  ])

  const canSave = Boolean(name.trim() && previewWidget && !createWidget.isPending)

  const handleModelChange = (next: string) => {
    setModel(next)
    setAggField("")
    setGroupBy("")
    setDisplayFields([])
    setFilters([])
    setSortField("")
    setStatus(null)
  }

  const toggleDisplayField = (field: string) => {
    setDisplayFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    )
  }

  const handleSave = async () => {
    setStatus(null)
    try {
      await createWidget.mutateAsync({
        name: name.trim(),
        widgetType: widgetKind,
        dataSource: model,
        fields: widgetFields,
        domain,
        groupBy: groupBy || undefined,
        aggregation,
        chartType: widgetKind === "chart" ? chartType : undefined,
        sortOrder,
        limit,
        width: 6,
        height: 300,
      })

      if (attachDashboardId) {
        const response = await apiFetch("/api/query/dashboard-widgets")
        if (response.ok) {
          const json = (await response.json()) as { data?: Record<string, unknown>[] }
          const match = (json.data ?? [])
            .filter((row) => String(row.name ?? "") === name.trim())
            .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]
          if (match?.id != null) {
            await addWidgetToDashboard.mutateAsync({
              dashboardId: attachDashboardId,
              widgetId: String(match.id),
            })
            setStatus({
              kind: "ok",
              message: t("reports.queryBuilder.savedAttached", { name: name.trim() }),
            })
            return
          }
        }
      }
      setStatus({ kind: "ok", message: t("reports.queryBuilder.saved", { name: name.trim() }) })
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="query-builder">
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.queryBuilder.title")}</CardTitle>
          <CardDescription>{t("reports.queryBuilder.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("reports.queryBuilder.model")}</Label>
              <Select value={model} onValueChange={handleModelChange}>
                <SelectTrigger data-testid="qb-model">
                  <SelectValue placeholder={t("reports.queryBuilder.modelPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {modelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {model ? (
                <p className="text-xs text-muted-foreground">
                  {isLoading
                    ? "…"
                    : t("reports.queryBuilder.rowsLoaded", { count: rows.length })}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>{t("reports.queryBuilder.widgetType")}</Label>
              <Select value={widgetKind} onValueChange={(v) => setWidgetKind(v as WidgetKind)}>
                <SelectTrigger data-testid="qb-widget-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kpi">{t("reports.queryBuilder.widgetTypes.kpi")}</SelectItem>
                  <SelectItem value="chart">{t("reports.queryBuilder.widgetTypes.chart")}</SelectItem>
                  <SelectItem value="table">{t("reports.queryBuilder.widgetTypes.table")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {widgetKind !== "table" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.aggregation")}</Label>
                <Select value={aggregation} onValueChange={setAggregation}>
                  <SelectTrigger data-testid="qb-aggregation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGGREGATIONS.map((agg) => (
                      <SelectItem key={agg} value={agg}>
                        {agg}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {aggregation !== "count" ? (
                <div className="space-y-1.5">
                  <Label>{t("reports.queryBuilder.aggregationField")}</Label>
                  <Select value={aggField} onValueChange={setAggField}>
                    <SelectTrigger data-testid="qb-agg-field">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {numericFields.map((f) => (
                        <SelectItem key={f.field} value={f.field}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}

          {widgetKind === "chart" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.groupBy")}</Label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger data-testid="qb-group-by">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {fields.map((f) => (
                      <SelectItem key={f.field} value={f.field}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.chartType")}</Label>
                <Select value={chartType} onValueChange={setChartType}>
                  <SelectTrigger data-testid="qb-chart-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHART_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {humanize(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {widgetKind === "table" && fields.length > 0 ? (
            <div className="space-y-1.5">
              <Label>{t("reports.queryBuilder.displayFields")}</Label>
              <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f.field} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={displayFields.includes(f.field)}
                      onCheckedChange={() => toggleDisplayField(f.field)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("reports.queryBuilder.filters")}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={fields.length === 0}
                onClick={() => setFilters((prev) => [...prev, { field: "", op: "eq", value: "" }])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("reports.queryBuilder.addFilter")}
              </Button>
            </div>
            {filters.map((filter, index) => (
              <div key={index} className="flex items-center gap-2">
                <Select
                  value={filter.field}
                  onValueChange={(v) =>
                    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, field: v } : f)))
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {fields.map((f) => (
                      <SelectItem key={f.field} value={f.field}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filter.op}
                  onValueChange={(v) =>
                    setFilters((prev) =>
                      prev.map((f, i) => (i === index ? { ...f, op: v as FilterOp } : f)),
                    )
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_OPS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="flex-1"
                  value={filter.value}
                  onChange={(e) =>
                    setFilters((prev) =>
                      prev.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFilters((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {widgetKind !== "kpi" ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.sortBy")}</Label>
                <Select
                  value={sortField || "__none__"}
                  onValueChange={(v) => setSortField(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger data-testid="qb-sort-field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">{t("reports.queryBuilder.sortNone")}</SelectItem>
                    {widgetKind === "chart" ? (
                      <SelectItem value="value">Value</SelectItem>
                    ) : null}
                    {fields.map((f) => (
                      <SelectItem key={f.field} value={f.field}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>&nbsp;</Label>
                <Select value={sortDir} onValueChange={(v) => setSortDir(v as "asc" | "desc")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.limit")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-4 border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.widgetName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("reports.queryBuilder.widgetNamePlaceholder")}
                  data-testid="qb-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("reports.queryBuilder.attachDashboard")}</Label>
                <Select
                  value={attachDashboardId || "__none__"}
                  onValueChange={(v) => setAttachDashboardId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger data-testid="qb-attach-dashboard">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">{t("reports.queryBuilder.attachNone")}</SelectItem>
                    {dashboards.map((dashboard) => (
                      <SelectItem key={String(dashboard.id)} value={String(dashboard.id)}>
                        {String(dashboard.name ?? dashboard.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              type="button"
              className="gap-2"
              disabled={!canSave}
              onClick={() => void handleSave()}
              data-testid="qb-save"
            >
              <Save className="h-4 w-4" />
              {t("reports.queryBuilder.save")}
            </Button>
            {status ? (
              <p
                className={
                  status.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"
                }
              >
                {status.message}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("reports.queryBuilder.preview")}</CardTitle>
        </CardHeader>
        <CardContent>
          {previewWidget ? (
            <div className="grid grid-cols-1 gap-4">
              <DashboardWidgetRenderer
                widget={previewWidget}
                widthClass="col-span-1"
                testId="qb-preview-widget"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {model && rows.length === 0 && !isLoading
                ? t("reports.queryBuilder.previewNoRows")
                : t("reports.queryBuilder.previewEmpty")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
