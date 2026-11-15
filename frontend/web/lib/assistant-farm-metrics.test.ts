import assert from "node:assert/strict"
import test from "node:test"
import { farmMetricsReply, parseFarmComparisonRequest } from "./assistant-farm-metrics"

test("farm comparison accepts two exact distinct batch IDs", () => {
  assert.deepEqual(parseFarmComparisonRequest("Compare flocks #42 and #9007199254740993"), ["42", "9007199254740993"])
  assert.equal(parseFarmComparisonRequest("Compare flocks 42 and 42"), undefined)
  assert.equal(parseFarmComparisonRequest("Compare flocks 42 and 43 then 44"), undefined)
})

test("farm metric summaries use verified identity and preserve missing inputs", () => {
  const available = (value: number) => ({ status: "available", value })
  const unavailable = { status: "unavailable", reason: "missingInput" }
  const payload = { data: { id: "42", metrics: {
    asOf: "2026-11-15",
    recordedDeaths: 4,
    liveHeadcount: available(16),
    mortalityRate: available(0.04),
    averageDailyGainKg: unavailable,
    feedConversionRatio: unavailable,
    processingYield: available(0.75),
    costPerSellableKg: unavailable,
    margin: { status: "available", value: { amountMinor: "9007199254740993", currency: "RWF", minorUnitDigits: 0 } },
  } } }
  const reply = farmMetricsReply(payload, "42", "en")
  assert.match(reply ?? "", /Live headcount — 16/)
  assert.match(reply ?? "", /Processing yield — 75%/)
  assert.match(reply ?? "", /Feed conversion ratio — Insufficient records/)
  assert.match(reply ?? "", /9007199254740993 RWF/)
  assert.equal(farmMetricsReply(payload, "43", "en"), undefined)
})
