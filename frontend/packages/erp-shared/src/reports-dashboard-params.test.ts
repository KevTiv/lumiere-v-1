import assert from "node:assert/strict"
import test from "node:test"

import { toCreateDashboardWidgetParams } from "./reports-dashboard-params"

test("preserves the versioned dashboard time and measure binding", () => {
  const configuration = JSON.stringify({
    version: 1,
    timeField: "date_order",
    measureField: "amount_total",
    missingTimestampPolicy: "reject",
    missingMeasurePolicy: "reject",
  })

  const params = toCreateDashboardWidgetParams({
    name: "Revenue",
    dataSource: "sale_order",
    widgetType: "kpi",
    fields: ["amount_total"],
    aggregation: "sum",
    configuration,
  })

  assert.equal(params.configuration, configuration)
})
