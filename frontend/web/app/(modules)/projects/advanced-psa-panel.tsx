"use client"
import { useTranslation } from "@lumiere/i18n"


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
  const { t } = useTranslation()
  return (
    <div className="space-y-2" data-testid={testId}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("projects.advancedPsaPanel.noRowsYet")}</p>
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
  const { t } = useTranslation()
  return (
    <div className="space-y-8 p-1" data-testid="advanced-psa-panel">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onNewChangeOrder}>
          {t("projects.advancedPsaPanel.newChangeOrder")}{" "}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onLinkSubcontractor}>
          {t("projects.advancedPsaPanel.linkSubcontractorCost")}{" "}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onNewIntent}>
          {t("purchasing.ops.createIntegrationIntent")}{" "}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRefreshForecast}>
          {t("projects.advancedPsaPanel.refreshForecast")}{" "}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRefreshEvm}>
          {t("projects.advancedPsaPanel.refreshEVM")}{" "}</Button>
      </div>

      <MetricTable
        title={t("projects.advancedPsaPanel.capacityForecast")}
        testId="psa-forecast-table"
        columns={[
          { key: "employeeId", label: t("projects.resourceAllocation.columns.employee") },
          { key: "availableHours", label: t("inventory.stockOnHand.columns.availableQuantity") },
          { key: "allocatedHours", label: t("hr.leaveAllocations.columns.allocated") },
          { key: "pipelineHours", label: t("crm.builtIn.moduleDashboardConfigs.crmDashboard.crmPipeline.title") },
          { key: "forecastRemainingHours", label: t("accounting.amortization.colRemaining") },
        ]}
        rows={forecast}
      />

      <MetricTable
        title={t("projects.advancedPsaPanel.changeOrders")}
        testId="psa-change-orders-table"
        columns={[
          { key: "name", label: t("demo.tables.customers.columns.name") },
          { key: "projectId", label: t("projects.projects.columns.name") },
          { key: "state", label: t("moduleInsights.state") },
          { key: "budgetDelta", label: t("projects.advancedPsaPanel.budget") },
          { key: "revisedBudget", label: t("projects.advancedPsaPanel.revisedBudget") },
        ]}
        rows={changeOrders}
      />

      <MetricTable
        title={t("projects.advancedPsaPanel.earnedValuePVEVACSPICPI")}
        testId="psa-evm-table"
        columns={[
          { key: "projectId", label: t("projects.projects.columns.name") },
          { key: "plannedValue", label: t("projects.advancedPsaPanel.pV") },
          { key: "earnedValue", label: t("projects.advancedPsaPanel.eV") },
          { key: "actualCost", label: t("projects.advancedPsaPanel.aC") },
          { key: "schedulePerformanceIndex", label: t("projects.advancedPsaPanel.sPI") },
          { key: "costPerformanceIndex", label: t("projects.advancedPsaPanel.cPI") },
          { key: "percentComplete", label: t("projects.advancedPsaPanel.complete") },
        ]}
        rows={earnedValue}
      />

      <MetricTable
        title={t("projects.advancedPsaPanel.integrationIntents")}
        testId="psa-intents-table"
        columns={[
          { key: "intentType", label: t("accounting.accounts.type") },
          { key: "status", label: t("projects.projects.columns.lastUpdateStatus") },
          { key: "projectId", label: t("projects.projects.columns.name") },
          { key: "idempotencyKey", label: t("workflows.workflows.columns.key") },
          { key: "resultRef", label: t("inventory.qualityChecks.columns.qualityState") },
        ]}
        rows={intents}
      />
    </div>
  )
}
