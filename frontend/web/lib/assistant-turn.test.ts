import assert from "node:assert/strict"
import test from "node:test"
import { HttpResponseError } from "@lumiere/api-client/response-error"
import { assistantAnswer, assistantAnswerMetadata, coordinateAssistantTurn, readAssistantStream, turnFailure } from "./assistant-turn"

const metadata = (raw: string): { sources: string[]; run_id: number } => {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed.sources)) throw new Error("invalid metadata")
  return parsed
}
const sse = (text: string, crlf = false) => new Response(crlf ? text.replaceAll("\n", "\r\n") : text, { headers: { "content-type": "text/event-stream" } })
const complete = 'event: delta\ndata: Admitted answer\n\nevent: sources\ndata: {"sources":["source"],"run_id":7}\n\nevent: done\ndata: {}\n\n'

test("a failed stream never retries either dispatch and retains prepared drafts", async () => {
  let answers = 0, drafts = 0
  const result = await coordinateAssistantTurn({
    answer: async () => { answers++; return readAssistantStream(new Response("unavailable", { status: 503 }), metadata) },
    drafts: async () => { drafts++; return [42] }, isCurrent: () => true,
  })
  assert.deepEqual(result, { answer: { kind: "unavailable" }, drafts: { kind: "ready", value: [42] } })
  assert.equal(answers, 1); assert.equal(drafts, 1)
})

test("failed draft preparation is explicit without hiding an admitted answer", async () => {
  const result = await coordinateAssistantTurn({ answer: async () => "Answer", drafts: async () => { throw new HttpResponseError(403, "private internal detail") }, isCurrent: () => true })
  assert.deepEqual(result, { answer: { kind: "ready", value: "Answer" }, drafts: { kind: "denied" } })
})

test("a lost draft save reply is uncertain and never redispatched", async () => {
  let attempts = 0
  const result = await coordinateAssistantTurn({ answer: async () => "Answer", drafts: async () => { attempts++; throw new TypeError("network lost after write") }, isCurrent: () => true })
  assert.deepEqual(result, { answer: { kind: "ready", value: "Answer" }, drafts: { kind: "outcome_unknown" } })
  assert.equal(attempts, 1)
})

test("scope changes suppress both late results", async () => {
  let current = true
  assert.deepEqual(await coordinateAssistantTurn({ answer: async () => { current = false; return "private" }, drafts: async () => [1], isCurrent: () => current }), { kind: "scope_changed" })
  let calls = 0
  await coordinateAssistantTurn({ answer: async () => { calls++; return "private" }, isCurrent: () => false })
  assert.equal(calls, 0)
})

test("no draft intent does not dispatch a draft request", async () => {
  assert.deepEqual(await coordinateAssistantTurn({ answer: async () => "Answer", isCurrent: () => true }), { answer: { kind: "ready", value: "Answer" }, drafts: { kind: "not_requested" } })
})

test("the admitted SSE answer, sources and run identity require a terminal done event", async () => {
  for (const crlf of [false, true]) assert.deepEqual(await readAssistantStream(sse(complete, crlf), metadata), { answer: "Admitted answer", sources: ["source"], run_id: 7 })
})

test("truncated, failed and malformed streams never become completed answers", async () => {
  for (const text of [complete.replace(/event: done[\s\S]*/, ""), 'event: done\ndata: {}\n\n', complete.replace('event: done', 'event: error'), complete.replace('{"sources":["source"],"run_id":7}', 'not json')]) {
    await assert.rejects(readAssistantStream(sse(text), metadata))
  }
  await assert.rejects(readAssistantStream(new Response("not a stream"), metadata))
})

test("chunk boundaries, multiline data and UTF-8 are reconstructed before completion", async () => {
  const bytes = new TextEncoder().encode(complete.replace("Admitted answer", "Approved: café\ndata: line two"))
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } })
  const result = await readAssistantStream(new Response(body, { headers: { "content-type": "text/event-stream" } }), metadata)
  assert.equal(result.answer, "Approved: café\nline two")
})

