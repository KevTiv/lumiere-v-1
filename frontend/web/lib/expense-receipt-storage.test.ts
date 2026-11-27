import assert from "node:assert/strict"
import test from "node:test"
import { readExpenseCaptureOutbox, saveExpenseCaptureCheckpoint, type ExpenseCaptureOutboxItem } from "./expense-capture-outbox"
import { readExpenseReceipt, receiptStorageKey, storeExpenseReceipt } from "./expense-receipt-storage"
import { sha256Hex } from "./document-blob-upload"
import { enqueueRetainedExpense, syncRetainedExpense } from "../app/(modules)/expenses/retained-expense-receipt"

const file = new File(["original"], "receipt.pdf", { type: "application/pdf", lastModified: 100 })
const draft = {
  actorIdentity: "alice",
  clientRequestId: "expense",
  deviceId: "device",
  companyId: "2",
  payload: { employeeId: "7", name: "Receipt", date: "2026-11-27", unitAmount: 2, quantity: 1, currencyId: "8", hasReceipt: true, lineKind: "Standard" },
  receipt: { state: "queued", clientRequestId: "receipt", fileName: file.name, fileSize: file.size, mimeType: file.type, lastModified: file.lastModified },
} satisfies Parameters<typeof enqueueRetainedExpense>[1]

/** Emulates the async request and transaction boundary for the focused model test. */
function browserStorage() {
  const blobs = new Map<string, Blob>()
  const local = new Map<string, string>()
  const window = { localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) } }
  let quotaExceeded = false
  const indexedDB = {
    open() {
      const request = { onsuccess: () => {}, result: {
        close: () => {},
        transaction() {
          const transaction = {
            oncomplete: () => {},
            onabort: () => {},
            error: undefined as Error | undefined,
            objectStore() {
              const complete = <T>(work: () => T) => {
                const request = { result: undefined as T | undefined, error: undefined as Error | undefined }
                queueMicrotask(() => {
                  try {
                    request.result = work()
                  } catch (error) {
                    request.error = error as Error
                    transaction.onabort()
                    return
                  }
                  transaction.oncomplete()
                })
                return request
              }
              return {
                get: (key: string) => complete(() => blobs.get(key)),
                put: (value: Blob, key: string) => complete(() => {
                  if (quotaExceeded) throw new DOMException("Full", "QuotaExceededError")
                  blobs.set(key, structuredClone(value))
                }),
                delete: (key: string) => complete(() => blobs.delete(key)),
              }
            },
          }
          return transaction
        },
      } }
      queueMicrotask(() => request.onsuccess())
      return request
    },
  }
  return { indexedDB, window, failWrites: () => { quotaExceeded = true } }
}

test("both forms resume the original local bytes after reload, only in the recorded scope, without redispatching unknown saves", async (t) => {
  const browser = browserStorage()
  const scope = { organizationId: 9n, companyId: 2n, actorIdentity: "alice" }
  Object.assign(globalThis, { window: browser.window, indexedDB: browser.indexedDB })
  t.after(() => { Reflect.deleteProperty(globalThis, "window"); Reflect.deleteProperty(globalThis, "indexedDB") })
  for (const item of [draft, { ...draft, clientRequestId: "generic", actorIdentity: undefined, formOrigin: { actorIdentity: "alice", organizationId: "9", pricelistId: "13" } }]) {
    await enqueueRetainedExpense("9", item, file)
    await assert.rejects(enqueueRetainedExpense("9", item, new File(["tampered"], file.name, { type: file.type, lastModified: file.lastModified })), /already retained/)
    const saved = readExpenseCaptureOutbox("9", "device", true).find(row => row.clientRequestId === item.clientRequestId)!
    const restored = await readExpenseReceipt("9", saved)
    assert.equal(await restored?.text(), "original")
    assert.equal(restored?.lastModified, 100)
    assert.equal(await readExpenseReceipt("9", { ...saved, companyId: "3" }), undefined)
    assert.equal(await readExpenseReceipt("9", { ...saved, deviceId: "another-device" }), undefined)
    await assert.rejects(storeExpenseReceipt("9", saved, new File(["tampered"], file.name, { type: file.type, lastModified: file.lastModified })), /does not match/)
    let uploads = 0
    let creates = 0
    let receipt: { id: bigint; organizationId: bigint; companyId: bigint; employeeId: bigint; clientRequestId: string; storageKey: string; contentHash: string } | undefined
    const services = {
      readExpenses: async () => [],
      readReceipts: async () => receipt ? [receipt] : [],
      upload: async (original: File) => {
        uploads++
        assert.equal(await original.text(), "original")
        return { objectKey: item.clientRequestId, checksum: await sha256Hex(original), fileName: original.name, mimetype: original.type, fileSize: BigInt(original.size), url: "" }
      },
      register: async (params: Omit<NonNullable<typeof receipt>, "id" | "organizationId">) => {
        receipt = { ...params, id: 31n, organizationId: 9n }
        return 31n
      },
      create: async () => { creates++; throw new Error("Interrupted response") },
      save: (next: ExpenseCaptureOutboxItem) => saveExpenseCaptureCheckpoint("9", "device", next),
    }
    await assert.rejects(syncRetainedExpense(saved, { ...scope, actorIdentity: "bob" }, services), /signed-in account/)
    assert.equal((await syncRetainedExpense(saved, scope, services)).syncState, "unknown")
    assert.equal((await syncRetainedExpense(saved, scope, services)).syncState, "unknown")
    assert.equal(await readExpenseReceipt("9", saved), undefined)
    assert.deepEqual({ uploads, creates }, { uploads: 1, creates: 1 })
  }
})

test("quota failure leaves no resumable request and scope keys never alias identities or companies", async (t) => {
  const browser = browserStorage()
  Object.assign(globalThis, { window: browser.window, indexedDB: browser.indexedDB })
  t.after(() => { Reflect.deleteProperty(globalThis, "window"); Reflect.deleteProperty(globalThis, "indexedDB") })
  browser.failWrites()
  await assert.rejects(enqueueRetainedExpense("9", draft, file), /could not be saved.*No upload was sent/)
  assert.deepEqual(readExpenseCaptureOutbox("9", "device", true), [])
  const key = receiptStorageKey("9", draft)
  assert.notEqual(key, receiptStorageKey("10", draft))
  assert.notEqual(key, receiptStorageKey("9", { ...draft, actorIdentity: "bob" }))
  assert.notEqual(key, receiptStorageKey("9", { ...draft, receipt: { ...draft.receipt, clientRequestId: "new" } }))
})
