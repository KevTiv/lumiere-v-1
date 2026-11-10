import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  hasUnconfirmedTimesheetCapture,
  listTimesheetCaptures,
  writeTimesheetCapture,
  type TimesheetCaptureOutboxItem,
} from "./timesheet-capture-outbox"
import {
  enqueueWarehouseOutboxItem,
  listQueuedWarehouseOutbox,
  markWarehouseOutboxSynced,
} from "./warehouse-sync-outbox"

import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from "./local-outbox"

function withLocalStorage(run: (values: Map<string, string>) => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window")
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  })

  try {
    run(values)
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous)
    else Reflect.deleteProperty(globalThis, "window")
  }
}

describe("local outbox storage", () => {
  it("is SSR-safe", () => {
    assert.equal(getOrCreateLocalStorageDeviceId("device"), "server")
    assert.deepEqual(readLocalStorageArray("outbox"), [])
  })

  it("keeps device IDs stable and writes raw arrays", () => {
    withLocalStorage((values) => {
      const deviceId = getOrCreateLocalStorageDeviceId("device")
      assert.equal(getOrCreateLocalStorageDeviceId("device"), deviceId)

      writeLocalStorageArray("outbox", [{ id: "first" }])
      assert.equal(values.get("outbox"), '[{"id":"first"}]')
      assert.deepEqual(readLocalStorageArray<{ id: string }>("outbox"), [
        { id: "first" },
      ])
    })
  })

  it("returns an empty array for malformed or non-array stored data", () => {
    withLocalStorage((values) => {
      values.set("bad-json", "{")
      values.set("object", '{"id":"not-an-array"}')
      assert.deepEqual(readLocalStorageArray("bad-json"), [])
      assert.deepEqual(readLocalStorageArray("object"), [])
    })
  })
})

describe("capture recovery ownership", () => {
  const owner = { actorIdentity: "original", companyId: "4" }
  const otherCompany = { ...owner, companyId: "5" }
  const otherActor = { ...owner, actorIdentity: "other" }

  it("shows uncertain timesheets only to their owner and blocks matching resubmission", () => {
    withLocalStorage((values) => {
      const payload = {
        projectId: "8",
        taskId: "9",
        employeeId: "10",
        date: "2026-11-09",
        unitAmount: 2,
      }
      const attempt: TimesheetCaptureOutboxItem = {
        ...owner,
        clientRequestId: "current",
        payload,
        syncState: "submitting",
      }
      values.set(
        "lumiere.timesheet-capture-outbox.7.device",
        JSON.stringify([
          { clientRequestId: "legacy", payload, syncState: "error" },
        ]),
      )
      writeTimesheetCapture(7, "device", attempt)
      const owned = listTimesheetCaptures(7, "device", owner)
      assert.deepEqual(owned, [attempt])
      assert.deepEqual(listTimesheetCaptures(7, "device", otherCompany), [])
      assert.deepEqual(listTimesheetCaptures(7, "device", otherActor), [])
      assert.equal(hasUnconfirmedTimesheetCapture(owned, payload), true)
      assert.equal(
        hasUnconfirmedTimesheetCapture(owned, { ...payload, unitAmount: 3 }),
        false,
      )
      assert.equal(
        hasUnconfirmedTimesheetCapture(
          [{ ...attempt, syncState: "failed" }],
          payload,
        ),
        false,
      )
    })
  })

  it("does not expose or mark warehouse captures from another owner or company", () => {
    withLocalStorage(() => {
      const item = enqueueWarehouseOutboxItem(7, {
        ...owner,
        idempotencyKey: "key",
        deviceId: "device",
        warehouseId: 1,
        opType: "barcode_scan",
        payload: { barcode: "1234" },
      })
      assert.deepEqual(listQueuedWarehouseOutbox(7, "device", otherCompany), [])
      assert.deepEqual(listQueuedWarehouseOutbox(7, "device", otherActor), [])
      markWarehouseOutboxSynced(7, "device", "key", otherActor)
      assert.deepEqual(listQueuedWarehouseOutbox(7, "device", owner), [item])
      markWarehouseOutboxSynced(7, "device", "key", owner)
      assert.deepEqual(listQueuedWarehouseOutbox(7, "device", owner), [])
    })
  })
})
