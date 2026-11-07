import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import {
  chatImportScopeKey, listChatImportTasks, parseChatImportTask, readChatImportPointer,
  recoverChatImportPointer, submitChatImportFiles, submitChatImportDecision, recoverChatImportDecision,
  retryChatImportDecision, readChatImportDecisionPointer, type ChatImportScope, type ChatImportTask,
  parseSavedImportTask, readSavedImportTask, listSavedImportTasks,
} from "./chat-import-task"
import type { ImportPreparation } from "./import-preparation"

const scope: ChatImportScope = { identity: "actor", organizationId: 7, companyId: 3, conversationKey: "conversation" }
const id = "a".repeat(32)
const content = "name,sale_price,cost_price\nEggs,600,400\n"
const source = { fileName: "farm.csv", size: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") }
const file = () => new File([content], source.fileName, { type: "text/csv" })
function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
function task(overrides: Partial<ChatImportTask> = {}): ChatImportTask {
  return { requestId: id, companyId: "3", conversationKey: "conversation", status: "awaiting_decision", warnings: [], error: null, createdAt: "2026-11-01T12:00:00Z",
    decision: { id: `${id}:purpose`, revision: 1, status: "pending", question: "What should I do with these files?", allowOther: true,
      options: [{ id: "prepare_import", label: "Prepare an import" }, { id: "inspect_only", label: "Inspect only" }], selectedOptionId: null, otherText: null, decisionId: null },
    decisionReceipt: null, decisionHistory: [], files: [{ ordinal: 0, ...source }], reviews: [], ...overrides }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

test("saved tasks reopen outside their original conversation without crossing company scope", async () => {
  const original = task({ conversationKey: "earlier-conversation" })
  assert.equal(parseSavedImportTask(original, 3).conversationKey, "earlier-conversation")
  assert.throws(() => parseChatImportTask(original, scope), /conversation/)
  assert.throws(() => parseSavedImportTask(original, 4), /company/)
  const saved = await readSavedImportTask(async () => json(original), 3, id)
  assert.equal(saved?.requestId, id)
  await assert.rejects(readSavedImportTask(async () => json(original), 4, id), /company/)
})

test("saved task pagination omits conversation and keeps the opaque cursor", async () => {
  const page = await listSavedImportTasks(async url => {
    const parsed = new URL(url, "https://app.example")
    assert.equal(parsed.searchParams.get("companyId"), "3")
    assert.equal(parsed.searchParams.has("conversationKey"), false)
    assert.equal(parsed.searchParams.get("cursor"), "opaque+/=")
    return json({ tasks: [task({ conversationKey: "earlier" })], nextCursor: "next-cursor" })
  }, 3, "opaque+/=")
  assert.equal(page.nextCursor, "next-cursor")
  assert.equal(page.tasks[0]?.conversationKey, "earlier")
})

test("preparation options bind exact upload recovery and cannot change an uncertain request", async () => {
  const preparation: ImportPreparation = { version: 1, files: [{ fileName: source.fileName, sourceSha256: source.sha256, decimalSeparator: ",", groupingSeparator: "." }] }
  const retained = storage()
  let firstBody = ""
  const args = { files: [file()], scope, storage: retained, isCurrent: () => true, preparation, createRequestId: () => id }
  await assert.rejects(submitChatImportFiles({ ...args, fetcher: async (_, init) => {
    if (init?.method === "POST") { firstBody = String(init.body); throw new Error("lost after acceptance") }
    return new Response(null, { status: 404 })
  } }), /uncertain/)
  assert.match(readChatImportPointer(retained, scope)?.preparationSha256 ?? "", /^[a-f0-9]{64}$/)
  for (const changed of [undefined, { version: 1 as const, files: [] }]) {
    await assert.rejects(submitChatImportFiles({ ...args, preparation: changed, fetcher: async () => { throw new Error("must not dispatch changed options") } }), /same rules/)
  }
  const restored = await submitChatImportFiles({ ...args, createRequestId: () => { throw new Error("must reuse the exact request") }, fetcher: async (_, init) => {
    assert.equal(String(init?.body), firstBody)
    return json(task({ preparation }))
  } })
  assert.deepEqual(restored.preparation, preparation)
  assert.equal(retained.values.size, 0)
})

test("distinct preparation starts a different request and wrong option readback retains its receipt", async () => {
  const preparation: ImportPreparation = { version: 1, files: [] }
  const retained = storage()
  await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: retained, isCurrent: () => true, preparation, knownTasks: [task()], createRequestId: () => "b".repeat(32),
    fetcher: async (url, init) => {
      assert.equal(init?.method, "POST")
      assert.equal(url, "/api/import-tasks")
      const changed = task({ requestId: "b".repeat(32) })
      changed.decision.id = changed.requestId + ":purpose"
      return json(changed)
    } }), /does not match/)
  assert.equal(readChatImportPointer(retained, scope)?.requestId, "b".repeat(32))
})

