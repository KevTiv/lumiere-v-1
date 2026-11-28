import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import { startRealtimeConnection } from "./realtime"

class FakeSocket {
  static connections: FakeSocket[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  payload?: unknown
  closed = false

  constructor(public url: string) {
    FakeSocket.connections.push(this)
  }

  send(payload: string) {
    this.payload = JSON.parse(payload)
  }

  close() {
    this.closed = true
    this.onclose?.()
  }

  receive(type: string, resources?: string[]) {
    this.onmessage?.({ data: JSON.stringify({ type, resources }) })
  }
}

function installFakeSockets(t: TestContext) {
  const native = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")!
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeSocket })
  t.after(() => { Object.defineProperty(globalThis, "WebSocket", native) })
  FakeSocket.connections = []
}

async function flush() {
  await Promise.resolve()
}

test("fast failures retain bounded backoff and recover the acknowledged scope once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  installFakeSockets(t)
  const changes: unknown[] = []
  const phases: unknown[] = []
  const dispose = startRealtimeConnection({
    organizationId: 4,
    activeCompanyId: 3,
    resources: ["reports", "auth"],
    url: "wss://example.test",
    onResources: (resources, recovery) => changes.push({ resources, recovery }),
    onPhase: (phase, advance) => phases.push({ phase, advance }),
  })
  t.after(dispose)
  await flush()

  const [first] = FakeSocket.connections
  first!.onopen?.()
  assert.deepEqual(first!.payload, {
    organizationId: 4,
    activeCompanyId: 3,
    companyIds: [3],
    resources: ["reports", "auth"],
  })
  first!.receive("error")
  assert.equal(first!.closed, true)
  assert.deepEqual(phases, [{ phase: "connecting", advance: undefined }, { phase: "reconnecting", advance: false }])
  t.mock.timers.tick(2_000)
  await flush()
  const second = FakeSocket.connections[1]!
  second.onopen?.()
  second.receive("subscribed", ["reports", "outside-scope"])
  second.receive("subscribed", ["reports"])
  assert.deepEqual(changes, [{ resources: ["reports"], recovery: true }])
  second.close()

  t.mock.timers.tick(3_999)
  await flush()
  assert.equal(FakeSocket.connections.length, 2)
  t.mock.timers.tick(1)
  await flush()
  const third = FakeSocket.connections[2]!
  third.onopen?.()
  third.receive("subscribed", ["reports", "auth"])
  t.mock.timers.tick(30_000)
  third.close()
  t.mock.timers.tick(2_000)
  await flush()
  assert.equal(FakeSocket.connections.length, 4)
  assert.deepEqual(phases.slice(-4), [
    { phase: "subscribed", advance: true },
    { phase: "reconnecting", advance: true },
    { phase: "subscribed", advance: true },
    { phase: "reconnecting", advance: true },
  ])
})

test("a stalled credential or subscription times out and scope teardown cancels queued retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  installFakeSockets(t)
  const signals: AbortSignal[] = []
  let finishCredential: (() => void) | undefined
  const dispose = startRealtimeConnection({
    organizationId: 4,
    activeCompanyId: 3,
    resources: ["reports"],
    url: "wss://example.test",
    beforeConnect: (signal) => {
      signals.push(signal)
      return signals.length === 1 ? new Promise<void>((resolve) => { finishCredential = resolve }) : Promise.resolve()
    },
    onPhase: () => {},
    onResources: () => {},
  })
  t.mock.timers.tick(20_000)
  assert.equal(signals[0]?.aborted, true)
  finishCredential?.()
  await flush()
  assert.equal(FakeSocket.connections.length, 0)

  t.mock.timers.tick(2_000)
  await flush()
  FakeSocket.connections[0]?.onopen?.()
  t.mock.timers.tick(20_000)
  assert.equal(FakeSocket.connections[0]?.closed, true)
  assert.equal(signals[1]?.aborted, true)
  dispose()
  t.mock.timers.tick(60_000)
  await flush()
  assert.equal(signals.length, 2)
})

test("a healthy first subscription waits for acknowledgement and needs no recovery reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  installFakeSockets(t)
  const phases: string[] = []
  const changes: unknown[] = []
  const dispose = startRealtimeConnection({
    organizationId: 4,
    activeCompanyId: 3,
    resources: ["auth"],
    url: "wss://example.test",
    onPhase: (phase) => phases.push(phase),
    onResources: (resources, recovery) => changes.push({ resources, recovery }),
  })
  await flush()
  const [socket] = FakeSocket.connections
  socket!.onopen?.()
  socket!.receive("subscribed", ["outside-scope"])
  assert.deepEqual(phases, ["connecting"])
  socket!.receive("subscribed", ["auth"])
  assert.deepEqual(phases, ["connecting", "subscribed"])
  assert.deepEqual(changes, [])
  dispose()
  socket!.receive("change", ["auth"])
  t.mock.timers.tick(60_000)
  await flush()
  assert.deepEqual(phases, ["connecting", "subscribed", "reconnecting"])
  assert.deepEqual(changes, [])
  assert.equal(FakeSocket.connections.length, 1)
})
