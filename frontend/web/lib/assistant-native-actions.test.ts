import assert from "node:assert/strict"
import test from "node:test"
import {
  decodeAssistantAction,
  resolveAssistantActionRequest,
  type AssistantAction,
  type AssistantActionScope,
} from "@lumiere/query-hooks/assistant-actions"
import type { ChatAction } from "@lumiere/ui/lib/ai-chat-types"
import {
  assistantPresentationReply,
  modelNativeChatActions,
  nativeChatAction,
  parseAssistantUiProposals,
  parseNativeChatActions,
  withNativeActionsMetadata,
} from "./assistant-native-actions"

const scope: AssistantActionScope = {
  actorId: "alice",
  organizationId: "7",
  companyId: "12",
}
const t = (key: string) => key
function action(text: string): AssistantAction {
  const result = resolveAssistantActionRequest(text, { scope })
  if (result.kind !== "action")
    throw new Error("Expected supported presentation request")
  return result.action
}

test("native metadata roundtrip preserves existing run, draft and guide metadata", () => {
  const native = nativeChatAction(action("Create an invoice"))
  const metadata = JSON.stringify({
    runId: 42,
    actions: [{ id: "draft-7", type: "draft", draft: { draftId: 7 } }],
    guides: [{ guideId: "8", revision: 2 }],
  })
  const saved = withNativeActionsMetadata(metadata, [native])!
  const parsed = JSON.parse(saved)
  assert.equal(parsed.runId, 42)
  assert.deepEqual(parsed.actions, JSON.parse(metadata).actions)
  assert.deepEqual(parsed.guides, JSON.parse(metadata).guides)
  assert.deepEqual(parseNativeChatActions(saved, scope), [native])
})

test("restored proposals disappear after actor, organization or company changes", () => {
  const saved = withNativeActionsMetadata(null, [
    nativeChatAction(action("Open invoice 9007199254740993")),
  ])
  for (const next of [
    { ...scope, actorId: "bob" },
    { ...scope, organizationId: "8" },
    { ...scope, companyId: "13" },
  ])
    assert.deepEqual(parseNativeChatActions(saved, next), [])
  assert.deepEqual(parseNativeChatActions(saved, null), [])
  const restored = parseNativeChatActions(saved, scope)[0]!
  assert.equal(restored.nativeAction?.recordId, "9007199254740993")
  assert.equal(
    decodeAssistantAction(restored.nativeAction, { ...scope, companyId: "13" }),
    undefined,
    "click validation must reject a stale rendered card too",
  )
})

test("stored proposals reject forged destinations, missing scope and mismatched action kinds", () => {
  const valid = action("Open invoice 42")
  for (const invalid of [
    { ...valid, href: "https://evil.example" },
    { ...valid, kind: "open_form" },
    { ...valid, capabilityKey: "projects.task.create" },
    { ...valid, scope: null },
    { ...valid, recordId: "18446744073709551616" },
  ])
    assert.deepEqual(
      parseNativeChatActions(
        JSON.stringify({ nativeActions: [invalid] }),
        scope,
      ),
      [],
    )
  for (const metadata of ["not JSON", "null", "[]", '{"nativeActions":{}}'])
    assert.deepEqual(parseNativeChatActions(metadata, scope), [])
})

test("metadata stores payload only, excluding callbacks and arbitrary chat presentation fields", () => {
  const native = nativeChatAction(action("Add a vehicle"))
  native.onClick = () => {
    throw new Error("must never be serialized or invoked")
  }
  native.content = "Unverified implementation detail"
  const saved = JSON.parse(withNativeActionsMetadata(null, [native])!)
  assert.deepEqual(Object.keys(saved), ["nativeActions"])
  assert.deepEqual(saved.nativeActions, [native.nativeAction])
  assert.equal(
    JSON.stringify(saved).includes("Unverified implementation detail"),
    false,
  )
})

test("metadata writer refuses malformed native payloads before persisting them", () => {
  const invalid = {
    id: "bad",
    type: "native",
    label: "Unsafe",
    nativeAction: {
      ...action("Create an invoice"),
      values: { amount: 9000 },
      href: "/projects",
    },
  } as unknown as ChatAction
  const metadata = '{"runId":42}'
  assert.equal(withNativeActionsMetadata(metadata, [invalid]), metadata)
})

