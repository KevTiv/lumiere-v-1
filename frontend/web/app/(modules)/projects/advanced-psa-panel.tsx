"use client"

import { Button } from "@lumiere/ui"

type Row = Record<string, unknown>

function MetricTable({
  title,
  testId,
  columns,
  rows,
}: {
  title: string
  testId: string
  columns: { key: string; label: string }[]
  rows: Row[]
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rows yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2">
                      {String(row[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Wave E surfaces: forecast, change orders, EVM, integration intents. */
export function AdvancedPsaPanel({
  forecast,
  changeOrders,
  earnedValue,
  intents,
  onNewChangeOrder,
  onLinkSubcontractor,
  onNewIntent,
  onRefreshForecast,
  onRefreshEvm,
}: {
  forecast: Row[]
  changeOrders: Row[]
  earnedValue: Row[]
  intents: Row[]
  onNewChangeOrder: () => void
  onLinkSubcontractor: () => void
  onNewIntent: () => void
  onRefreshForecast: () => void
  onRefreshEvm: () => void
}) {
  return (
    <div className="space-y-8 p-1" data-testid="advanced-psa-panel">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onNewChangeOrder}>
          New change order
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onLinkSubcontractor}>
          Link subcontractor cost
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onNewIntent}>
          New integration intent
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRefreshForecast}>
          Refresh forecast
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRefreshEvm}>
          Refresh EVM
        </Button>
      </div>

      <MetricTable
        title="Capacity forecast"
        testId="psa-forecast-table"
        columns={[
          { key: "employeeId", label: "Employee" },
          { key: "availableHours", label: "Available" },
          { key: "allocatedHours", label: "Allocated" },
          { key: "pipelineHours", label: "Pipeline" },
          { key: "forecastRemainingHours", label: "Remaining" },
        ]}
        rows={forecast}
      />

      <MetricTable
        title="Change orders"
        testId="psa-change-orders-table"
        columns={[
          { key: "name", label: "Name" },
          { key: "projectId", label: "Project" },
          { key: "state", label: "State" },
          { key: "budgetDelta", label: "Budget Δ" },
          { key: "revisedBudget", label: "Revised budget" },
        ]}
        rows={changeOrders}
      />

      <MetricTable
        title="Earned value (PV / EV / AC / SPI / CPI)"
        testId="psa-evm-table"
        columns={[
          { key: "projectId", label: "Project" },
          { key: "plannedValue", label: "PV" },
          { key: "earnedValue", label: "EV" },
          { key: "actualCost", label: "AC" },
          { key: "schedulePerformanceIndex", label: "SPI" },
          { key: "costPerformanceIndex", label: "CPI" },
          { key: "percentComplete", label: "% complete" },
        ]}
        rows={earnedValue}
      />

      <MetricTable
        title="Integration intents"
        testId="psa-intents-table"
        columns={[
          { key: "intentType", label: "Type" },
          { key: "status", label: "Status" },
          { key: "projectId", label: "Project" },
          { key: "idempotencyKey", label: "Key" },
          { key: "resultRef", label: "Result" },
        ]}
        rows={intents}
      />
    </div>
  )
}
