import assert from "node:assert/strict"
import test from "node:test"
import { i18n } from "@lumiere/i18n"

import type { ReportPreview } from "@lumiere/erp-shared/report-schemas"

import {
  createMarginSupplyDashboard,
  DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT,
  marginSupplyScenarioFromDraft,
  marginSupplyXlsxData,
  MARGIN_SUPPLY_SCENARIO_FIELDS,
} from "./margin-supply-outlook-config"

test("scenario fields and dashboard widgets are config driven", async () => {
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
      provenance: { source: "manual" },
    },
  )
  assert.throws(
    () => marginSupplyScenarioFromDraft({
      ...DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT,
      targetMarginPct: "",
    }),
    /Target gross margin.*required/,
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
      suggestions: [],
      lines: [],
    },
  } as Extract<ReportPreview, { reportKey: "margin_supply_outlook_v1" }>

  const dashboard = createMarginSupplyDashboard(preview)
  assert.deepEqual(
    dashboard.sections.map((section) => section.id),
    ["financial-impact", "assumptions", "product-warnings", "governed-suggestions", "management-follow-up"],
  )
  assert.equal(dashboard.sections[2]?.widgets[0]?.type, "table")
  assert.equal(dashboard.sections[3]?.widgets[0]?.type, "custom")
  const xlsx = marginSupplyXlsxData(preview)
  assert.ok(xlsx.headers.includes("Scenario source"))
  assert.ok(xlsx.headers.includes("Calculation evidence and caveats"))

  const originalLanguage = i18n.language
  const originalFrench = structuredClone(i18n.getResourceBundle("fr", "translation"))
  const payloadBefore = JSON.stringify(preview)
  const csvHeadersBefore = MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => field.csvHeader)
  try {
    i18n.addResourceBundle("fr", "translation", { reports: { marginSupply: {
      description: "Aide à la décision du {{from}} au {{to}}",
      days_one: "{{count}} jour",
      days_other: "{{count}} jours",
      source: { manual: "Saisie manuelle" },
      export: { product: "Produit" },
      validation: { required: "Champ requis : {{field}}" },
    } } }, true, true)
    await i18n.changeLanguage("fr")
    assert.equal(dashboard.description, "Aide à la décision du 2026-10-01 au 2026-11-01")
    const assumptionWidget = dashboard.sections[1]?.widgets[0]
    const assumptionData = assumptionWidget?.data as { stats: { value: unknown }[] }
    assert.equal(assumptionData.stats[2]?.value, "7 jours")
    assert.equal(assumptionData.stats[4]?.value, "Saisie manuelle")
    assert.equal(marginSupplyXlsxData(preview).headers[0], "Produit")
    assert.throws(() => marginSupplyScenarioFromDraft({
      ...DEFAULT_MARGIN_SUPPLY_SCENARIO_DRAFT, targetMarginPct: "",
    }), /Champ requis/)
    assert.deepEqual(MARGIN_SUPPLY_SCENARIO_FIELDS.map((field) => field.csvHeader), csvHeadersBefore)
    assert.equal(JSON.stringify(preview), payloadBefore)
  } finally {
    await i18n.changeLanguage(originalLanguage)
    i18n.removeResourceBundle("fr", "translation")
    i18n.addResourceBundle("fr", "translation", originalFrench)
  }
})
