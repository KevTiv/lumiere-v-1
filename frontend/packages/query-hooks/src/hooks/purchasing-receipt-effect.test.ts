import assert from "node:assert/strict"
import test from "node:test"
import { createTransitionRunner, WorkflowError, type RowValueMap, type TransitionSpec } from "@lumiere/erp-workflows"
import { captureReceiptSnapshot, observeReceiptQuantity, type ReceiptReads, type ReceiptSnapshot } from "./purchasing-receipt-effect"

const scope = { organizationId: 1n, companyId: 3n }
const line = (extra: RowValueMap = {}) => ({
  id: "5", ...scope, orderId: "7", productId: "9", qtyReceived: 2, productType: null, ...extra,
})
const product = (extra: RowValueMap = {}) => ({ id: "9", organizationId: 1n, type_: "service", ...extra })
const move = (extra: RowValueMap = {}) => ({
  id: "11", ...scope, purchaseLineId: "5", pickingId: "13", state: "assigned", isDone: false, ...extra,
})
const reads = (lines: RowValueMap[] = [line()], products: RowValueMap[] = [product()], moves: RowValueMap[] = []): ReceiptReads => ({
  lines: async () => lines, products: async () => products, moves: async () => moves,
})
const capture = (ports = reads(), qty = 3) => captureReceiptSnapshot("5", qty, scope, ports)
const kind = (expected: string) => (error: unknown) => error instanceof WorkflowError && error.kind === expected

test("canonical line cardinality zero/one/multiple is fail-closed", async () => {
  await assert.rejects(capture(reads([])), kind("validation"))
  assert.equal((await capture()).qtyReceived, 2)
  await assert.rejects(capture(reads([line(), line()])), kind("conflict"))
})

test("snapshot requires finite quantities and exact current-company/product metadata", async () => {
  for (const qty of [NaN, Infinity, -1, 0]) await assert.rejects(capture(reads(), qty), kind("validation"))
  for (const extra of [{ qtyReceived: undefined }, { qtyReceived: "" }, { qtyReceived: NaN },
    { companyId: 4n }, { organizationId: 2n }, { productId: undefined }, { orderId: undefined }]) {
    await assert.rejects(capture(reads([line(extra)])), kind("validation"))
  }
  for (const products of [[], [product({ organizationId: 2n })], [product({ type_: undefined })]]) {
    await assert.rejects(capture(reads([line({ productType: "service" })], products)), kind("validation"))
  }
  await assert.rejects(capture(reads([line()], [product(), product()])), kind("conflict"))
})

test("canonical service quantity proof gives same-line ref and no stock navigation", async () => {
  const snapshot = await capture()
  const observed = await observeReceiptQuantity(snapshot, reads([line({ qtyReceived: 5 })]))
  assert.equal(observed.outcome, "applied")
  assert.deepEqual(observed.createdRecords, [{ resource: "purchase_order_line", id: "5", module: "purchasing" }])
  assert.equal(observed.next, undefined)
})

test("post quantity is mandatory: absent, unchanged, wrong, malformed or ambiguous never succeeds", async () => {
  const snapshot = await capture()
  for (const lines of [[], [line()], [line({ qtyReceived: 4 })], [line({ qtyReceived: 6 })],
    [line({ qtyReceived: undefined })], [line({ qtyReceived: Infinity })], [line({ qtyReceived: null })],
    [line({ id: "6", qtyReceived: 5 })], [line({ qtyReceived: 5, companyId: 4n })],
    [line({ qtyReceived: 5, orderId: "8" })], [line({ qtyReceived: 5, productId: "10" })]]) {
    assert.deepEqual(await observeReceiptQuantity(snapshot, reads(lines)), {})
  }
  await assert.rejects(observeReceiptQuantity(snapshot, reads([line({ qtyReceived: 5 }), line({ qtyReceived: 5 })])), kind("conflict"))
  assert.deepEqual(await observeReceiptQuantity(undefined, reads()), {})
})

test("zero stock moves is not service classification, even if line productType says service", async () => {
  const snapshot = await capture(reads([line({ productType: "service" })], [product({ type_: "product" })]))
  assert.equal(snapshot.service, false)
  assert.deepEqual(await observeReceiptQuantity(snapshot, reads([line({ qtyReceived: 5 })])), {})
})

