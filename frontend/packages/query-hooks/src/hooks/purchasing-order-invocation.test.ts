import assert from "node:assert/strict"
import test from "node:test"

import {
  executePurchaseOrderCreation,
  toCreatePurchaseOrderOnceParams,
  purchaseOrderStorageKey,
  type PendingPurchaseOrder,
} from "./purchasing-order-invocation"
import type { ReceiptStorage } from "./purchasing-receipt-invocation"

const scope = { organizationId: 1n, companyId: 2n, actorHex: "ab".repeat(32) }
const payload = { partner_id: 3, currency_id: 4, notes: { none: [] } }
const storage = (): ReceiptStorage => {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => { rows.set(key, value) },
    removeItem: (key) => { rows.delete(key) },
  }
}
const evidence = (pending: PendingPurchaseOrder) => ({
  id: `1:2:${pending.operationKey}`,
  organizationId: 1,
  companyId: 2,
  operationKey: pending.operationKey,
  purchaseOrderId: 9,
  payloadHash: `sha256:${"c".repeat(64)}`,
})

test("lost PO response replays the saved key and resolves exact evidence without a second dispatch", async () => {
  const store = storage()
  let committed: PendingPurchaseOrder | undefined
  let dispatches = 0
  const ports = {
    makeKey: () => "po_lost_ack",
    read: async () => committed ? [evidence(committed)] : [],
    dispatch: async (pending: PendingPurchaseOrder) => {
      dispatches += 1
      committed = pending
      throw new Error("response lost")
    },
  }
  await assert.rejects(executePurchaseOrderCreation(scope, payload, store, ports), /response lost/)
  const recovered = await executePurchaseOrderCreation(scope, payload, store, {
    ...ports,
    dispatch: async () => assert.fail("must not dispatch an applied key"),
  })
  assert.equal(recovered.purchaseOrderId, "9")
  assert.equal(dispatches, 1)
  assert.equal(store.getItem(purchaseOrderStorageKey(scope)), null)
})

test("a pending PO rebases changed input only after an empty read and corrupt identity fails closed", async () => {
  const store = storage()
  await assert.rejects(executePurchaseOrderCreation(scope, payload, store, {
    makeKey: () => "po_pending",
    read: async () => [],
    dispatch: async () => { throw new Error("offline") },
  }), /offline/)
  let replacement: PendingPurchaseOrder | undefined
  await assert.rejects(executePurchaseOrderCreation(scope, { ...payload, currency_id: 8 }, store, {
    makeKey: () => "different",
    read: async () => [],
    dispatch: async (pending) => { replacement = pending; throw new Error("new response lost") },
  }), /new response lost/)
  assert.equal(replacement?.operationKey, "different")
  assert.equal(replacement?.payload.currency_id, 8)

  await assert.rejects(executePurchaseOrderCreation(scope, { ...payload, currency_id: 9 }, store, {
    makeKey: () => "must_not_replace",
    read: async () => { throw new Error("evidence unavailable") },
    dispatch: async () => assert.fail("must not dispatch without definitive readback"),
  }), /evidence unavailable/)
  assert.equal(JSON.parse(store.getItem(purchaseOrderStorageKey(scope))!).operationKey, "different")

  const corrupt = storage()
  corrupt.setItem(purchaseOrderStorageKey(scope), "{broken")
  await assert.rejects(executePurchaseOrderCreation(scope, payload, corrupt, {
    makeKey: () => "unused",
    read: async () => assert.fail("must not read an untrusted key"),
    dispatch: async () => assert.fail("must not dispatch corrupt identity"),
  }), /data is invalid/)
})

test("new PO creation probes capability, dispatches once, and requires exact readback", async () => {
  const store = storage()
  let pending: PendingPurchaseOrder | undefined
  const result = await executePurchaseOrderCreation(scope, payload, store, {
    makeKey: () => "po_new",
    read: async (key) => key === "capability_probe" || !pending ? [] : [evidence(pending)],
    dispatch: async (value) => { pending = value },
  })
  assert.equal(result.purchaseOrderId, "9")
})

test("PO once payload uses exact SATS option and timestamp encoding", () => {
  assert.deepEqual(toCreatePurchaseOrderOnceParams({
    partnerId: 3n,
    currencyId: 4n,
    origin: "REQ-1",
    datePlanned: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
    paymentTermId: 5n,
  }), {
    partner_id: 3,
    currency_id: 4,
    origin: { some: "REQ-1" },
    partner_ref: { none: [] },
    notes: { none: [] },
    date_planned: { some: { __timestamp_micros_since_unix_epoch__: 1_700_000_000_000_000 } },
    payment_term_id: { some: 5 },
    fiscal_position_id: { none: [] },
    incoterm_id: { none: [] },
    incoterm_location: { none: [] },
    is_quantity_copy: { none: [] },
    metadata: { none: [] },
  })
})
