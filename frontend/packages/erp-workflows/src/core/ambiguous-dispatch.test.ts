import assert from "node:assert/strict"
import test from "node:test"
import { createFakeCompletionPorts } from "../testing"
import { WorkflowError, workflowErrorFromResponse } from "./errors"
import { recordRef } from "./record-ref"
import { mergeWorkflowResults } from "./result"
import { createTransitionRunner } from "./runner"
import type { ObservedTransition, TransitionSpec } from "./transition"

const transportFailures = [
  new TypeError("response lost"),
  Object.assign(new Error("aborted"), { name: "AbortError" }),
  ...[500, 501, 502, 503, 504, 507, 599].map((status) => workflowErrorFromResponse(status, "server failed", "failed")),
]

test("a committed command with an ambiguous response exact-reads once without redispatch", async () => {
  for (const error of transportFailures) {
    for (const failInvalidate of [false, true]) {
      const fake = createFakeCompletionPorts({ failInvalidate })
      let commands = 0
      let observations = 0
      let committed = false
      const ref = recordRef("stock_picking", 17)
      const result = await createTransitionRunner(fake.ports).run("receipt:17", {
        id: "receive",
        affects: ["stock-moves"],
        command: async () => { commands++; committed = true; throw error },
        observe: async () => {
          observations++
          assert.ok(committed)
          return { outcome: "applied", next: ref }
        },
      }, undefined, { navigateToNext: true })
      assert.equal(commands, 1)
      assert.equal(observations, 1)
      assert.equal(result.outcome, "applied")
      assert.equal(result.dispatch, "ambiguous")
      assert.equal(fake.notices[0]?.retry, undefined)
      assert.equal(fake.events[0]?.dispatch, "ambiguous")
      assert.equal(fake.notices[0]?.refreshed, !failInvalidate)
      assert.deepEqual(fake.navigated, [ref])
    }
  }
})

test("missing, failed, or ambiguous readback stays unknown with no resend, even for idempotent observed commands", async () => {
  const observers: Array<(() => Promise<ObservedTransition>) | undefined> = [
    undefined, async () => ({}),
    async () => { throw new Error("query failed") },
    async () => { throw new Error("multiple exact effects") },
  ]
  for (const error of transportFailures) {
    for (const observe of observers) {
      const fake = createFakeCompletionPorts()
      let commands = 0
      const base = { id: "receive", affects: ["stock-moves"], command: async () => { commands++; throw error } }
      const spec: TransitionSpec<void> = observe
        ? { ...base, idempotent: true, observe }
        : { ...base, noReadback: "fixture legacy operation" }
      await assert.rejects(createTransitionRunner(fake.ports).run("receipt:17", spec, undefined),
        (e: unknown) => e instanceof WorkflowError && e.kind === "outcome_unknown")
      assert.equal(commands, 1)
      assert.equal(fake.notices[0]?.retry, undefined)
      assert.deepEqual(fake.navigated, [])
      assert.equal(fake.notices[0]?.kind, "error")
    }
  }
})

test("definite denied and validation failures never success-readback", async () => {
  for (const status of [400, 401, 403, 422]) {
    const fake = createFakeCompletionPorts()
    let observations = 0
    await assert.rejects(createTransitionRunner(fake.ports).run("receipt:17", {
      id: "receive", affects: ["stock-moves"],
      command: async () => { throw workflowErrorFromResponse(status, "rejected", "failed") },
      observe: async () => { observations++; return { outcome: "applied" } },
    }, undefined))
    assert.equal(observations, 0)
    assert.equal(fake.notices[0]?.kind, "error")
    assert.equal(fake.notices[0]?.retry, undefined)
  }
})

test("acknowledged dispatch cache failure cannot erase exact certainty or escape as a raw error", async () => {
  const cases: Array<{ observe?: () => Promise<ObservedTransition>; confirmed?: boolean }> = [
    {}, { observe: async () => ({}) },
    { observe: async () => { throw new Error("query failed") } },
    { observe: async () => ({ outcome: "applied" }), confirmed: true },
  ]
  for (const { observe, confirmed } of cases) {
    const fake = createFakeCompletionPorts({ failInvalidate: true })
    const base = { id: "receive", affects: ["stock-moves"], command: async () => undefined }
    const spec: TransitionSpec<void> = observe ? { ...base, observe } : { ...base, noReadback: "fixture" }
    const run = createTransitionRunner(fake.ports).run("receipt:17", spec, undefined)
    if (confirmed) {
      assert.equal((await run).outcome, "applied")
    } else {
      await assert.rejects(run, (e: unknown) => e instanceof WorkflowError && e.kind === "outcome_unknown")
      assert.equal(fake.notices[0]?.retry, undefined)
    }
    assert.equal(fake.notices[0]?.refreshed, false)
  }
})

test("explicit idempotent unobserved transport failures retain safe manual retry", async () => {
  for (const error of transportFailures) {
    const fake = createFakeCompletionPorts()
    const runner = createTransitionRunner(fake.ports)
    let commands = 0
    await assert.rejects(runner.run("safe:1", {
      id: "safe", affects: [], idempotent: true, noReadback: "explicit idempotent transport contract",
      command: async () => { commands++; if (commands === 1) throw error },
    }, undefined), (e: unknown) => e instanceof WorkflowError && e.retryable)
    assert.equal(commands, 1)
    assert.ok(fake.notices[0]?.retry)
    await fake.notices[0]!.retry!()
    assert.equal(commands, 2)
  }
})

test("merged results retain ambiguous dispatch conservatively", () => {
  assert.equal(mergeWorkflowResults([
    { outcome: "applied", dispatch: "ambiguous", affectedResources: [] },
    { outcome: "applied", dispatch: "acknowledged", affectedResources: [] },
  ]).dispatch, "ambiguous")
  assert.equal(mergeWorkflowResults([{ outcome: "applied", affectedResources: [] }]).dispatch, undefined)
})

test("single flight still collapses concurrent ambiguous dispatch reconciliation", async () => {
  const fake = createFakeCompletionPorts()
  const runner = createTransitionRunner(fake.ports)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let commands = 0
  let observations = 0
  const spec: TransitionSpec<void> = {
    id: "receive", affects: ["stock-moves"],
    command: async () => { commands++; await gate; throw new TypeError("response lost") },
    observe: async () => { observations++; return { outcome: "applied" } },
  }
  const first = runner.run("receipt:17", spec, undefined)
  const second = runner.run("receipt:17", spec, undefined)
  assert.equal(first, second)
  release()
  await Promise.all([first, second])
  assert.equal(commands, 1)
  assert.equal(observations, 1)
  assert.equal(runner.isRunning("receipt:17"), false)
})