test("matching stock needs captured move/picking identity AND exact line delta; navigation is preserved", async () => {
  const snapshot = await capture(reads([line()], [product({ type_: "product" })], [move()]))
  assert.deepEqual(snapshot.target, { moveId: "11", pickingId: "13" })
  const post = reads([line({ qtyReceived: 5 })], [], [move({ isDone: true, state: "done" })])
  const observed = await observeReceiptQuantity(snapshot, post)
  assert.equal(observed.outcome, "applied")
  assert.equal(observed.next?.resource, "stock_picking")
  assert.equal(observed.next?.id, "13")
  assert.deepEqual(await observeReceiptQuantity(snapshot, reads([line()], [], [move({ isDone: true })])), {})
  for (const extra of [{ id: "12" }, { pickingId: "14" }, { purchaseLineId: "6" },
    { isDone: false, state: "assigned" }, { companyId: 4n }, { organizationId: 2n }]) {
    assert.deepEqual(await observeReceiptQuantity(snapshot,
      reads([line({ qtyReceived: 5 })], [], [move({ isDone: true, state: "done", ...extra })])), {})
  }
  await assert.rejects(observeReceiptQuantity(snapshot, reads([line({ qtyReceived: 5 })], [],
    [move({ isDone: true }), move({ isDone: true })])), kind("conflict"))
})

test("stock target zero/one/multiple and malformed matches use the existing resolver", async () => {
  assert.equal((await capture()).target, undefined)
  assert.equal((await capture(reads([line()], [product()], [move()]))).target?.moveId, "11")
  await assert.rejects(capture(reads([line()], [product()], [move(), move({ id: "12" })])), kind("conflict"))
  await assert.rejects(capture(reads([line()], [product()], [move({ pickingId: undefined })])), kind("conflict"))
  await assert.rejects(capture(reads([line()], [product()], [move({ companyId: 4n })])), kind("conflict"))
})

test("snake-case projections and decimal floating-point readback remain canonical", async () => {
  const rows = [{ id: "5", organization_id: "1", company_id: "3", order_id: "7", product_id: "9", qty_received: "0.1" }]
  const snapshot = await capture(reads(rows, [product()]), 0.2)
  assert.equal((await observeReceiptQuantity(snapshot, reads([{ ...rows[0], qty_received: "0.3" }]))).outcome, "applied")
  assert.deepEqual(await observeReceiptQuantity(snapshot, reads([{ ...rows[0], qty_received: "0.3000001" }])), {})
})

test("thrown canonical pre/post reads propagate rather than becoming success", async () => {
  const failure = new Error("canonical read failed")
  for (const resource of ["lines", "products", "moves"] as const) {
    await assert.rejects(capture({ ...reads(), [resource]: async () => { throw failure } }),
      (error) => error instanceof WorkflowError && error.kind === "server_failure" && error.cause === failure)
  }
  const service = await capture()
  await assert.rejects(observeReceiptQuantity(service, { ...reads(), lines: async () => { throw failure } }), (error) => error === failure)
  const stock = await capture(reads([line()], [product({ type_: "product" })], [move()]))
  await assert.rejects(observeReceiptQuantity(stock, {
    ...reads([line({ qtyReceived: 5 })]), moves: async () => { throw failure },
  }), (error) => error === failure)
})

test("application runner single-flight captures once before dispatch and only notifies/navigates after both proofs", async () => {
  let captures = 0
  let dispatches = 0
  let received = 2
  const events: string[] = []
  const ports = reads([line()], [product({ type_: "product" })], [move()])
  ports.lines = async () => { captures += 1; events.push("read"); return [line({ qtyReceived: received })] }
  ports.moves = async () => [move({ isDone: dispatches > 0, state: dispatches > 0 ? "done" : "assigned" })]
  type Input = { snapshot?: ReceiptSnapshot }
  const spec: TransitionSpec<Input> = {
    id: "purchasing.line.receive", affects: ["purchase-order-lines", "stock-moves"],
    command: async (input) => {
      input.snapshot = await capture(ports)
      events.push("dispatch")
      dispatches += 1
      received = 5
    },
    observe: ({ snapshot }) => observeReceiptQuantity(snapshot, ports),
  }
  const runner = createTransitionRunner({
    invalidate: async () => { events.push("invalidate") },
    notify: (notice) => { events.push(notice.kind) },
    navigate: (ref) => { events.push(`navigate:${ref.id}`) },
  })
  const first = runner.run("receive:5", spec, {}, { navigateToNext: true })
  const duplicate = runner.run("receive:5", spec, {}, { navigateToNext: true })
  assert.strictEqual(first, duplicate)
  assert.equal((await first).outcome, "applied")
  assert.equal(dispatches, 1)
  assert.equal(captures, 2)
  assert.deepEqual(events, ["read", "dispatch", "invalidate", "read", "success", "navigate:13"])
})

