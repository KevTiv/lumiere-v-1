"use client"

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import { useState } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"

import {
  MARGIN_SUPPLY_SCENARIO_CSV_HEADERS,
  MARGIN_SUPPLY_SCENARIO_CSV_LIMITS,
  marginSupplyScenarioCsvTemplate,
  parseMarginSupplyScenarioCsv,
  type ImportedMarginSupplyScenario,
} from "./margin-supply-scenario-csv"
import { MARGIN_SUPPLY_SCENARIO_FIELDS } from "./margin-supply-outlook-config"

interface MarginSupplyScenarioImportProps {
  onApply: (scenario: ImportedMarginSupplyScenario) => void
}

function downloadTemplate() {
  const blob = new Blob([marginSupplyScenarioCsvTemplate()], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "margin-supply-scenarios-template.csv"
  anchor.click()
  URL.revokeObjectURL(url)
}

export function MarginSupplyScenarioImport({ onApply }: MarginSupplyScenarioImportProps) {
  useRootTranslation()
  const [rows, setRows] = useState<ImportedMarginSupplyScenario[]>([])
  const [reviewedRows, setReviewedRows] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file?: File) => {
    setRows([])
    setReviewedRows(new Set())
    setError(null)
    if (!file) return
    if (file.size > MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes) {
      setError(rootI18n.t("reports.scenarioImport.sizeLimit", { bytes: MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes.toLocaleString() }))
      return
    }
    try {
      setRows(parseMarginSupplyScenarioCsv(await file.text(), file.name))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="mt-6 space-y-4 border-t pt-5" data-testid="margin-supply-scenario-import">
      <div>
        <p className="text-sm font-medium">{rootI18n.t("reports.ui.marginSupplyScenarioImport.controlledScenarioCSV")}</p>
        <p className="text-sm text-muted-foreground">
          {rootI18n.t("reports.scenarioImport.requirements", { rows: MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxRows, bytes: MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes.toLocaleString(), headers: MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(", ") })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-label={rootI18n.t("reports.ui.marginSupplyScenarioImport.marginAndSupplyScenarioCSV")}
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>{rootI18n.t("reports.ui.marginSupplyScenarioImport.downloadTemplate")}</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {rows.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{rootI18n.t("reports.ui.marginSupplyScenarioImport.reviewEveryAssumptionBeforeFillingTheScenarioForm")}</p>
          {rows.map((row) => {
            const isReviewed = reviewedRows.has(row.provenance.rowNumber)
            return (
              <div key={row.provenance.rowNumber} className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {rootI18n.t("reports.scenarioImport.provenance", { fileName: row.provenance.fileName, date: new Date(row.provenance.importedAt).toLocaleString(), row: row.provenance.rowNumber })}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                  {MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => (
                    <div key={field.key}>
                      <dt className="text-muted-foreground">{field.label}</dt>
                      <dd>{row.draft[field.key]}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isReviewed}
                      onChange={(event) => setReviewedRows((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(row.provenance.rowNumber)
                        else next.delete(row.provenance.rowNumber)
                        return next
                      })}
                    />
                    {rootI18n.t("reports.ui.marginSupplyScenarioImport.iReviewedThisRowAndItsSource")}</label>
                  <Button type="button" size="sm" disabled={!isReviewed} onClick={() => onApply(row)}>
                    {rootI18n.t("reports.ui.marginSupplyScenarioImport.fillScenarioFields")}</Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