test("malformed JSON and SSE source envelopes retain independently prepared drafts", async () => {
  for (const sources of [[null], [{ text_snippet: null }], [{kind: "live", trust: "authoritative", text_snippet: "text", label: { private: true }}]]) {
    for (const stream of [false, true]) {
      const result = await coordinateAssistantTurn({
        answer: async () => stream
          ? readAssistantStream(sse(complete.replace('{"sources":["source"],"run_id":7}', JSON.stringify({ sources, run_id: 7 }))), raw => assistantAnswerMetadata(JSON.parse(raw)))
          : assistantAnswer({ answer: "Answer", sources }),
        drafts: async () => [42], isCurrent: () => true,
      })
      assert.deepEqual(result, { answer: { kind: "outcome_unknown" }, drafts: { kind: "ready", value: [42] } })
    }
  }
})

test("an HTTP request timeout cannot establish a rejected or safe-to-retry outcome", () => {
  assert.equal(turnFailure(new HttpResponseError(408, "request timed out")), "outcome_unknown")
  assert.equal(turnFailure(new HttpResponseError(504, "gateway timed out")), "outcome_unknown")
})

test("JSON and completed SSE preserve exact related-guide identities without document bodies", async () => {
  const raw = { answer: "Related guide", sources: [], related_guides: [{ guideId: "9007199254740993", revision: 2, title: "Saved help", module: "accounting", companyId: "7", markdown: "Not persisted chat evidence" }] }
  const expected = [{ guideId: "9007199254740993", revision: 2, title: "Saved help", module: "accounting" }]
  assert.deepEqual(assistantAnswer(raw).guides, expected)
  const reply = await readAssistantStream(sse(complete.replace('{"sources":["source"],"run_id":7}', JSON.stringify(raw))), data => assistantAnswerMetadata(JSON.parse(data)))
  assert.deepEqual(reply.guides, expected)
})

test("malformed related-guide metadata cannot hide an independently prepared draft", async () => {
  for (const related_guides of [[null], [{ guideId: 9007199254740992, revision: 1 }], [{ guideId: "7", revision: 0 }], [{ guideId: "7", revision: 1, title: {} }]]) {
    const result = await coordinateAssistantTurn({ answer: async () => assistantAnswer({ answer: "Answer", sources: [], related_guides }), drafts: async () => [42], isCurrent: () => true })
    assert.deepEqual(result, { answer: { kind: "outcome_unknown" }, drafts: { kind: "ready", value: [42] } })
  }
})

test("JSON and completed SSE preserve validated native proposals without model authority", async () => {
  const ui_actions = [{ capability_key: "sales.order.open", record_id: "9007199254740993" }, { capability_key: "accounting.invoice.create" }]
  const raw = { answer: "Review the order or prepare an invoice.", sources: [], ui_actions }
  assert.deepEqual(assistantAnswer(raw).ui_actions, ui_actions)
  const reply = await readAssistantStream(sse(complete.replace('{"sources":["source"],"run_id":7}', JSON.stringify(raw))), data => assistantAnswerMetadata(JSON.parse(data)))
  assert.deepEqual(reply.ui_actions, ui_actions)
  assert.equal(reply.ui_actions?.[0]?.record_id, "9007199254740993")
})

test("invalid optional UI proposals cannot hide a verified answer or grant execution", () => {
  for (const ui_actions of [[null], [{ capability_key: "call_reducer", params: {} }], [{ capability_key: "sales.order.open", record_id: 9007199254740992 }], [{ capability_key: "accounting.invoice.create", href: "/projects" }]]) {
    const reply = assistantAnswer({ answer: "Admitted answer", sources: [], ui_actions })
    assert.equal(reply.answer, "Admitted answer")
    assert.deepEqual(reply.ui_actions, [])
  }
})
