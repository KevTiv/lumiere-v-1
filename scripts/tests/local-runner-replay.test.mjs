import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isDeviceMessage } from "../../local-runner/protocol/v1.mjs";
import { runDaemon } from "../../local-runner/src/daemon.mjs";
import { openJournal } from "../../local-runner/src/journal.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../../local-runner/protocol/fixture-v1.json", import.meta.url), "utf8"),
);
const { runId, attemptId, leaseId } = fixture.dispatch;
const attempt = { runId, attemptId, leaseId };

function createRelayFixture() {
  const changes = new EventEmitter();
  const connections = [];
  const frames = [];

  class RelaySocket extends EventTarget {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    bufferedAmount = 0;

    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.connection = connections.push(this) - 1;
      queueMicrotask(() => {
        this.readyState = RelaySocket.OPEN;
        this.dispatchEvent(new Event("open"));
        changes.emit("changed");
      });
    }

    send(data) {
      assert.equal(this.readyState, RelaySocket.OPEN);
      frames.push({ index: this.connection, message: JSON.parse(data) });
      changes.emit("changed");
    }

    receive(message) {
      assert.equal(this.readyState, RelaySocket.OPEN);
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }

    disconnect(code = 1006) {
      this.readyState = RelaySocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close", { code, wasClean: code === 1000 }));
    }

    close(code = 1000) {
      if (this.readyState !== RelaySocket.CLOSED) this.disconnect(code);
    }
  }

  return {
    Socket: RelaySocket,
    connections,
    frames,
    async waitFor(project, description) {
      const signal = AbortSignal.timeout(3_000);
      while (true) {
        const value = project();
        if (value !== undefined) return value;
        try {
          await once(changes, "changed", { signal });
        } catch (error) {
          throw new Error(`timed out waiting for ${description}`, { cause: error });
        }
      }
    },
    frame(index, matches, description) {
      return this.waitFor(
        () => frames.find(frame => frame.index === index && matches(frame.message))?.message,
        description,
      );
    },
  };
}

