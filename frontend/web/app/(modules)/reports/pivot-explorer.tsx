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
import type { EntityRow, EntityTableConfig } from "@lumiere/ui"
import { moduleCollection, type ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { buildPivotTable, pivotMeasureOp } from "./pivot-table-model"
import { FileSpreadsheet, Save, Trash2 } from "lucide-react"

type PivotExplorerProps = {
  organizationId: bigint
  companyId?: bigint
  financialReports: EntityRow[]
  trialBalances: EntityRow[]
  reportsState: ModuleDataState
  balancesState: ModuleDataState
}

export function PivotExplorer({
  organizationId,
  companyId,
  financialReports,
  trialBalances,
  reportsState,
  balancesState,
}: PivotExplorerProps) {
  const { t } = useTranslation()
  const companyAvailable = companyId != null && companyId > 0n
  const saved = moduleCollection(useSavedReports(organizationId, undefined, { companyId, enabled: companyAvailable }))
  const savedReports = saved.state.status === "ready" ? saved.rows : []
  const createSavedReport = useCreateSavedReport(organizationId, companyId)
  const updateSavedReport = useUpdateSavedReport(organizationId, companyId)
  const deleteSavedReport = useDeleteSavedReport(organizationId, companyId)

  const scopedSavedReports = useMemo(
    () =>
      savedReports.filter((report) => {
        if (companyId == null || companyId <= 0n) return true
        const reportCompanyId = report.companyId ?? report.company_id
        // The BFF scopes saved reports to the selected company. Some restricted
        // projections omit company_id, so absence here means server-scoped rather
        // than organization-wide.
        return reportCompanyId == null || String(reportCompanyId) === companyId.toString()
      }),
    [savedReports, companyId],
  )

  const generatedReports = useMemo(
    () =>
      reportsState.status === "ready" ? financialReports.filter(
        (r) =>
          (String(r.state ?? "").toLowerCase() === "generated" ||
            String(r.state ?? "").toLowerCase() === "exported") &&
          (companyId == null ||
            companyId <= 0n ||
            String(r.companyId ?? r.company_id ?? "") === companyId.toString()),
      ) : [],
    [financialReports, companyId, reportsState.status],
  )

  const [reportId, setReportId] = useState<string>("")
  const [savedReportId, setSavedReportId] = useState<string>("")
  const [name, setName] = useState("Trial balance pivot")
  const [rowDimension, setRowDimension] = useState("accountCode")
  const [columnDimension, setColumnDimension] = useState("")
  const [measureField, setMeasureField] = useState("closingDebit")
  const [measureOp, setMeasureOp] = useState(() => pivotMeasureOp("sum"))
  const [exportError, setExportError] = useState(false)

  const activeSaved = useMemo(
    () => scopedSavedReports.find((r) => String(r.id) === savedReportId),
    [scopedSavedReports, savedReportId],
  )

  const selectedReport = generatedReports.some((report) => String(report.id) === reportId)
  const sourceRows = useMemo(() => {
    if (!selectedReport || balancesState.status !== "ready") return []
    return trialBalances.filter((row) => String(row.reportId ?? row.report_id) === reportId)
  }, [selectedReport, balancesState.status, reportId, trialBalances])

  const pivot = useMemo(
    () => buildPivotTable(sourceRows, { rowDimension, columnDimension, measureField, measureOp }),
    [sourceRows, rowDimension, columnDimension, measureField, measureOp],
  )

  const tableConfig = useMemo((): EntityTableConfig => {
    const columns = pivot.columns.map(({ key, label }, index) => ({
      key,
      label,
      type: index === 0 ? ("text" as const) : ("number" as const),
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
      emptyMessage: t("common.noData"),
    }
  }, [pivot.columns, pivot.tableRows.length, t])

  const loadSaved = (id: string) => {
    const row = scopedSavedReports.find((r) => String(r.id) === id)
    if (!row) return
    setSavedReportId(id)
    setName(String(row.name ?? ""))
    setRowDimension(String(row.rowDimension ?? row.row_dimension ?? "accountCode"))
    setColumnDimension(String(row.columnDimension ?? row.column_dimension ?? ""))
    setMeasureField(String(row.measureField ?? row.measure_field ?? "closingDebit"))
    setMeasureOp(pivotMeasureOp(row.measureOp ?? row.measure_op))
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
          <Select value={selectedReport ? reportId : ""} onValueChange={setReportId} disabled={reportsState.status !== "ready"}>
            <SelectTrigger aria-label={t("reports.pivot.sourceReport")}>
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
          {reportsState.status === "loading" ? <p role="status">{t("common.loading")}</p> : <ModuleDataNotice state={reportsState} />}
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.savedDefinition")}</Label>
          <Select
            value={activeSaved ? savedReportId : ""}
            disabled={!companyAvailable || saved.state.status !== "ready"}
            onValueChange={(v: string) => {
              setSavedReportId(v)
              loadSaved(v)
            }}
          >
            <SelectTrigger data-testid="pivot-saved-select">
              <SelectValue placeholder={t("reports.pivot.savedDefinitionPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {scopedSavedReports.map((r) => (
                <SelectItem key={String(r.id)} value={String(r.id)}>
                  {String(r.name ?? r.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {saved.state.status === "loading" ? <p role="status">{t("common.loading")}</p> : <ModuleDataNotice state={saved.state} />}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pivot-report-name">{t("reports.pivot.name")}</Label>
          <Input
            id="pivot-report-name"
            data-testid="pivot-report-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("reports.pivot.rowDimension")}</Label>
          <Select
            value={rowDimension}
            onValueChange={(value) => {
              setRowDimension(value)
              if (columnDimension === value) setColumnDimension("")
            }}
          >
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
            <SelectTrigger aria-label={t("reports.pivot.columnDimension")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("reports.pivot.none")}</SelectItem>
              {["accountType", "accountCode"].filter((opt) => opt !== rowDimension).map((opt) => (
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
          disabled={!companyAvailable || !name.trim() || createSavedReport.isPending || saved.state.status !== "ready"}
          data-testid="pivot-save-report"
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
              data-testid="pivot-delete-definition"
              onClick={() => void deleteSavedReport.mutateAsync(activeSaved.id as string | number | bigint)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("reports.pivot.deleteDefinition")}
            </Button>
          </>
        ) : null}
        <Button
          disabled={!selectedReport || balancesState.status !== "ready" || pivot.exportRows.length === 0}
          onClick={() => {
            setExportError(false)
            void downloadPivotTableXlsx(
              name || "pivot",
              pivot.exportHeaders,
              pivot.exportRows,
              `report-${reportId}-definition-${savedReportId || "unsaved"}.xlsx`,
            ).catch(() => setExportError(true))
          }}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          {t("reports.pivot.exportXlsx")}
        </Button>
      </div>

      {exportError ? <p role="alert">{t("reports.pivot.exportFailed", { defaultValue: "Could not export the pivot table. Try again." })}</p> : null}

      {selectedReport ? (
        <p className="text-xs text-muted-foreground" data-testid="pivot-provenance">
          {`Source report #${reportId} · definition ${savedReportId ? `#${savedReportId}` : "unsaved"} · company ${companyId?.toString() ?? "all permitted"}`}
        </p>
      ) : null}

      {reportsState.status === "ready" && !selectedReport ? (
        <p className="text-sm text-muted-foreground">
          {generatedReports.length ? t("reports.pivot.empty") : t("reports.pivot.noSourceReports")}
        </p>
      ) : null}
      {selectedReport && (balancesState.status === "ready"
        ? <EntityTable config={tableConfig} data={pivot.tableRows} />
        : balancesState.status === "loading"
          ? <p role="status">{t("common.loading")}</p>
          : <ModuleDataNotice state={balancesState} />)}
    </div>
  )
}
