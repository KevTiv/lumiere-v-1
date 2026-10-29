import assert from "node:assert/strict"
import test from "node:test"
import { projectMarginChartData } from "./project-margin-chart"

test("language changes keep project chart keys and values stable while labels change", () => {
  const margins = [{ projectId: 9007199254740999n, budgetPlanned: 150, budgetActual: 125, marginPercent: 20 }]
  const projects = [{ id: 9007199254740999n, name: "Project North" }]
  const en = projectMarginChartData(margins, projects, key => key.endsWith("budgetSeries") ? "Budget" : "Spent")
  const fr = projectMarginChartData(margins, projects, key => key.endsWith("budgetSeries") ? "Budget prévu" : "Dépenses")
  assert.deepEqual(en.series.map(series => series.name), ["Budget", "Spent"])
  assert.deepEqual(fr.series.map(series => series.name), ["Budget", "Spent"])
  assert.deepEqual(fr.values, en.values)
  assert.deepEqual(fr.series.map(series => series.label), ["Budget prévu", "Dépenses"])
  assert.equal(fr.values[0]?.Budget, 150)
  assert.equal(fr.values[0]?.Spent, 125)
  assert.match(fr.values[0]?.href ?? "", /9007199254740999/)
})
