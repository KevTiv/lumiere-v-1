"use client"

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
  const [rows, setRows] = useState<ImportedMarginSupplyScenario[]>([])
  const [reviewedRows, setReviewedRows] = useState<Set<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file?: File) => {
    setRows([])
    setReviewedRows(new Set())
    setError(null)
    if (!file) return
    if (file.size > MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes) {
      setError(`CSV exceeds the ${MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes.toLocaleString()} byte alpha limit.`)
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
        <p className="text-sm font-medium">Controlled scenario CSV</p>
        <p className="text-sm text-muted-foreground">
          Import up to {MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxRows} rows ({MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxBytes.toLocaleString()} bytes). Required headers: {MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(", ")}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-label="Margin and supply scenario CSV"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>Download template</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {rows.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Review every assumption before filling the scenario form</p>
          {rows.map((row) => {
            const isReviewed = reviewedRows.has(row.provenance.rowNumber)
            return (
              <div key={row.provenance.rowNumber} className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.provenance.fileName} · imported {new Date(row.provenance.importedAt).toLocaleString()} · CSV row {row.provenance.rowNumber}
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
                    I reviewed this row and its source
                  </label>
                  <Button type="button" size="sm" disabled={!isReviewed} onClick={() => onApply(row)}>
                    Fill scenario fields
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