test("application runner never sends success/navigation for missing quantity or failed post-read", async () => {
  for (const failRead of [false, true]) {
    let snapshot: ReceiptSnapshot | undefined
    const notices: string[] = []
    const spec: TransitionSpec<void> = {
      id: "purchasing.line.receive", affects: ["purchase-order-lines"],
      command: async () => { snapshot = await capture() },
      observe: () => observeReceiptQuantity(snapshot, {
        ...reads(),
        lines: async () => {
          if (failRead) throw new TypeError("read disconnected")
          return [line()]
        },
      }),
    }
    const runner = createTransitionRunner({
      invalidate: async () => undefined,
      notify: (notice) => { notices.push(notice.kind) },
      navigate: () => { notices.push("navigate") },
    })
    await assert.rejects(runner.run("receive:5", spec, undefined, { navigateToNext: true }), kind("outcome_unknown"))
    assert.deepEqual(notices, ["error"])
  }
})

test("application runner pre-read failure is definite and dispatch is never attempted", async () => {
  let dispatched = false
  const spec: TransitionSpec<void> = {
    id: "purchasing.line.receive", affects: ["purchase-order-lines"],
    command: async () => {
      await capture({ ...reads(), lines: async () => { throw new TypeError("pre-read disconnected") } })
      dispatched = true
    },
    observe: () => observeReceiptQuantity(undefined, reads()),
  }
  const runner = createTransitionRunner({ invalidate: async () => undefined })
  await assert.rejects(runner.run("receive:5", spec, undefined), kind("server_failure"))
  assert.equal(dispatched, false)
})

test("quantity evidence accepts finite unsigned decimals, including scientific JSON floats", async () => {
  for (const raw of [0, "0", 0.1, "0.1", "1e-1", "1E-1", "0.10", "1e+0"]) {
    const snapshot = await capture(reads([line({ qtyReceived: raw })]))
    assert.equal(snapshot.qtyReceived, Number(raw))
    const after = (snapshot.qtyReceived + 3).toExponential()
    assert.equal((await observeReceiptQuantity(snapshot, reads([line({ qtyReceived: after })]))).outcome, "applied")
  }
})

test("invalid quantities cannot prove a pre/post receipt or permit a service dispatch", async () => {
  const snapshot = await capture()
  for (const raw of [-1, "-1", "0x5", true, false, {}, [], "", " ", " 5", "5 ",
    Infinity, "Infinity", NaN, "NaN", "1e999", "+5", "05", ".5", "5."]) {
    await assert.rejects(capture(reads([line({ qtyReceived: raw })])), kind("validation"))
    assert.deepEqual(await observeReceiptQuantity(snapshot, reads([line({ qtyReceived: raw })])), {})
  }
  let dispatches = 0
  const notices: string[] = []
  const runner = createTransitionRunner({
    invalidate: async () => undefined,
    notify: (notice) => { notices.push(notice.kind) },
  })
  let baseline: ReceiptSnapshot | undefined
  await assert.rejects(runner.run("receive:5", {
    id: "purchasing.line.receive", affects: ["purchase-order-lines"],
    command: async () => {
      baseline = await capture(reads([line({ qtyReceived: -1 })]))
      dispatches++
    },
    observe: () => observeReceiptQuantity(baseline, reads([line({ qtyReceived: 2 })])),
  }, undefined), kind("validation"))
  assert.equal(dispatches, 0)
  assert.deepEqual(notices, ["error"])
  assert.deepEqual(await observeReceiptQuantity({ ...snapshot, qtyReceived: -1 },
    reads([line({ qtyReceived: 2 })])), {})
})

test("malformed or contradictory matching move evidence fails closed in pre/post reads", async () => {
  const snapshot = await capture(reads([line()], [product({ type_: "product" })], [move()]))
  for (const extra of [
    { isDone: undefined }, { isDone: null }, { isDone: "false" }, { isDone: "true" },
    { isDone: 0 }, { isDone: 1 }, { isDone: true, state: "assigned" },
    { isDone: false, state: "done" },
  ]) {
    await assert.rejects(capture(reads([line()], [product()], [move(extra)])), kind("conflict"))
    assert.deepEqual(await observeReceiptQuantity(snapshot,
      reads([line({ qtyReceived: 5 })], [], [move(extra)])), {})
  }
})
