import assert from "node:assert/strict"
import test from "node:test"
import { beginReceiptInvocation, clearReceiptInvocation, executeReceiptInvocation, observeReceiptInvocation, receiptStorageKey, type PendingReceipt, type ReceiptStorage } from "./purchasing-receipt-invocation"
import type { ReceiptSnapshot } from "./purchasing-receipt-effect"
const scope = { organizationId: 1n, companyId: 2n, actorHex: "ab".repeat(32) }
const snapshot: ReceiptSnapshot = { ...scope, lineId: "3", orderId: 4n, productId: 5n, qtyReceived: 0, qty: 1, service: false, target: { moveId: "6", pickingId: "7" } }
const storage = (): ReceiptStorage => { const data = new Map<string, string>(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } } }
const begin = (store: ReceiptStorage, capture = async () => snapshot, qty = 1, lot: unknown = null) => beginReceiptInvocation(scope, "3", qty, lot, store, capture, () => "operation_first")
const receipt = (p: PendingReceipt) => ({ id: `1:2:${p.operationKey}`, organizationId: 1, companyId: 2, operationKey: p.operationKey, lineId: 3, orderId: 4, quantity: 1, lotId: null, receivedBefore: 0, receivedAfter: 1, moveId: 6, pickingId: 7 })
test("refresh/retry preserves key and reviewed target without recapturing a backorder", async () => {
  const store = storage(); const first = await begin(store)
  assert.deepEqual(await begin(store, async () => { throw Error("must not recapture") }), first)
  assert.equal(observeReceiptInvocation(first, [receipt(first)]).outcome, "applied")
})
test("different pending quantity or lot conflicts without replacing identity", async () => {
  const store = storage(); const first = await begin(store)
  await assert.rejects(begin(store, undefined, 2), /Resolve the pending receipt/)
  await assert.rejects(begin(store, undefined, 1, 9), /Resolve the pending receipt/)
  assert.equal(JSON.parse(store.getItem(receiptStorageKey(scope, "3"))!).operationKey, first.operationKey)
})
test("missing or inconsistent canonical receipt remains unknown", async () => {
  const store = storage(); const p = await begin(store)
  assert.deepEqual(observeReceiptInvocation(p, []), {})
  for (const change of [{ companyId: 99 }, { lineId: 99 }, { orderId: 99 }, { quantity: 2 }, { receivedAfter: NaN }, { receivedAfter: 2 }, { moveId: null }, { lotId: 8 }]) assert.deepEqual(observeReceiptInvocation(p, [{ ...receipt(p), ...change }]), {})
  assert.throws(() => observeReceiptInvocation(p, [receipt(p), receipt(p)]), /Multiple canonical/)
  assert.ok(store.getItem(receiptStorageKey(scope, "3")))
})
test("proof clearing cannot remove a newer intentional invocation", async () => {
  const store = storage(); const p = await begin(store)
  assert.equal(observeReceiptInvocation(p, [receipt(p)]).next?.id, "7")
  clearReceiptInvocation(scope, p, store)
  const next = await beginReceiptInvocation(scope, "3", 1, null, store, async () => ({ ...snapshot, qtyReceived: 1, target: { moveId: "8", pickingId: "9" } }), () => "operation_second")
  clearReceiptInvocation(scope, p, store)
  assert.equal(JSON.parse(store.getItem(receiptStorageKey(scope, "3"))!).operationKey, next.operationKey)
})
test("corrupt or unavailable storage fails before dispatch", async () => {
  const store = storage(); store.setItem(receiptStorageKey(scope, "3"), "{broken")
  await assert.rejects(begin(store), /Pending receipt data is invalid/)
  await assert.rejects(begin({ ...storage(), setItem: () => { throw Error("quota") } }), /Cannot preserve receipt identity/)
  await assert.rejects(beginReceiptInvocation({ ...scope, actorHex: "bad" }, "3", 1, null, storage(), async () => snapshot, () => "key"), /actor and scope/)
})
test("actor/company partitioning and service receipt proof remain exact", async () => {
  assert.notEqual(receiptStorageKey(scope, "3"), receiptStorageKey({ ...scope, actorHex: "cd".repeat(32) }, "3"))
  assert.notEqual(receiptStorageKey(scope, "3"), receiptStorageKey({ ...scope, companyId: 9n }, "3"))
  const p = await begin(storage(), async () => ({ ...snapshot, service: true, target: undefined }))
  assert.equal(observeReceiptInvocation(p, [{ ...receipt(p), moveId: null, pickingId: null }]).next?.resource, "purchase_order_line")
})
test("lost acknowledgement followed by refresh resolves evidence without another dispatch", async () => {
  const store = storage(); let committed: PendingReceipt | undefined; let sends = 0
  const ports = { capture: async () => snapshot, makeKey: () => "lost_ack_key", read: async () => committed ? [receipt(committed)] : [],
    dispatch: async (p: PendingReceipt) => { sends++; committed = p; throw Error("connection lost after commit") } }
  await assert.rejects(executeReceiptInvocation(scope, "3", 1, null, store, ports), /connection lost/)
  const recovered = await executeReceiptInvocation(scope, "3", 1, null, store, { ...ports, capture: async () => { throw Error("must not retarget") } })
  assert.equal(observeReceiptInvocation(recovered.pendingReceipt, recovered.receiptEvidence!).outcome, "applied")
  assert.equal(sends, 1)
})
test("unavailable producer probe cannot persist or dispatch a new invocation", async () => {
  const store = storage()
  await assert.rejects(executeReceiptInvocation(scope, "3", 1, null, store, { capture: async () => snapshot, makeKey: () => "key",
    read: async () => { throw Error("old backend") }, dispatch: async () => { assert.fail("must not dispatch") } }), /old backend/)
  assert.equal(store.getItem(receiptStorageKey(scope, "3")), null)
})
