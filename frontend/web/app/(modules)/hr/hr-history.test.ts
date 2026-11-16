import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { headcountHistory, hrDateMs, leaveInHistory } from "./hr-history"

const stamp = (date: string) => Date.parse(date) * 1000
const period = { kind: "custom", from: "2012-01-01", through: "2012-01-03" } as const
test("range wiring preserves current headcount and approval/export queues", () => {
  const source = readFileSync(new URL("./hr-client.tsx", import.meta.url), "utf8")
  assert.match(source, /useHistoryPeriod\("all"\)/)
  assert.match(source, /headcountHistory\(employees, dashboardTimeRange\)/)
  assert.match(source, /const activeEmployees = employees\.filter\(\(e\) => e\.isActive\)/)
  assert.match(source, /const pendingLeaves = leavesToApprove\.length/)
  assert.match(source, /const payslipExportQueue = payslipsToExport\.length/)
})
test("known hire and termination intervals reconstruct old headcount without invented hires", () => {
  const rows = [
    { dateHired: stamp("2011-01-01"), isActive: true },
    { dateHired: stamp("2011-01-01"), dateTerminated: stamp("2012-01-02"), isActive: false },
    { isActive: true },
    { dateHired: stamp("2011-01-01"), isActive: false },
  ]
  assert.deepEqual(headcountHistory(rows, period).map(v => v.Headcount), [2, 1, 1])
  const all = headcountHistory(rows, "all", Date.parse("2025-01-01"))
  assert.ok(all[0].month.includes("2011"))
  assert.ok(all.length <= 36)
  assert.equal(rows.filter(e => e.isActive).length, 2)
  assert.deepEqual(headcountHistory([], "all"), [])
})
test("leave date range follows request start and includes through date", () => {
  assert.equal(leaveInHistory({ dateFrom: stamp("2012-01-03T23:59:59Z") }, period), true)
  assert.equal(leaveInHistory({ dateFrom: stamp("2012-01-04") }, period), false)
  assert.equal(leaveInHistory({}, "all"), false)
})
test("decoded timestamps support preepoch employment and leave dates", () => {
  const micros = BigInt(stamp("1960-01-01"))
  assert.equal(hrDateMs({ microsSinceUnixEpoch: micros }), Date.parse("1960-01-01"))
  assert.equal(hrDateMs(micros), Date.parse("1960-01-01"))
  assert.equal(hrDateMs({ unrelated: 123 }), null)
  assert.equal(leaveInHistory({ dateFrom: { microsSinceUnixEpoch: micros } }, "all"), true)
  assert.equal(headcountHistory([
    { dateHired: { microsSinceUnixEpoch: micros }, isActive: true },
  ], { kind: "custom", from: "1960-01-01", through: "1960-01-01" })[0].Headcount, 1)
})
test("future hires do not extend all history and future-only ranges have no snapshots", () => {
  const now = Date.parse("2025-01-01T12:00:00Z")
  const rows = [
    { dateHired: stamp("2024-01-01"), isActive: true },
    { dateHired: stamp("2030-01-01"), isActive: true },
  ]
  assert.deepEqual(headcountHistory(rows, "all", now), headcountHistory(rows.slice(0, 1), "all", now))
  assert.deepEqual(headcountHistory(rows.slice(1), "all", now), [])
  assert.deepEqual(headcountHistory(rows, { kind: "custom", from: "2030-01-01", through: "2031-01-01" }, now), [])
  for (const range of ["today", "all", { kind: "custom", from: "2025-01-01", through: "2031-01-01" }] as const) {
    const values = headcountHistory(rows, range, now)
    assert.ok(values.length > 0)
    assert.equal(values.at(-1)?.Headcount, 1)
    assert.ok(values.every(v => !v.month.includes("2030")))
  }
})
