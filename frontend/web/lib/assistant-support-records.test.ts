import assert from "node:assert/strict"
import { test } from "node:test"
import { parseAssistantSupportRecord, readAssistantSupportRecord } from "./assistant-support-records"

const scope = { organizationId: 42, companyId: 7, actorIdentity: "actor", locale: "en-GB" }
const event = { kind: "calendar_event", id: "18" } as const
const approval = { kind: "workflow_human_task", id: "9007199254740994" } as const
const document = { kind: "document", id: "9007199254740995" } as const

test("recognizes exact read questions without intercepting navigation or mutations", () => {
  assert.deepEqual(parseAssistantSupportRecord("When does calendar event #18 start?"), event)
  assert.deepEqual(parseAssistantSupportRecord("What is the status of approval request #9007199254740994?"), approval)
  assert.deepEqual(parseAssistantSupportRecord("Show me document metadata #9007199254740995."), document)
  for (const query of [
    "Open calendar event #18", "Cancel calendar event #18", "Approve approval request #12",
    "Read calendar event #18 then cancel it", "Read document #18446744073709551616", "Read document #0",
  ]) {
    assert.equal(parseAssistantSupportRecord(query), undefined)
  }
})

test("reads a single public Calendar event through the scoped owner and links to its native details", async () => {
  const reply = await readAssistantSupportRecord(event, scope, async (path, options) => {
    assert.equal(path, "/api/authoritative/calendar-events/18?companyId=7")
    assert.equal(options?.cache, "no-store")
    return Response.json({ data: { id: 18, organizationId: 42, privacy: "public", name: "[Venue](https://invalid.example)",
      start: "2026-11-17T09:00:00Z", stop: "2026-11-17T10:00:00Z", partnerIds: [987], state: "confirmed" } })
  })
  assert.match(reply.content, /Starts \(UTC\):.*09:00/)
  assert.match(reply.content, /Ends \(UTC\):.*10:00/)
  assert.doesNotMatch(reply.content, /\[Venue\]\(https|987/)
  assert.equal(reply.sources[0]?.href, "/calendar/events/18")
  assert.equal(reply.sources[0]?.entity_id, "18")
})

test("uses the native actor-scoped approval detail and exposes only selected status metadata", async () => {
  const authorized = {
    id: approval.id, organizationId: scope.organizationId, companyId: scope.companyId, workModule: "purchasing",
    workAssignedToMe: false, workActions: [], workTeamRefs: [], workSourceTitle: "Office supplies", status: { tag: "Open" },
    decisionComment: "Internal comment",
  }
  const reply = await readAssistantSupportRecord(approval, scope, async path => {
    assert.equal(path, "/api/query/workflow-human-tasks?companyId=7&workScope=finance&workView=eligible&limit=1&taskId=9007199254740994")
    return Response.json({ data: [authorized], nextCursor: null, complete: true })
  })
  assert.match(reply.content, /Office supplies/)
  assert.match(reply.content, /Status: Open/)
  assert.doesNotMatch(reply.content, /Internal comment/)
  assert.equal(reply.sources[0]?.href, "/approvals?taskId=9007199254740994&taskCompany=7")
  for (const payload of [
    { data: [authorized, authorized], nextCursor: null },
    { data: [{ ...authorized, companyId: 8 }], nextCursor: null },
    { data: [{ ...authorized, id: "18" }], nextCursor: null },
    { data: [authorized], nextCursor: "21" },
    { data: [authorized], nextCursor: null, complete: false },
  ]) {
    assert.deepEqual((await readAssistantSupportRecord(approval, scope, async () => Response.json(payload))).sources, [])
  }
})

test("reads only exact authorized document metadata, including explicitly shared rows", async () => {
  const record = {
    id: document.id, organizationId: "42", companyId: { none: [] }, name: "Reconciliation checklist",
    file_name: "reconciliation.txt", mimetype: "text/plain", fileSize: 512, url: "https://example.org/opaque", checksum: "private",
  }
  const reply = await readAssistantSupportRecord(document, scope, async path => {
    assert.equal(path, "/api/authoritative/documents/9007199254740995?companyId=7")
    return Response.json({ data: record })
  })
  assert.match(reply.content, /Reconciliation checklist/)
  assert.match(reply.content, /512 bytes/)
  assert.doesNotMatch(reply.content, /opaque|private|checksum/)
  assert.equal(reply.sources[0]?.href, "/documents/9007199254740995")
  for (const data of [
    { ...record, companyId: 8 }, { ...record, companyId: undefined }, { ...record, organizationId: 99 }, { ...record, id: "18" },
  ]) {
    assert.deepEqual((await readAssistantSupportRecord(document, scope, async () => Response.json({ data }))).sources, [])
  }
})

test("denials, private calendar rows and cancelled turns produce no sources", async () => {
  assert.deepEqual((await readAssistantSupportRecord(approval, scope, async () => new Response(null, { status: 403 }))).sources, [])
  assert.deepEqual((await readAssistantSupportRecord(event, scope, async () => Response.json({
    data: { id: event.id, organizationId: scope.organizationId, privacy: "private", name: "Private event" },
  }))).sources, [])
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(readAssistantSupportRecord(event, { ...scope, signal: controller.signal },
    async () => { throw new Error("unexpected request") }), { name: "AbortError" })
})
