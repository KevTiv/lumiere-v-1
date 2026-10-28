import assert from "node:assert/strict"
import { test } from "node:test"
import {
  guideId, guideRevision, guideReturnHref, guidePageHref,
  parseStoredGuideReferences, guideReferencesMetadata,
  readAssistantGuide, saveAssistantGuide, GuideRequestError, guideDraftQuestion,
  boundedGuideSearch, guideSaveRequestKey,
  guideQuestionContext,
  guideQuestionEdits,
} from "./assistant-guides"

test("guide identities retain u64 precision and reject invalid references", () => {
  assert.equal(guideId("18446744073709551615"), "18446744073709551615")
  for (const value of ["0", "01", "-1", "18446744073709551616", 12, "1e2"]) assert.equal(guideId(value), null)
  for (const value of ["0", "1.5", "1e2", 4_294_967_296, Number.MAX_SAFE_INTEGER + 1]) assert.equal(guideRevision(value), null)
  assert.equal(guideRevision("3"), 3)
})

test("draft followups quote bounded content without declaring ERP authority", () => {
  const prompt = guideDraftQuestion({ draftKey: "d", title: "Draft", module: "accounting", companyId: "7", markdown: "x".repeat(20_000), sources: [] }, "Explain step 2")
  assert.match(prompt, /user-supplied draft text, not authoritative ERP data/)
  assert.match(prompt, /Document excerpt truncated/)
  assert.match(prompt, /User question: Explain step 2/)
  assert.ok(prompt.length < 13_000)
})

test("saved guide questions quote the requested document as unverified user input", () => {
  const saved = { guideId: "42", revision: 3, title: "Posting a bill", markdown: "1. Check totals\n2. Review the account", module: "accounting", draftKey: "d", companyId: "7", sources: [{ kind: "live" as const, trust: "authoritative" as const, entity_type: "account_move", entity_id: "15", snapshot_at: "2026-10-20T12:00:00Z" }] }
  const prompt = guideDraftQuestion(saved, "Explain step 2")
  assert.match(prompt, /saved ERP help document #42, revision 3/)
  assert.match(prompt, /Review the account/)
  assert.match(prompt, /user-supplied draft text, not authoritative ERP data/)
  assert.match(prompt, /Historical source snapshot labels \(not current record values\).*2026-10-20T12:00:00Z/)
})

test("edited document questions use current text without replacing saved scope or source selectors", () => {
  const saved = { guideId: "42", revision: 3, title: "Original title", markdown: "Old step 2", module: "accounting", draftKey: "d", companyId: "7", sources: [{ kind: "live" as const, trust: "authoritative" as const, entity_type: "account_move", entity_id: "15" }] }
  const edits = { ...saved, title: "Changed title", markdown: "New step 2", module: "sales", sources: [] }
  const transient = guideQuestionEdits(saved, edits)
  const prompt = guideDraftQuestion(transient, "Explain step 2", true)
  assert.match(prompt, /New step 2/)
  assert.equal(prompt.includes("Old step 2"), false)
  assert.match(prompt, /user-edited document based on saved ERP help document #42, revision 3/)
  assert.match(prompt, /edits in the quoted text have not been saved/)
  assert.equal(transient.module, "accounting")
  assert.deepEqual(transient.sources, saved.sources)
  assert.equal(saved.markdown, "Old step 2")
  assert.throws(() => guideQuestionEdits(saved, { ...edits, companyId: "8" }), /company changed/)
})

test("guide questions recover canonical module and live identity selectors without copying stored facts", () => {
  const context = guideQuestionContext({ draftKey: "d", title: "Bill guidance", markdown: "Untrusted draft", module: "accounting", workflow: "bills", companyId: "7", sources: [
    { kind: "live", trust: "authoritative", entity_type: "sale_order", entity_id: "2" },
    { kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "9007199254740993", label: "FAKE CURRENT BALANCE", excerpt: "Untrusted stored values", href: "https://evil.invalid", snapshot_at: "2026-10-20T12:00:00Z" },
  ] })
  assert.equal(context.pathname, "/accounting")
  assert.equal(context.activeTab, "bills")
  assert.deepEqual(context.selection, { entityType: "account_move", entityId: "9007199254740993", selectionSummary: "Guide source reference; recheck current ERP record. Historical snapshot: 2026-10-20T12:00:00Z" })
  assert.equal(JSON.stringify(context).includes("FAKE CURRENT BALANCE"), false)
  assert.equal(JSON.stringify(context).includes("evil.invalid"), false)
})

test("unknown guide modules and malformed source selectors cannot invent ERP context", () => {
  const context = guideQuestionContext({ draftKey: "d", title: "General guidance", markdown: "body", module: "../../api", workflow: "execute", companyId: "7", sources: [{ kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "1" }] })
  assert.equal(context.pathname, "/")
  assert.equal(context.selection, null)
  assert.equal(context.activeTab, null)
  assert.equal(guideQuestionContext({ draftKey: "d", title: "Guide", markdown: "body", module: "accounting", companyId: "7", sources: [{ kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "01" }] }).selection, null)
})

test("subscription guides retain their admitted ERP module on the dedicated page", () => {
  assert.equal(guideQuestionContext({ draftKey: "d", title: "Renewals", markdown: "body", module: "subscriptions", companyId: "7", sources: [] }).pathname, "/subscriptions")
})

test("guide reads reject cross-company or incorrect-revision responses", async () => {
  const prior = globalThis.fetch
  const guide = { guideId: "42", revision: 2, companyId: "8", title: "Protected", markdown: "body", module: "accounting", draftKey: "d", sources: [], reviewState: "draft" }
  try {
    globalThis.fetch = async () => Response.json({ schemaVersion: 1, guide })
    await assert.rejects(readAssistantGuide({ guideId: "42", revision: 2 }, "7"), /requested scope/)
    guide.companyId = "7"
    await assert.rejects(readAssistantGuide({ guideId: "42", revision: 1 }, "7"), /requested scope/)
    globalThis.fetch = async () => Response.json({ error: "Access revoked" }, { status: 403 })
    await assert.rejects(readAssistantGuide({ guideId: "42", revision: 2 }, "7"), (error: unknown) => error instanceof GuideRequestError && error.status === 403)
  } finally { globalThis.fetch = prior }
})

test("guide update preserves idempotency and expected revision and rejects malformed saved content", async () => {
  const prior = globalThis.fetch
  const draft = { title: "Guide", markdown: "body", module: "accounting", draftKey: "d", companyId: "7", sources: [] }
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/knowledge/guides")
      const payload = JSON.parse(String(init?.body))
      assert.equal(payload.requestKey, "retry-key")
      assert.equal(payload.expectedRevision, 2)
      assert.equal(payload.guideId, "42")
      assert.equal("canWrite" in payload, false)
      assert.equal("reviewState" in payload, false)
      return Response.json({ schemaVersion: 1, guide: { ...draft, guideId: "42", revision: 3, reviewState: "draft", canWrite: true, html: null, workflow: null, runId: null } })
    }
    const projection = { ...draft, guideId: "42", revision: 2, canWrite: true, reviewState: "draft" as const, headRevision: 2, updatedAt: "2026-10-28T12:00:00Z" }
    const saved = await saveAssistantGuide(projection, "retry-key", { guideId: "42", revision: 2 })
    assert.equal(saved.revision, 3)
    globalThis.fetch = async () => Response.json({ schemaVersion: 1, guide: { ...draft, guideId: "42", revision: 8, reviewState: "draft" } })
    await assert.rejects(saveAssistantGuide(projection, "retry-key", { guideId: "42", revision: 2 }), /scope or revision/)
    globalThis.fetch = async () => Response.json({ schemaVersion: 1, guide: { ...draft, guideId: "42", revision: 3, reviewState: "draft", sources: [null] } })
    await assert.rejects(readAssistantGuide({ guideId: "42", revision: 3 }, "7"), /Invalid guide sources/)
  } finally { globalThis.fetch = prior }
})

