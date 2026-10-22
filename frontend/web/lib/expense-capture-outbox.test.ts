import assert from "node:assert/strict"
import test from "node:test"
import {
  enqueueExpenseCapture,
  listQueuedExpenseCaptures,
  readExpenseCaptureOutbox,
  requeueExpenseCapture,
  saveExpenseCaptureCheckpoint,
} from "./expense-capture-outbox"

function local(run: (values: Map<string, string>) => void) {
  const before = Object.getOwnPropertyDescriptor(globalThis, "window"),
    values = new Map<string, string>()
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
    if (before) Object.defineProperty(globalThis, "window", before)
    else Reflect.deleteProperty(globalThis, "window")
  }
}
const seed = {
  clientRequestId: "expense-key",
  deviceId: "device",
  companyId: "9007199254740993",
  payload: {
    employeeId: "7",
    name: "Receipt capture",
    date: "2026-10-20",
    unitAmount: 5,
    quantity: 1,
    currencyId: "8",
    hasReceipt: true,
    lineKind: "Standard" as const,
  },
  receipt: {
    state: "queued" as const,
    clientRequestId: "receipt-key",
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    lastModified: 1000,
  },
}

test("capture checkpoints survive JSON reload with exact request, upload and record IDs", () =>
  local(() => {
    const item = enqueueExpenseCapture(9, seed)
    saveExpenseCaptureCheckpoint(9, "device", {
      ...item,
      receipt: {
        ...item.receipt!,
        state: "attached",
        receiptId: "9007199254740994",
        uploaded: {
          objectKey: "verified-key",
          checksum: "hash",
          fileName: "receipt.pdf",
          mimetype: "application/pdf",
          fileSize: "12",
        },
      },
    })
    const restored = readExpenseCaptureOutbox(9, "device")[0]
    assert.equal(restored.companyId, "9007199254740993")
    assert.equal(restored.receipt?.clientRequestId, "receipt-key")
    assert.equal(restored.receipt?.receiptId, "9007199254740994")
    assert.equal(restored.receipt?.uploaded?.objectKey, "verified-key")
    assert.equal(restored.receipt?.uploaded?.fileSize, "12")
    assert.equal("file" in restored.receipt!, false)
  }))

test("interrupted or unknown expense dispatch cannot be reset to a fresh queue command", () =>
  local(() => {
    let item = enqueueExpenseCapture(9, seed)
    for (const syncState of ["submitting", "unknown"] as const) {
      item = { ...item, syncState }
      saveExpenseCaptureCheckpoint(9, "device", item)
      requeueExpenseCapture(9, "device", item.clientRequestId)
      assert.equal(
        readExpenseCaptureOutbox(9, "device")[0].syncState,
        syncState,
      )
      assert.equal(listQueuedExpenseCaptures(9, "device").length, 1)
    }
  }))

test("checkpoint writes fail on missing or duplicate capture identity", () =>
  local((values) => {
    const item = enqueueExpenseCapture(9, seed)
    assert.throws(
      () =>
        saveExpenseCaptureCheckpoint(9, "device", {
          ...item,
          clientRequestId: "missing",
        }),
      /unavailable or ambiguous/,
    )
    const key = [...values.keys()][0]
    values.set(key, JSON.stringify([item, item]))
    assert.throws(
      () => saveExpenseCaptureCheckpoint(9, "device", item),
      /unavailable or ambiguous/,
    )
  }))