test("duplicate native proposals yield one stable card after save and restore", () => {
  const native = nativeChatAction(action("Open invoice 42"))
  const saved = withNativeActionsMetadata(null, [native, native, native])
  assert.deepEqual(parseNativeChatActions(saved, scope), [native])
  assert.deepEqual(
    parseNativeChatActions(
      JSON.stringify({
        nativeActions: [native.nativeAction, native.nativeAction],
      }),
      scope,
    ),
    [native],
  )
})

test("presentation replies distinguish native form preparation from workflow review", () => {
  const create = assistantPresentationReply(
    resolveAssistantActionRequest("Create an invoice", { scope }),
    t,
  )!
  assert.equal(create.content, "aiChat.native.formReady")
  assert.equal(create.actions[0]?.nativeAction?.kind, "open_form")
  const review = assistantPresentationReply(
    resolveAssistantActionRequest("Post invoice 42", { scope }),
    t,
  )!
  assert.equal(review.content, "aiChat.native.workflowReady")
  assert.equal(review.actions[0]?.nativeAction?.kind, "prepare_workflow")
  assert.match(review.actions[0]!.label, /^Review /)
  const clarify = assistantPresentationReply(
    resolveAssistantActionRequest("Open order 42", { scope }),
    t,
  )!
  assert.equal(clarify.content, "aiChat.native.clarify.ambiguous_target")
  assert.deepEqual(clarify.actions, [])
  assert.equal(assistantPresentationReply({ kind: "none" }, t), undefined)
})

test("hidden task creation produces clarification without a mutation card", () => {
  for (const text of ["Create a task", "@create task for tomorrow"]) {
    const reply = assistantPresentationReply(
      resolveAssistantActionRequest(text, { scope }),
      t,
    )!
    assert.equal(reply.content, "aiChat.native.clarify.unsupported_action")
    assert.deepEqual(reply.actions, [])
  }
})

test("model proposal envelopes accept only known keys with the right exact-record shape", () => {
  const valid = {
    capability_key: "accounting.invoice.open",
    record_id: "9007199254740993",
  }
  assert.deepEqual(parseAssistantUiProposals([valid, valid]), [valid])
  const invalid = [
    { capability_key: "accounting.invoice.open" },
    {
      capability_key: "accounting.invoice.open",
      record_id: "18446744073709551616",
    },
    { capability_key: "accounting.invoice.open", record_id: 42 },
    { capability_key: "accounting.invoice.open", record_id: "-1" },
    { capability_key: "accounting.invoice.create", record_id: "42" },
    { capability_key: "accounting.navigate", record_id: "42" },
    { capability_key: "accounting.invoice.create", params: { amount: 7000 } },
    {
      capability_key: "accounting.invoice.create",
      prompt: "untrusted model prefill",
    },
    { capability_key: "accounting.invoice.create", href: "/projects" },
    { capability_key: "projects.task.create" },
    null,
    [],
  ]
  for (const proposal of invalid)
    assert.deepEqual(
      parseAssistantUiProposals([proposal]),
      [],
      JSON.stringify(proposal),
    )
  for (const payload of [null, {}, [valid, valid, valid, valid, valid, valid]])
    assert.deepEqual(parseAssistantUiProposals(payload), [])
})

test("model proposals produce presentation cards bound to captured current scope and user text only", () => {
  const cards = modelNativeChatActions(
    [
      { capability_key: "accounting.invoice.create" },
      { capability_key: "accounting.invoice.open", record_id: "42" },
      { capability_key: "accounting.invoice.review", record_id: "42" },
    ],
    scope,
    "  Help me review invoice 42  ",
  )
  assert.equal(cards.length, 3)
  assert.equal(cards[0]!.nativeAction?.prompt, "Help me review invoice 42")
  assert.equal(cards[1]!.label, "Open invoice #42")
  assert.equal(cards[1]!.nativeAction?.kind, "open_record")
  assert.equal(cards[2]!.nativeAction?.kind, "prepare_workflow")
  assert.match(cards[2]!.label, /^Review /)
  for (const card of cards) {
    assert.equal(card.type, "native")
    assert.equal(card.onClick, undefined)
    assert.equal(card.draft, undefined)
    assert.deepEqual(card.nativeAction?.scope, scope)
    assert.equal(
      decodeAssistantAction(card.nativeAction, { ...scope, actorId: "bob" }),
      undefined,
    )
  }
  assert.deepEqual(
    modelNativeChatActions(
      [{ capability_key: "accounting.invoice.create", params: {} }],
      scope,
      "Create invoice",
    ),
    [],
  )
  assert.deepEqual(
    modelNativeChatActions(
      [{ capability_key: "accounting.invoice.create" }],
      { ...scope, companyId: "0" },
      "Create invoice",
    ),
    [],
  )
  const oversized = modelNativeChatActions(
    [{ capability_key: "accounting.invoice.create" }],
    scope,
    "x".repeat(4001),
  )
  assert.equal(oversized[0]!.nativeAction?.prompt, undefined)
})

