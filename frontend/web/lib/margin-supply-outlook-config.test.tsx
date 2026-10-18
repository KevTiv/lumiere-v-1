import assert from "node:assert/strict"
import test from "node:test"

import type { ReportPreview } from "@lumiere/erp-shared/report-schemas"

import {
  createMarginSupplyDashboard,
  DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT,
  marginSupplyScenarioFromDraft,
  MARGIN_SUPPLY_SCENARIO_FIELDS,
} from "./margin-supply-outlook-config"

test("scenario fields and dashboard widgets are config driven", () => {
  assert.deepEqual(
    MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => field.key),
    [
      "inputCostChangePct",
      "demandChangePct",
      "leadTimeChangeDays",
      "targetMarginPct",
    ],
  )
  assert.deepEqual(
    marginSupplyScenarioFromDraft(DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT),
    {
      inputCostChangePct: 10,
      demandChangePct: 0,
      leadTimeChangeDays: 7,
      targetMarginPct: 25,
    },
  )

  const money = { minorUnits: 10_000, scale: 2 }
  const preview = {
    reportKey: "margin_supply_outlook_v1",
    schemaVersion: 1,
    scope: {
      organizationId: 1,
      companyId: 2,
      localDate: "2026-10-18",
      dateFrom: "2026-10-01",
      dateToExclusive: "2026-11-01",
      timezone: "UTC",
      windowStartUtc: "2026-10-01T00:00:00Z",
      windowEndUtc: "2026-11-01T00:00:00Z",
      cutoffLabel: "October 2026",
    },
    generatedAt: "2026-10-18T00:00:00Z",
    generatedBy: "test",
    currency: { currencyId: 1, minorUnitScale: 2 },
    sourceWatermark: {
      accountingCutoff: "2026-11-01T00:00:00Z",
      windowStartUtc: "2026-10-01T00:00:00Z",
      windowEndUtc: "2026-11-01T00:00:00Z",
      cutoffLabel: "October 2026",
      queriedAt: "2026-10-18T00:00:00Z",
      sourceRows: [],
    },
    caveats: [],
    watermark: "SCENARIO — DECISION SUPPORT ONLY",
    report: {
      scenario: marginSupplyScenarioFromDraft(DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT),
      productCount: 0,
      warningCount: 0,
      criticalCount: 0,
      baselineRevenue: money,
      baselineCost: money,
      baselineGrossProfit: money,
      baselineMarginPct: 25,
      stressedRevenue: money,
      stressedCost: money,
      stressedGrossProfit: money,
      stressedMarginPct: 20,
      profitAtRisk: money,
      projectedStockShortfall: 0,
      recommendations: [],
      lines: [],
    },
  } as Extract<ReportPreview, { reportKey: "margin_supply_outlook_v1" }>

  const dashboard = createMarginSupplyDashboard(preview)
  assert.deepEqual(
    dashboard.sections.map((section) => section.id),
    ["financial-impact", "assumptions", "product-warnings", "management-follow-up"],
  )
  assert.equal(dashboard.sections[2]?.widgets[0]?.type, "table")
})