test("file-only submission saves one immutable request and clears only its verified receipt", async () => {
  const saved = storage()
  let posts = 0
  const result = await submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
    fetcher: async (url, init) => {
      assert.equal(url, "/api/import-tasks")
      assert.equal(init?.method, "POST")
      posts++
      assert.deepEqual(readChatImportPointer(saved, scope), { requestId: id, files: [source] })
      const body = JSON.parse(String(init?.body))
      assert.equal(body.companyId, 3)
      assert.equal(body.requestId, id)
      assert.equal(body.conversationKey, "conversation")
      assert.equal(Buffer.from(body.files[0].contentBase64, "base64").toString(), content)
      return json(task())
    } })
  assert.equal(posts, 1)
  assert.equal(result.status, "awaiting_decision")
  assert.equal(result.decision.status, "pending")
  assert.equal(result.reviews.length, 0, "saving files does not prepare data before the user answers")
  assert.equal(saved.values.size, 0)
})

test("lost POST response checks the exact accepted task without redispatch", async () => {
  const saved = storage()
  const requests: string[] = []
  const result = await submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
    fetcher: async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`)
      if (init?.method === "POST") throw new Error("Connection closed after acceptance")
      return json(task())
    } })
  assert.equal(result.requestId, id)
  assert.deepEqual(requests, ["POST /api/import-tasks", `GET /api/import-tasks/${id}?companyId=3`])
  assert.equal(saved.values.size, 0)
})

test("refresh reads a retained exact receipt, while unknown outcomes retry the same request bytes", async () => {
  const saved = storage()
  let originalBody = ""
  await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
    fetcher: async (_, init) => {
      if (init?.method === "POST") { originalBody = String(init.body); throw new Error("lost") }
      return new Response(null, { status: 404 })
    } }), /uncertain/)
  assert.ok(readChatImportPointer(saved, scope))
  let reads = 0
  const recovered = await recoverChatImportPointer({ scope, storage: saved, isCurrent: () => true, fetcher: async (_, init) => { assert.equal(init?.method, undefined); reads++; return new Response(null, { status: 404 }) } })
  assert.equal(reads, 1)
  assert.equal(recovered.pointer?.requestId, id)
  await submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => { throw new Error("A retry must not generate another identity") },
    fetcher: async (_, init) => { assert.equal(String(init?.body), originalBody); return json(task()) } })
  assert.equal(saved.values.size, 0)
})

test("a repeated drop reauthorizes matching durable sources and does not upload them again", async () => {
  const requests: string[] = []
  const result = await submitChatImportFiles({ files: [file()], scope, storage: storage(), isCurrent: () => true, knownTasks: [task()],
    fetcher: async (url, init) => { requests.push(url); assert.notEqual(init?.method, "POST"); return json(task()) } })
  assert.equal(result.requestId, id)
  assert.deepEqual(requests, [`/api/import-tasks/${id}?companyId=3`])
})

test("definitive input rejection retires only an absent request so another selection can be uploaded", async () => {
  for (const status of [400, 413, 415, 422]) {
    const saved = storage()
    const calls: string[] = []
    await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
      fetcher: async (url, init) => { calls.push(url); return init?.method === "POST" ? json({ error: "Choose a smaller supported file." }, status) : new Response(null, { status: 404 }) } }), /smaller supported file/)
    assert.equal(saved.values.size, 0)
    assert.equal(calls.length, 2)
  }
  const saved = storage()
  const accepted = await submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
    fetcher: async (_, init) => init?.method === "POST" ? json({ error: "Rejected by proxy" }, 413) : json(task()) })
  assert.equal(accepted.requestId, id, "an accepted receipt takes precedence over a rejection response")
})

test("wrong source receipts and late scope changes retain request identity", async () => {
  const saved = storage()
  await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => true, createRequestId: () => id,
    fetcher: async () => json(task({ files: [{ ...source, ordinal: 0, sha256: "b".repeat(64) }] })) }), /original files/)
  assert.equal(readChatImportPointer(saved, scope)?.requestId, id)
  let current = true
  let reads = 0
  await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: saved, isCurrent: () => current,
    fetcher: async () => { reads++; current = false; return json(task()) } }), /company or conversation changed/)
  assert.equal(reads, 1, "never perform an old-scope recovery read after a scope change")
  assert.ok(readChatImportPointer(saved, scope))
})

test("changed files cannot replace an uncertain request, and local-storage failure stops dispatch", async () => {
  const saved = storage()
  saved.setItem(chatImportScopeKey(scope), JSON.stringify({ requestId: id, files: [source] }))
  let calls = 0
  await assert.rejects(submitChatImportFiles({ files: [new File(["other data"], source.fileName)], scope, storage: saved, isCurrent: () => true,
    fetcher: async () => { calls++; return json(task()) } }), /previous submission/)
  await assert.rejects(submitChatImportFiles({ files: [file()], scope, storage: { ...storage(), setItem: () => { throw new Error("storage full") } }, isCurrent: () => true,
    fetcher: async () => { calls++; return json(task()) } }), /storage full/)
  assert.equal(calls, 0)
})

test("scope checks reject leaked tasks and keep actor/company/conversation receipt pointers separate", async () => {
  for (const different of [{ ...scope, identity: "other" }, { ...scope, organizationId: 8 }, { ...scope, companyId: 4 }, { ...scope, conversationKey: "other" }]) {
    assert.notEqual(chatImportScopeKey(different), chatImportScopeKey(scope))
  }
  assert.throws(() => parseChatImportTask(task({ companyId: "4" }), scope), /does not match/)
  assert.throws(() => parseChatImportTask(task({ conversationKey: "other" }), scope), /does not match/)
  assert.throws(() => parseChatImportTask(task({ files: [{ ...source, ordinal: 1 }] }), scope), /does not match/)
  await assert.rejects(listChatImportTasks(async () => json({ tasks: [task({ companyId: "4" })] }), scope), /does not match/)
  await assert.rejects(listChatImportTasks(async () => new Response(null, { status: 403 }), scope), /administrator/)
})

test("invalid file formats and bounds never invoke the server", async () => {
  for (const files of [[], [new File([""], "empty.csv")], [new File([content], "data.pdf")],
    [new File([content], `${"中".repeat(100)}.csv`)], [new File([content], "folder/data.csv")], [new File([content], "bad\u0085.csv")],
    Array.from({ length: 21 }, file)]) {
    let calls = 0
    await assert.rejects(submitChatImportFiles({ files, scope, storage: storage(), isCurrent: () => true, fetcher: async () => { calls++; return json(task()) } }), /Choose up to 20/)
    assert.equal(calls, 0)
  }
})

const decisionId = "d".repeat(32)
const answer = { requestId: `${id}:purpose`, expectedRevision: 1, optionId: "prepare_import" as const }
function acknowledged(optionId: "prepare_import" | "inspect_only" | "other" = "prepare_import", otherText: string | null = null): ChatImportTask {
  const original = task()
  const receipt = { decisionId, optionId, otherText, revision: 2, createdAt: "2026-11-01T12:01:00Z" }
  return task({ status: optionId === "other" ? "awaiting_decision" : optionId === "inspect_only" ? "inspection_ready" : "needs_review",
    decision: { ...original.decision, revision: 2, status: optionId === "other" ? "pending" : "approved", selectedOptionId: optionId, otherText, decisionId },
    decisionReceipt: receipt, decisionHistory: [receipt] })
}

test("an explicit decision binds its answer and question revision to one approval identity", async () => {
  const saved = storage()
  let posts = 0
  const result = await submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (url, init) => {
      assert.equal(url, `/api/import-tasks/${id}/decision`)
      assert.equal(init?.method, "POST")
      posts++
      assert.equal(readChatImportDecisionPointer(saved, scope, id)?.decisionId, decisionId)
      assert.deepEqual(JSON.parse(String(init?.body)), { companyId: 3, decisionId, expectedRevision: 1, optionId: "prepare_import" })
      return json(acknowledged())
    } })
  assert.equal(posts, 1)
  assert.equal(result.status, "needs_review")
  assert.equal(saved.values.size, 0)
})

test("lost decision response reads its exact receipt and never creates another approval", async () => {
  const saved = storage(), requests: string[] = []
  const result = await submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (url, init) => { requests.push(`${init?.method ?? "GET"} ${url}`); if (init?.method === "POST") throw new Error("lost accepted approval reply"); return json(acknowledged()) } })
  assert.equal(result.decision.decisionId, decisionId)
  assert.deepEqual(requests, [`POST /api/import-tasks/${id}/decision`, `GET /api/import-tasks/${id}?companyId=3&decisionId=${decisionId}`])
  assert.equal(saved.values.size, 0)
})

test("unknown approval survives refresh and retries the identical saved answer", async () => {
  const saved = storage()
  let body = "", posts = 0
  await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (_, init) => { if (init?.method === "POST") { posts++; body = String(init.body); throw new Error("lost") }; return new Response(null, { status: 404 }) } }), /uncertain/)
  const restored = await recoverChatImportDecision({ task: task(), scope, storage: saved, isCurrent: () => true,
    fetcher: async (_, init) => { assert.notEqual(init?.method, "POST"); return new Response(null, { status: 404 }) } })
  assert.equal(restored.pointer?.decisionId, decisionId)
  await assert.rejects(submitChatImportDecision({ task: task(), answer: { ...answer, optionId: "inspect_only" }, scope, storage: saved, isCurrent: () => true,
    fetcher: async () => { throw new Error("changed answer must not dispatch") } }), /previous decision receipt/)
  const result = await retryChatImportDecision({ taskRequestId: id, scope, storage: saved, isCurrent: () => true,
    fetcher: async (_, init) => { posts++; assert.equal(String(init?.body), body); return json(acknowledged()) } })
  assert.equal(posts, 2)
  assert.equal(result.decision.decisionId, decisionId)
  assert.equal(saved.values.size, 0)
})

test("Other saves a clarification and leaves processing paused with a new question revision", async () => {
  const saved = storage(), instructions = "中".repeat(1000)
  const result = await submitChatImportDecision({ task: task(), answer: { ...answer, optionId: "other", otherText: ` ${instructions} ` }, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (_, init) => { assert.equal(JSON.parse(String(init?.body)).otherText, instructions); return json(acknowledged("other", instructions)) } })
  assert.equal(result.status, "awaiting_decision")
  assert.equal(result.decision.status, "pending")
  assert.equal(result.decision.revision, 2)
  assert.equal(result.decision.otherText, instructions)
  assert.equal(result.reviews.length, 0)
})

test("a rejected stale question retires only an absent approval receipt", async () => {
  const saved = storage()
  await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (_, init) => init?.method === "POST" ? json({ error: "The question revision changed." }, 409) : new Response(null, { status: 404 }) }), /revision changed/)
  assert.equal(saved.values.size, 0)
})

test("decision receipts cannot change the answer, scope or expected revision", async () => {
  for (const bad of [acknowledged("inspect_only"), acknowledged("other", "Different instructions"), { ...acknowledged(), decisionReceipt: { ...acknowledged().decisionReceipt!, revision: 3 } }]) {
    const saved = storage()
    await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
      fetcher: async () => json(bad) }), /does not match/)
    assert.equal(readChatImportDecisionPointer(saved, scope, id)?.decisionId, decisionId)
  }
  let current = true, calls = 0
  await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: storage(), isCurrent: () => current, createDecisionId: () => decisionId,
    fetcher: async () => { calls++; current = false; return json(acknowledged()) } }), /company or conversation changed/)
  assert.equal(calls, 1, "scope change prevents an old approval recovery read")
})

test("a refresh can acknowledge an older exact answer after the current question has advanced", async () => {
  const saved = storage()
  await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: saved, isCurrent: () => true, createDecisionId: () => decisionId,
    fetcher: async (_, init) => { if (init?.method === "POST") throw new Error("lost"); return new Response(null, { status: 404 }) } }))
  const later = acknowledged()
  later.decision.revision = 3
  later.decision.decisionId = "e".repeat(32)
  const result = await recoverChatImportDecision({ task: later, scope, storage: saved, isCurrent: () => true, fetcher: async () => json(later) })
  assert.equal(result.pointer, null)
  assert.equal(result.task.decision.revision, 3)
  assert.equal(result.task.decisionReceipt?.decisionId, decisionId)
})

test("invalid decisions and unavailable receipt storage stop before dispatch", async () => {
  let calls = 0
  for (const invalid of [{ ...answer, expectedRevision: 2 }, { ...answer, optionId: "other" as const, otherText: " " }, { ...answer, optionId: "other" as const, otherText: "a".repeat(2001) }, { ...answer, otherText: "unapproved custom action" }]) {
    await assert.rejects(submitChatImportDecision({ task: task(), answer: invalid, scope, storage: storage(), isCurrent: () => true,
      fetcher: async () => { calls++; return json(acknowledged()) } }))
  }
  await assert.rejects(submitChatImportDecision({ task: task(), answer, scope, storage: { ...storage(), setItem: () => { throw new Error("storage unavailable") } }, isCurrent: () => true,
    fetcher: async () => { calls++; return json(acknowledged()) } }), /storage unavailable/)
  assert.equal(calls, 0)
  assert.throws(() => parseChatImportTask(task({ reviews: [{ id: "8", targetEntity: "product", title: "Unapproved", total: 1, pending: 1, confirmed: 0, excluded: 0 }] }), scope), /decision is inconsistent/)
})
