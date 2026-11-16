import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { inventoryMovementHistory } from "./inventory-history"
import { previousHistoryPeriod, resolveHistoryPeriod } from "@lumiere/erp-shared/history-period"

const stamp = (date: string) => Date.parse(date) * 1000
test("range wiring leaves stock and pending-transfer snapshots current", () => {
  const source = readFileSync(new URL("./inventory-client.tsx", import.meta.url), "utf8")
  assert.match(source, /useHistoryPeriod\("all"\)/)
  assert.match(source, /inventoryMovementHistory\(transfers, dashboardTimeRange\)/)
  assert.match(source, /const stockValue = stockQuants\.reduce/)
  assert.match(source, /const pendingTransfers = transfers\.filter/)
})
test("all retains old transfers, ignores undated rows and has no previous period", () => {
  const values = inventoryMovementHistory([
    { scheduledDate: stamp("2012-01-01"), pickingCode: "incoming" },
    { scheduledDate: stamp("2025-01-01"), pickingCode: "outgoing" },
    {},
  ], "all")
  assert.equal(values.reduce((n, v) => n + v.In + v.Out, 0), 2)
  assert.ok(values.length <= 36)
  assert.equal(previousHistoryPeriod(resolveHistoryPeriod("all")), null)
})
test("custom uses inclusive through date and exclusive next midnight", () => {
  const values = inventoryMovementHistory([
    { scheduledDate: stamp("2012-01-01T00:00:00Z"), pickingCode: "outgoing" },
    { scheduledDate: stamp("2012-01-02T23:59:59Z"), pickingCode: "outgoing" },
    { scheduledDate: stamp("2012-01-03T00:00:00Z"), pickingCode: "outgoing" },
  ], { kind: "custom", from: "2012-01-01", through: "2012-01-02" })
  assert.equal(values.reduce((n, v) => n + v.Out, 0), 2)
})
test("decoded timestamp objects and preepoch numeric micros retain exact picking directions", () => {
  const values = inventoryMovementHistory([
    { scheduledDate: { microsSinceUnixEpoch: BigInt(stamp("1960-01-01")) }, pickingCode: "incoming" },
    { scheduledDate: stamp("1960-01-01"), pickingCode: "outgoing" },
    { scheduledDate: stamp("1960-01-01"), pickingCode: "internal" },
    { scheduledDate: stamp("1960-01-01"), pickingCode: "unknown" },
    { scheduledDate: stamp("1960-01-01") },
  ], "all")
  assert.deepEqual(values.map(v => [v.In, v.Out]), [[1, 1]])
})
test("final microsecond of a day does not create a following-day bucket", () => {
  const micros = BigInt(stamp("2025-01-02")) - 1n
  const values = inventoryMovementHistory([
    { scheduledDate: { microsSinceUnixEpoch: micros }, pickingCode: "outgoing" },
  ], "all")
  assert.equal(values.length, 1)
  assert.equal(values[0].Out, 1)
  assert.match(values[0].day, /Jan 1/)
})

test("negative fractional microseconds stay on the preepoch date", () => {
  const row = { scheduledDate: { microsSinceUnixEpoch: -1n }, pickingCode: "incoming" }
  assert.equal(inventoryMovementHistory([row], { kind: "custom", from: "1969-12-31", through: "1969-12-31" })[0]!.In, 1)
  assert.equal(inventoryMovementHistory([row], { kind: "custom", from: "1970-01-01", through: "1970-01-01" })[0]!.In, 0)
})