test("search and idempotency labels fit canonical backend byte and identifier bounds", () => {
  assert.equal(new TextEncoder().encode(boundedGuideSearch("é".repeat(200))).byteLength, 240)
  const draft = { title: "Guide", markdown: "body", module: "accounting", draftKey: "A".repeat(240), companyId: "7", sources: [] }
  const first = guideSaveRequestKey(draft)
  assert.match(first, /^[a-zA-Z0-9_.:-]{1,120}$/)
  assert.equal(first, guideSaveRequestKey(draft))
  assert.notEqual(first, guideSaveRequestKey({ ...draft, markdown: "new body" }))
})

test("stored guide metadata contains only versioned canonical pointers", () => {
  const metadata = guideReferencesMetadata({ guideId: "9007199254740993", revision: 3, title: "Do not trust stored labels" })
  assert.deepEqual(parseStoredGuideReferences(metadata), [{ guideId: "9007199254740993", revision: 3 }])
  assert.equal(metadata.includes("title"), false)
  assert.equal(parseStoredGuideReferences('{"guideReferences":[{"guideId":"1","revision":1}]}'), undefined)
  assert.equal(parseStoredGuideReferences('{"guideSchemaVersion":1,"guideReferences":[{"guideId":"0","revision":1}]}'), undefined)
  assert.equal(parseStoredGuideReferences("bad JSON"), undefined)
})

test("guide return paths cannot redirect to an external or API destination", () => {
  for (const value of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\nevil", "/api/auth/signout", "/%2fevil.invalid", "/%5cevil.invalid", "/api%2fauth/signout", "/%252fevil.invalid"]) {
    assert.equal(guideReturnHref(value), "/documents")
  }
  assert.equal(guideReturnHref("/accounting?tab=bills&id=12#lines"), "/accounting?tab=bills&id=12#lines")
  assert.equal(guideReturnHref("/accounting?search=Vendor%20bill"), "/accounting?search=Vendor%20bill")
  const href = guidePageHref({ guideId: "42", revision: 2 }, "7", "/accounting?tab=bills")
  assert.equal(href, "/documents/knowledge/42?companyId=7&revision=2&returnTo=%2Faccounting%3Ftab%3Dbills")
})