test("page proposals require the current catalog and cannot invent widget selectors or configuration", () => {
  const page = {
    moduleId: "sales",
    pageId: "dashboard",
    widgets: [{ key: "saved:9007199254740993", label: "Orders by status" }],
  }
  const proposals = [
    { capability_key: "sales.page.edit" },
    { capability_key: "sales.widget.add" },
    {
      capability_key: "sales.widget.add",
      widget_key: "saved:9007199254740993",
    },
  ]
  const cards = modelNativeChatActions(
    proposals,
    scope,
    "Add orders by status",
    page,
  )
  assert.equal(cards.length, 3)
  assert.deepEqual(
    cards.map((card) => card.nativeAction?.kind),
    ["edit_page", "add_widget", "add_widget"],
  )
  assert.equal(cards[0]!.nativeAction?.prompt, undefined)
  assert.equal(cards[2]!.nativeAction?.widgetKey, "saved:9007199254740993")
  assert.equal(cards[2]!.nativeAction?.pageId, "dashboard")
  assert.equal(cards[2]!.nativeAction?.prompt, "Add orders by status")
  assert.equal(new Set(cards.map((card) => card.id)).size, 3)
  assert.deepEqual(modelNativeChatActions(proposals, scope, "Add chart"), [])
  assert.deepEqual(
    modelNativeChatActions(proposals, scope, "Add chart", {
      ...page,
      moduleId: "purchasing",
    }),
    [],
  )
  for (const raw of [
    { capability_key: "sales.widget.add", widget_key: "saved:99" },
    { capability_key: "sales.widget.add", widget_key: "builtin:unoffered" },
    { capability_key: "sales.widget.add", widget_key: "saved:01" },
    {
      capability_key: "sales.widget.add",
      widget_key: "saved:9007199254740993",
      query: "SELECT *",
    },
    { capability_key: "sales.widget.add", page_id: "other" },
    { capability_key: "sales.widget.add", record_id: "42" },
    { capability_key: "sales.page.edit", widget_key: "saved:9007199254740993" },
    {
      capability_key: "sales.order.open",
      record_id: "42",
      widget_key: "saved:9007199254740993",
    },
  ])
    assert.deepEqual(
      modelNativeChatActions([raw], scope, "Add chart", page),
      [],
      JSON.stringify(raw),
    )
})

test("page proposals persist as scoped review cards without claiming a completed page write", () => {
  const page = {
    moduleId: "purchasing",
    pageId: "dashboard",
    widgets: [{ key: "builtin:orders-by-state", label: "Orders by status" }],
  }
  const cards = modelNativeChatActions(
    [
      {
        capability_key: "purchasing.widget.add",
        widget_key: "builtin:orders-by-state",
      },
    ],
    scope,
    "Add this chart to my page",
    page,
  )
  const metadata = withNativeActionsMetadata(null, cards)
  assert.deepEqual(parseNativeChatActions(metadata, scope), cards)
  assert.deepEqual(
    parseNativeChatActions(metadata, { ...scope, companyId: "13" }),
    [],
  )
  const reply = assistantPresentationReply(
    { kind: "action", action: cards[0]!.nativeAction! },
    t,
  )!
  assert.equal(reply.content, "aiChat.native.widgetReady")
  assert.equal(reply.actions[0]?.draft, undefined)
  assert.equal(reply.actions[0]?.onClick, undefined)
  const edit = modelNativeChatActions(
    [{ capability_key: "purchasing.page.edit" }],
    scope,
    "Edit this page",
    page,
  )
  assert.equal(
    assistantPresentationReply(
      { kind: "action", action: edit[0]!.nativeAction! },
      t,
    )?.content,
    "aiChat.native.pageReady",
  )
})