async function startFixture(t, adapter, prepareJournal) {
  const relay = createRelayFixture();
  const directory = await mkdtemp(join(tmpdir(), "lumiere-runner-replay-"));
  const deviceId = "fixture-device-1";
  const journal = openJournal({ directory, deviceId });
  prepareJournal?.(journal);
  const controller = new AbortController();
  const credential = "fixture-device-credential";
  const active = runDaemon({
    adapters: {
      codex: {
        ...adapter,
        async probe() {
          return fixture.hello.providers[0];
        },
      },
    },
    journal,
    url: "wss://fixture.invalid/v1/local-runner/device",
    deviceId,
    credential,
    WebSocket: relay.Socket,
    signal: controller.signal,
    reconnectMs: 1,
    maxReconnectMs: 1,
  });
  t.after(async () => {
    controller.abort();
    try {
      await active;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const hello = await relay.frame(0, message => message.type === "hello", "provider discovery");
  assert.ok(isDeviceMessage(hello));
  assert.deepEqual(hello.providers[0], fixture.hello.providers[0]);
  assert.equal(hello.providers[0].funding, "unknown");
  const headers = new Headers(relay.connections[0].options.headers);
  assert.equal(headers.get("authorization"), `Bearer ${credential}`);
  assert.equal(headers.get("x-lumiere-runner-device-id"), deviceId);
  assert.ok(!JSON.stringify(hello).includes(credential));
  return relay;
}

test("reconnect replays the original event without starting a second provider turn", { timeout: 10_000 }, async t => {
  const finish = Promise.withResolvers();
  let starts = 0;
  const relay = await startFixture(t, {
    async startTurn(dispatch, { signal, emit }) {
      starts++;
      assert.deepEqual(dispatch, fixture.dispatch);
      await emit({ type: "activity", message: "Looking up stock evidence" });
      await Promise.race([finish.promise, once(signal, "abort")]);
      if (!signal.aborted) await emit(fixture.candidate.event);
    },
  });

  const firstLink = relay.connections[0];
  firstLink.receive(fixture.dispatch);
  firstLink.receive(fixture.dispatch);
  const activity = await relay.frame(0, message => message.event?.type === "activity", "first activity");
  assert.deepEqual(activity, {
    type: "event",
    ...attempt,
    seq: 1,
    event: { type: "activity", message: "Looking up stock evidence" },
  });
  assert.ok(isDeviceMessage(activity));
  firstLink.disconnect();

  await relay.frame(1, message => message.type === "hello", "reconnect handshake");
  const secondLink = relay.connections[1];
  secondLink.receive(fixture.dispatch);
  const replay = await relay.frame(1, message => message.event?.type === "activity", "unacknowledged event replay");
  assert.deepEqual(replay, activity);
  secondLink.receive({ ...fixture.ack, seq: activity.seq });
  finish.resolve();

  const candidate = await relay.frame(1, message => message.event?.type === "candidate", "candidate result");
  assert.deepEqual(candidate, fixture.candidate);
  assert.ok(isDeviceMessage(candidate));
  assert.equal(starts, 1);
  assert.ok(!relay.frames.some(frame => frame.message.event?.type === "verified"));
});

test("repeated cancellation settles the matching provider attempt once", { timeout: 10_000 }, async t => {
  const cancelled = Promise.withResolvers();
  const cancel = t.mock.fn(async () => {
    cancelled.resolve();
    return true;
  });
  const relay = await startFixture(t, {
    cancel,
    async startTurn(_dispatch, { signal, emit }) {
      await emit({ type: "activity", message: "Waiting for provider" });
      await Promise.race([cancelled.promise, once(signal, "abort")]);
      if (!signal.aborted) await emit({ type: "cancelled" });
    },
  });

  const link = relay.connections[0];
  link.receive(fixture.dispatch);
  const activity = await relay.frame(0, message => message.event?.type === "activity", "provider start");
  link.receive({ ...fixture.ack, seq: activity.seq });
  link.receive({ type: "cancel", ...attempt });
  link.receive({ type: "cancel", ...attempt });

  const result = await relay.frame(0, message => message.event?.type === "cancelled", "provider cancellation");
  assert.equal(result.leaseId, attempt.leaseId);
  assert.equal(result.seq, 2);
  assert.ok(isDeviceMessage(result));
  assert.equal(cancel.mock.callCount(), 1);
  assert.equal(relay.frames.filter(frame => frame.message.event?.type === "cancelled").length, 1);
});

test("an unconfirmed cancellation leaves the provider outcome unknown", { timeout: 10_000 }, async t => {
  const relay = await startFixture(t, {
    async startTurn(_dispatch, { signal, emit }) {
      await emit({ type: "activity", message: "Waiting for provider" });
      if (!signal.aborted) await once(signal, "abort");
    },
  });
  const link = relay.connections[0];
  link.receive(fixture.dispatch);
  await relay.frame(0, message => message.event?.type === "activity", "provider start");
  link.receive({ type: "cancel", ...attempt });
  const result = await relay.frame(0, message => message.event?.code === "outcome_unknown", "cancellation outcome");
  assert.equal(result.event.type, "failed");
  assert.ok(!relay.frames.some(frame => frame.message.event?.type === "cancelled"));
});

test("startup settles an interrupted journal entry as unknown instead of relaunching it", { timeout: 10_000 }, async t => {
  const startTurn = t.mock.fn();
  const relay = await startFixture(t, { startTurn }, journal => {
    assert.ok(journal.claim(attempt));
    journal.append(attempt, { type: "activity", message: "Awaiting prior provider" });
    journal.acknowledge(attempt, 1);
  });

  const recovered = await relay.frame(0, message => message.event?.code === "outcome_unknown", "recovery outcome");
  assert.equal(recovered.seq, 2);
  assert.ok(isDeviceMessage(recovered));
  assert.ok(!relay.frames.some(frame => frame.message.event?.type === "activity"));

  relay.connections[0].receive(fixture.dispatch);
  relay.connections[0].disconnect();
  const replay = await relay.frame(1, message => message.event?.code === "outcome_unknown", "unknown outcome replay");
  assert.deepEqual(replay, recovered);
  assert.equal(startTurn.mock.callCount(), 0);
});
