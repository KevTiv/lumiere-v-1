"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useCreateSavedReport,
  useDeleteSavedReport,
  useSavedReports,
  useUpdateSavedReport,
} from "@lumiere/query-hooks/hooks/reports"
import { downloadPivotTableXlsx } from "@lumiere/query-hooks/hooks/templates"
import {
  EntityTable,
  Button,
  Input,
  Label,
} from "@lumiere/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import type { EntityTableConfig } from "@lumiere/ui"
import { FileSpreadsheet, Save, Trash2 } from "lucide-react"

type PivotExplorerProps = {
  organizationId: bigint
  financialReports: Record<string, unknown>[]
  trialBalances: Record<string, unknown>[]
}

function rowField(row: Record<string, unknown>, key: string): string {
  const snake = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
  const raw = row[key] ?? row[snake]
  return raw == null ? "" : String(raw)
}

function rowMeasure(row: Record<string, unknown>, field: string): number {
  const snake = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
  const raw = row[field] ?? row[snake]
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function columnKey(label: string, index: number): string {
  const slug = label.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase()
  return slug ? `col_${slug}` : `col_${index}`
}

export function PivotExplorer({
  organizationId,
  financialReports,
  trialBalances,
}: PivotExplorerProps) {
  const { t } = useTranslation()
  const { data: savedReports = [] } = useSavedReports(organizationId)
  const createSavedReport = useCreateSavedReport(organizationId)
  const updateSavedReport = useUpdateSavedReport(organizationId)
  const deleteSavedReport = useDeleteSavedReport(organizationId)

  const generatedReports = useMemo(
    () =>
      financialReports.filter(
        (r) =>
          String(r.state ?? "").toLowerCase() === "generated" ||
          String(r.state ?? "").toLowerCase() === "exported",
      ),
    [financialReports],
  )

  const [reportId, setReportId] = useState<string>("")
  const [savedReportId, setSavedReportId] = useState<string>("")
  const [name, setName] = useState("Trial balance pivot")
  const [rowDimension, setRowDimension] = useState("accountCode")
  const [columnDimension, setColumnDimension] = useState("")
  const [measureField, setMeasureField] = useState("closingDebit")
  const [measureOp, setMeasureOp] = useState("sum")

  const activeSaved = useMemo(
    () => savedReports.find((r) => String(r.id) === savedReportId),
    [savedReports, savedReportId],
  )

  const sourceRows = useMemo(() => {
    if (!reportId) return []
    return trialBalances.filter((row) => String(row.reportId ?? row.report_id) === reportId)
  }, [reportId, trialBalances])

  const pivot = useMemo(() => {
    const tableHeaders = [rowDimension]
    if (columnDimension.trim()) tableHeaders.push(columnDimension)
    tableHeaders.push(`${measureOp}(${measureField})`)

    const grid = new Map<string, Map<string, number>>()
    for (const row of sourceRows) {
      const rowKey = rowField(row as Record<string, unknown>, rowDimension) || "(blank)"
      const colKey = columnDimension.trim()
        ? rowField(row as Record<string, unknown>, columnDimension) || "(blank)"
        : "total"
      const value = rowMeasure(row as Record<string, unknown>, measureField)
      if (!grid.has(rowKey)) grid.set(rowKey, new Map())
      const cols = grid.get(rowKey)!
      cols.set(colKey, (cols.get(colKey) ?? 0) + value)
    }

    const columnKeys = columnDimension.trim()
      ? Array.from(
          new Set(
            sourceRows.map(
              (r) => rowField(r as Record<string, unknown>, columnDimension) || "(blank)",
            ),
          ),
        ).sort()
      : ["total"]

    const tableRows: Record<string, unknown>[] = []
    const exportRows: (string | number)[][] = []
    let rowIndex = 0
    for (const [rowKey, cols] of Array.from(grid.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const record: Record<string, unknown> = { id: rowIndex, [columnKey(tableHeaders[0], 0)]: rowKey }
      const exportLine: (string | number)[] = [rowKey]
      if (columnDimension.trim()) {
        for (let i = 0; i < columnKeys.length; i++) {
          const col = columnKeys[i]
          const value = Number((cols.get(col) ?? 0).toFixed(2))
          const key = columnKey(col, i + 1)
          record[key] = value
          exportLine.push(value)
        }
      } else {
        const value = Number((cols.get("total") ?? 0).toFixed(2))
        const key = columnKey(measureField, 1)
        record[key] = value
        exportLine.push(value)
      }
      tableRows.push(record)
      exportRows.push(exportLine)
      rowIndex += 1
    }

    const exportHeaders = [
      rowDimension,
      ...columnKeys.map((c) => (columnDimension.trim() ? c : measureField)),
    ]

    return { exportHeaders, exportRows, tableHeaders, tableRows }
  }, [sourceRows, rowDimension, columnDimension, measureField, measureOp])

  const tableConfig = useMemo((): EntityTableConfig => {
    const columns = pivot.tableHeaders.map((header, index) => ({
      key: columnKey(header, index),
      label: header,
      type: index === 0 ? ("text" as const) : ("currency" as const),
      align: index === 0 ? ("left" as const) : ("right" as const),
      width: index === 0 ? "min-w-48" : "min-w-28",
    }))
    return {
      mode: "table",
      rowKey: "id",
      rowSelectionToggleOnClick: false,
      searchable: pivot.tableRows.length > 0,
      searchPlaceholder: t("reports.pivot.searchPlaceholder"),
      searchKeys: columns.map((c) => c.key),
      columns,
      emptyMessage: t("reports.pivot.empty"),
    }
  }, [pivot.tableHeaders, pivot.tableRows.length, t])

  const loadSaved = (id: string) => {
    const row = savedReports.find((r) => String(r.id) === id)
    if (!row) return
    setSavedReportId(id)
    setName(String(row.name ?? ""))
    setRowDimension(String(row.rowDimension ?? row.row_dimension ?? "accountCode"))
    setColumnDimension(String(row.columnDimension ?? row.column_dimension ?? ""))
    setMeasureField(String(row.measureField ?? row.measure_field ?? "closingDebit"))
    setMeasureOp(String(row.measureOp ?? row.measure_op ?? "sum"))
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-lg font-semibold">{t("reports.pivot.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("reports.pivot.description")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label>{t("reports.pivot.sourceReport")}</Label>
          <Select value={reportId} onValueChange={setReportId}>
            <SelectTrigger>
              <SelectValue placeholder={t("reports.pivot.sourceReportPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {generatedReports.map((r) => (
                <SelectItem key={String(r.id)} value={String(r.id)}>
                  {String(r.name ?? r.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.savedDefinition")}</Label>
          <Select
            value={savedReportId || undefined}
            onValueChange={(v: string) => {
              setSavedReportId(v)
              loadSaved(v)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("reports.pivot.savedDefinitionPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {savedReports.map((r) => (
                <SelectItem key={String(r.id)} value={String(r.id)}>
                  {String(r.name ?? r.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.rowDimension")}</Label>
          <Select value={rowDimension} onValueChange={setRowDimension}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["accountCode", "accountName", "accountType"].map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.columnDimension")}</Label>
          <Select value={columnDimension || "__none__"} onValueChange={(v: string) => setColumnDimension(v === "__none__" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("reports.pivot.none")}</SelectItem>
              {["accountType", "accountCode"].map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.measureField")}</Label>
          <Select value={measureField} onValueChange={setMeasureField}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["closingDebit", "closingCredit", "periodDebit", "periodCredit"].map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!name.trim() || createSavedReport.isPending}
          onClick={() =>
            void createSavedReport.mutateAsync({
              name,
              model: "trial_balance",
              rowDimension,
              columnDimension: columnDimension || null,
              measureField,
              measureOp,
              isActive: true,
            })
          }
        >
          <Save className="mr-2 h-4 w-4" />
          {t("reports.pivot.saveDefinition")}
        </Button>
        {activeSaved?.id != null ? (
          <>
            <Button
              variant="outline"
              disabled={updateSavedReport.isPending}
              onClick={() =>
                void updateSavedReport.mutateAsync({
                  savedReportId: activeSaved.id as string | number | bigint,
                  formData: {
                    name,
                    rowDimension,
                    columnDimension: columnDimension || null,
                    measureField,
                    measureOp,
                    isActive: true,
                  },
                })
              }
            >
              {t("reports.pivot.updateDefinition")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteSavedReport.isPending}
              onClick={() => void deleteSavedReport.mutateAsync(activeSaved.id as string | number | bigint)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("reports.pivot.deleteDefinition")}
            </Button>
          </>
        ) : null}
        <Button
          disabled={!reportId || pivot.exportRows.length === 0}
          onClick={() =>
            void downloadPivotTableXlsx(
              name || "pivot",
              pivot.exportHeaders,
              pivot.exportRows,
            ).catch(() => undefined)
          }
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          {t("reports.pivot.exportXlsx")}
        </Button>
      </div>

      <EntityTable config={tableConfig} data={pivot.tableRows} />
    </div>
  )
}
