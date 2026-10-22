"use client"

import { useMemo, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button, Input, Label, DashboardWidgetRenderer, resolveStoredDashboard } from "@lumiere/ui"
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
import { useStoredDashboardDataSources } from "@/hooks/use-stored-dashboard-data-sources"
import { Plus, Save, Trash2 } from "lucide-react"
import { queryBuilderSourceState } from "./query-builder-source-state"
import {
  buildQueryBuilderDomain,
  discoverQueryBuilderFields,
  storedDashboardBindingConfiguration,
  type QueryBuilderFilterOp,
  type QueryBuilderFilterRow,
} from "./query-builder-semantics"

export type QueryBuilderStatus = {
  kind: "ok" | "error"
  message: string
  href?: string
}

type QueryBuilderProps = {
  organizationId: bigint
  companyId?: bigint
  dashboards: Record<string, unknown>[]
  status: QueryBuilderStatus | null
  onStatusChange: (status: QueryBuilderStatus | null) => void
}

type WidgetKind = "kpi" | "chart" | "table"
const FILTER_OPS: Array<{ value: QueryBuilderFilterOp; label: string }> = [
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
const EXCLUDED_TABLES = new Set(["field_permission", "ai_reducer_allowlist"])

function humanize(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function QueryBuilder({
  organizationId,
  companyId,
  dashboards,
  status,
  onStatusChange,
}: QueryBuilderProps) {
  const { t } = useTranslation()

  const [model, setModel] = useState("")
  const [widgetKind, setWidgetKind] = useState<WidgetKind>("chart")
  const [aggregation, setAggregation] = useState<string>("count")
  const [aggField, setAggField] = useState("")
  const [groupBy, setGroupBy] = useState("")
  const [chartType, setChartType] = useState<string>("bar")
  const [displayFields, setDisplayFields] = useState<string[]>([])
  const [filters, setFilters] = useState<QueryBuilderFilterRow[]>([])
  const [timeField, setTimeField] = useState("")
  const [sortField, setSortField] = useState("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [limit, setLimit] = useState("10")
  const [name, setName] = useState("")
  const [attachDashboardId, setAttachDashboardId] = useState("")
  const saveAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null)

  const createWidget = useCreateDashboardWidget(organizationId)
  const addWidgetToDashboard = useAddWidgetToDashboard(organizationId)

  const modelOptions = useMemo(
    () =>
      [...new Set(
        QUERY_RESOURCE_KEYS.map((key) => RESOURCE_REGISTRY[key]?.table ?? "")
          .filter((table) => table && !EXCLUDED_TABLES.has(table)),
      )]
        .sort()
        .map((table) => ({ value: table, label: humanize(table) })),
    [],
  )

  const models = useMemo(() => (model ? [model] : []), [model])
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const { dataSources, sourceStates, isRefreshing, retry } =
    useStoredDashboardDataSources(organizationId, models)
  const rows = useMemo(() => (model ? dataSources[model] ?? [] : []), [dataSources, model])
  const sourceState = queryBuilderSourceState(
    model,
    sourceStates[model],
    isRefreshing,
  )
  const sourceMessage = model ? sourceStates[model]?.message : undefined

  const fields = useMemo(() => discoverQueryBuilderFields(rows), [rows])
  const numericFields = useMemo(() => fields.filter((field) => field.kind === "measure"), [fields])
  const timestampFields = useMemo(
    () => fields.filter((field) => field.kind === "timestamp"),
    [fields],
  )

  const domain = useMemo(() => buildQueryBuilderDomain(filters), [filters])

  const sortOrder = useMemo(() => {
    if (!sortField) return undefined
    return JSON.stringify({ [sortField]: sortDir })
  }, [sortField, sortDir])

  const widgetFields = useMemo(() => {
    if (widgetKind === "table") return displayFields
    if (aggregation !== "count" && aggField) return [aggField]
    return []
  }, [widgetKind, displayFields, aggregation, aggField])

  const bindingConfiguration = useMemo(
    () => storedDashboardBindingConfiguration(timeField, aggregation === "count" ? "" : aggField),
    [timeField, aggregation, aggField],
  )

  const previewResolution = useMemo(() => {
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
      configuration: bindingConfiguration,
      domain,
      sortOrder,
      limit: Number(limit) > 0 ? Number(limit) : 10,
      width: 12,
      positionX: 0,
      positionY: 0,
      isActive: true,
    }

    return resolveStoredDashboard([syntheticRow], [0], dataSources, { sourceStates })
  }, [
    model,
    widgetKind,
    groupBy,
    displayFields,
    name,
    widgetFields,
    aggregation,
    chartType,
    bindingConfiguration,
    domain,
    sortOrder,
    limit,
    dataSources,
    sourceStates,
    t,
  ])

  const previewWidget = previewResolution?.widgets[0] ?? null

  const canSave = Boolean(
    name.trim() &&
    previewWidget &&
    (aggregation === "count" || Boolean(aggField)) &&
    (sourceState === "ready" || sourceState === "empty") &&
    (previewResolution?.state === "ready" || previewResolution?.state === "empty") &&
    !createWidget.isPending,
  )

  const handleModelChange = (next: string) => {
    setModel(next)
    setAggField("")
    setGroupBy("")
    setDisplayFields([])
    setFilters([])
    setTimeField("")
    setSortField("")
    onStatusChange(null)
  }

  const toggleDisplayField = (field: string) => {
    setDisplayFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    )
  }

  const handleSourceRetry = async () => {
    await retry()
    modelTriggerRef.current?.focus()
  }

  const handleSave = async () => {
    onStatusChange(null)
    const widgetInput = {
      name: name.trim(),
      companyId: companyId?.toString() ?? "",
      widgetType: widgetKind,
      dataSource: model,
      fields: widgetFields,
      domain,
      groupBy: groupBy || undefined,
      aggregation,
      config: bindingConfiguration,
      chartType: widgetKind === "chart" ? chartType : undefined,
      sortOrder,
      limit,
      width: 6,
      height: 300,
    }
    const fingerprint = JSON.stringify(widgetInput)
    const priorAttempt = saveAttemptRef.current
    const requestId =
      priorAttempt?.fingerprint === fingerprint
        ? priorAttempt.requestId
        : globalThis.crypto.randomUUID()
    saveAttemptRef.current = { fingerprint, requestId }

    try {
      const created = await createWidget.mutateAsync({
        ...widgetInput,
        creationRequestId: requestId,
      })

      if (attachDashboardId) {
        const attached = await addWidgetToDashboard.mutateAsync({
          dashboardId: attachDashboardId,
          widgetId: created.ref.id,
        })
        saveAttemptRef.current = null
        onStatusChange({
          kind: "ok",
          message: t("reports.queryBuilder.savedAttached", { name: name.trim() }),
          href: attached.ref.href,
        })
        return
      }
      saveAttemptRef.current = null
      onStatusChange({
        kind: "ok",
        message: t("reports.queryBuilder.saved", { name: name.trim() }),
        href: created.ref.href,
      })
    } catch (e) {
      onStatusChange({ kind: "error", message: e instanceof Error ? e.message : String(e) })
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
              <Label htmlFor="qb-model">{t("reports.queryBuilder.model")}</Label>
              <Select value={model} onValueChange={handleModelChange}>
                <SelectTrigger id="qb-model" ref={modelTriggerRef} data-testid="qb-model">
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
              {sourceState === "loading" ? (
                <p
                  className="text-xs text-muted-foreground"
                  role="status"
                  data-testid="qb-source-loading"
                >
                  {t("common.loading", "Loading…")}
                </p>
              ) : sourceState === "refreshing" ? (
                <p
                  className="text-xs text-muted-foreground"
                  role="status"
                  data-testid="qb-source-refreshing"
                >
                  {t("reports.queryBuilder.sourceRefreshing")}
                </p>
              ) : sourceState === "denied" || sourceState === "error" || sourceState === "unavailable" ? (
                <div
                  className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                  role="alert"
                  data-testid={sourceState === "denied" ? "qb-source-denied" : "qb-source-error"}
                >
                  <p>
                    {sourceState === "denied"
                      ? t("reports.queryBuilder.sourceDenied")
                      : sourceMessage ?? t("reports.queryBuilder.sourceError")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSourceRetry()}
                    data-testid="qb-source-retry"
                  >
                    {t("reports.queryBuilder.retrySource")}
                  </Button>
                </div>
              ) : sourceState === "partial" ? (
                <p
                  className="text-xs text-destructive"
                  role="alert"
                  data-testid={`qb-source-${sourceState}`}
                >
                  {sourceMessage ?? t(`reports.queryBuilder.sourceStates.${sourceState}`)}
                </p>
              ) : sourceState === "empty" || sourceState === "ready" ? (
                <p
                  className="text-xs text-muted-foreground"
                  role="status"
                  data-testid="qb-source-row-count"
                >
                  {t("reports.queryBuilder.rowsLoaded", { count: rows.length })}
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

          <div className="space-y-1.5">
            <Label>{t("reports.queryBuilder.timeField")}</Label>
            <Select
              value={timeField || "__none__"}
              onValueChange={(value) => setTimeField(value === "__none__" ? "" : value)}
            >
              <SelectTrigger data-testid="qb-time-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__none__">{t("reports.queryBuilder.timeFieldNone")}</SelectItem>
                {timestampFields.map((field) => (
                  <SelectItem key={field.field} value={field.field}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("reports.queryBuilder.timeFieldDescription")}
            </p>
          </div>

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

          <div className="@container/filters space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
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
              <div
                key={index}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @xl/filters:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]"
                data-testid="qb-filter-row"
              >
                <Select
                  value={filter.field}
                  onValueChange={(v) =>
                    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, field: v } : f)))
                  }
                >
                  <SelectTrigger className="col-span-2 min-w-0 @xl/filters:col-span-1">
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
                      prev.map((f, i) =>
                        i === index ? { ...f, op: v as QueryBuilderFilterOp } : f,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="col-span-2 min-w-0 @xl/filters:col-span-1">
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
                  className="min-w-0"
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
                  aria-label={t("reports.queryBuilder.removeFilter")}
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
                <Label htmlFor="qb-limit">{t("reports.queryBuilder.limit")}</Label>
                <Input
                  id="qb-limit"
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
                <Label htmlFor="qb-name">{t("reports.queryBuilder.widgetName")}</Label>
                <Input
                  id="qb-name"
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
                role={status.kind === "ok" ? "status" : "alert"}
                className={
                  status.kind === "ok" ? "text-sm text-emerald-600" : "text-sm text-destructive"
                }
              >
                {status.href ? (
                  <a className="underline" href={status.href} data-testid="qb-result-link">
                    {status.message}
                  </a>
                ) : (
                  status.message
                )}
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
          {sourceState === "loading" ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="qb-preview-loading"
            >
              {t("common.loading", "Loading…")}
            </p>
          ) : sourceState === "refreshing" ? (
            <p
              className="text-sm text-muted-foreground"
              role="status"
              data-testid="qb-preview-refreshing"
            >
              {t("reports.queryBuilder.sourceRefreshing")}
            </p>
          ) : sourceState === "error" ? (
            <p className="text-sm text-muted-foreground" data-testid="qb-preview-unavailable">
              {t("reports.queryBuilder.previewUnavailable")}
            </p>
          ) : sourceState === "empty" ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="qb-preview-empty"
            >
              {t("reports.queryBuilder.previewNoRows")}
            </p>
          ) : sourceState === "denied" || sourceState === "unavailable" || sourceState === "partial" ? (
            <p className="text-sm text-destructive" role="alert" data-testid={`qb-preview-${sourceState}`}>
              {sourceMessage ?? t(`reports.queryBuilder.sourceStates.${sourceState}`)}
            </p>
          ) : previewWidget ? (
            <div className="grid grid-cols-1 gap-4">
              <DashboardWidgetRenderer
                widget={previewWidget}
                widthClass="col-span-1"
                testId="qb-preview-widget"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("reports.queryBuilder.previewEmpty")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
