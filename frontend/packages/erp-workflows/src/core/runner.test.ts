import assert from "node:assert/strict"
import test from "node:test"

import { createFakeCompletionPorts } from "../testing"
import { WorkflowError } from "./errors"
import { createTransitionRunner } from "./runner"
import type { TransitionSpec } from "./transition"

function flaky(failures: Array<() => Error>) {
  let calls = 0
  const spec: TransitionSpec<string> = {
    id: "test.flaky",
    affects: ["sale-orders"],
    command: async () => {
      const next = failures[calls++]
      if (next) throw next()
    },
  }
  return { spec, calls: () => calls }
}

test("a transport failure offers a retry that re-runs the same transition as the next attempt", async () => {
  const { spec, calls } = flaky([() => new WorkflowError("retryable_transport", "unavailable", { status: 503 })])
  const fake = createFakeCompletionPorts()
  const runner = createTransitionRunner(fake.ports)

  await assert.rejects(runner.run("test.flaky:1", spec, "1"))
  const failure = fake.notices[0]
  assert.equal(failure?.kind, "error")
  assert.ok(failure?.retry, "retry is offered")

  const result = await failure!.retry!()
  assert.equal(result.outcome, "applied")
  assert.equal(calls(), 2)
  assert.deepEqual(fake.events.map((e) => [e.status, e.attempt]), [
    ["failed", 1],
    ["applied", 2],
  ])
  assert.notEqual(fake.events[0]?.correlationId, fake.events[1]?.correlationId)
})

test("an unknown outcome is never offered a retry, since re-issuing could duplicate the write", async () => {
  const { spec } = flaky([() => new TypeError("Failed to fetch")])
  const fake = createFakeCompletionPorts()
  const runner = createTransitionRunner(fake.ports)
  await assert.rejects(runner.run("test.flaky:1", spec, "1"))
  assert.equal(fake.notices[0]?.error?.kind, "outcome_unknown")
  assert.equal(fake.notices[0]?.retry, undefined)
})

test("an idempotent command that lost its response can be retried", async () => {
  const { spec } = flaky([() => new TypeError("Failed to fetch")])
  const fake = createFakeCompletionPorts()
  const runner = createTransitionRunner(fake.ports)
  await assert.rejects(runner.run("test.flaky:1", { ...spec, idempotent: true }, "1"))
  assert.equal(fake.notices[0]?.error?.kind, "retryable_transport")
  assert.ok(fake.notices[0]?.retry)
})

test("validation, permission and conflict failures are not retryable", async () => {
  for (const kind of ["validation", "permission_denied", "conflict", "stale_revision"] as const) {
    const { spec } = flaky([() => new WorkflowError(kind, "no")])
    const fake = createFakeCompletionPorts()
    await assert.rejects(createTransitionRunner(fake.ports).run("k", spec, "1"))
    assert.equal(fake.notices[0]?.retry, undefined, kind)
  }
})

test("every logged event carries the run key, and a double click issues one write", async () => {
  let calls = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (release = resolve))
  const spec: TransitionSpec<string> = {
    id: "test.slow",
    affects: ["sale-orders"],
    command: async () => {
      calls++
      await gate
    },
  }
  const fake = createFakeCompletionPorts()
  const runner = createTransitionRunner(fake.ports)
  const first = runner.run("test.slow:9", spec, "9")
  const second = runner.run("test.slow:9", spec, "9")
  assert.ok(runner.isRunning("test.slow:9"))
  release()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(fake.events.length, 1)
  assert.equal(fake.events[0]?.runKey, "test.slow:9")
})

test("pending hooks bracket every run, including failures", async () => {
  const seen: string[] = []
  const { spec } = flaky([() => new WorkflowError("validation", "no")])
  const runner = createTransitionRunner(createFakeCompletionPorts().ports, {
    onStart: () => void seen.push("start"),
    onSettle: () => void seen.push("settle"),
  })
  await assert.rejects(runner.run("k", spec, "1"))
  assert.deepEqual(seen, ["start", "settle"])
})
