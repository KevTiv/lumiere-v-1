import assert from "node:assert/strict"
import test from "node:test"
import {
  ALPHA_ASSISTANT_CAPABILITIES,
  ALPHA_ASSISTANT_MODULES,
  ASSISTANT_PROMPT_LIMIT,
  assistantActionHref,
  decodeAssistantAction,
  getAssistantCapability,
  resolveAssistantActionRequest,
  type AssistantAction,
  type AssistantActionScope,
} from "./assistant-actions"
import { looksLikeActionDraftRequest } from "./action-draft-intent"

const scope: AssistantActionScope = {
  actorId: "actor-A",
  organizationId: "1",
  companyId: "7",
}
const context = { scope }
const request = (text: string, module?: string) =>
  resolveAssistantActionRequest(text, { ...context, module })
function action(text: string, module?: string): AssistantAction {
  const result = request(text, module)
  assert.equal(result.kind, "action", JSON.stringify(result))
  if (result.kind !== "action") throw new Error("Expected action")
  return result.action
}

test("explicit navigation never prepares a mutation draft", () => {
  for (const text of [
    "Open sale order 42",
    "Show purchase order #99",
    "Take me to invoice 42",
  ]) {
    assert.equal(action(text).kind, "open_record")
    assert.equal(looksLikeActionDraftRequest(text), false)
  }
  assert.equal(
    looksLikeActionDraftRequest("Explain why @create should be used"),
    false,
  )
  assert.equal(looksLikeActionDraftRequest("How do I create an order?"), false)
  assert.equal(looksLikeActionDraftRequest("@create task for tomorrow"), false)
  assert.equal(looksLikeActionDraftRequest("@create todo for tomorrow"), false)
  assert.equal(
    looksLikeActionDraftRequest("@create purchase order for vendor 7"),
    true,
  )
})

test("native creation requests select existing module owners across the Alpha cohorts", () => {
  const cases = [
    [
      "Create an invoice for customer 42",
      "accounting.invoice.create",
      "accounting",
      "invoices",
    ],
    ["Add an expense", "expenses.expense.create", "expenses", "expenses"],
    [
      "Generate a financial report",
      "reports.report.generate",
      "reports",
      "reports",
    ],
    ["Create a quotation", "sales.order.create", "sales", "orders"],
    ["Add a contact", "crm.contact.create", "crm", "contacts"],
    [
      "Prepare a purchase order",
      "purchasing.order.create",
      "purchasing",
      "orders",
    ],
    [
      "Create a subscription",
      "subscriptions.subscription.create",
      "subscriptions",
      "subscriptions",
    ],
    ["Add a product", "products.product.create", "products", "products"],
    [
      "Create a stock transfer",
      "warehouse.transfer.create",
      "warehouse",
      "transfers",
    ],
    ["Add a vehicle", "fleet.vehicle.create", "fleet", "fleet-vehicles"],
  ]
  for (const [text, key, module, tab] of cases) {
    const result = action(text!)
    assert.equal(result.kind, "open_form")
    assert.equal(result.capabilityKey, key)
    assert.equal(result.prompt, text)
    assert.equal(getAssistantCapability(result.capabilityKey)?.module, module)
    assert.equal(getAssistantCapability(result.capabilityKey)?.tab, tab)
    assert.equal(
      result.recordId,
      undefined,
      "a customer id must not become the new invoice identity",
    )
  }
})

test("unqualified order requests clarify instead of choosing Sales or Purchasing", () => {
  const result = request("Open order 42")
  assert.deepEqual(result, {
    kind: "clarify",
    reason: "ambiguous_target",
    candidates: ["sales.order", "purchasing.order"],
  })
  assert.equal(
    action("Open order 42", "sales").capabilityKey,
    "sales.order.open",
  )
  assert.equal(
    action("Create an order", "purchasing").capabilityKey,
    "purchasing.order.create",
  )
  assert.equal(request("Create a contact and an opportunity").kind, "clarify")
  assert.equal(request("Open invoice 42 or invoice 99").kind, "clarify")
  assert.equal(
    action("Create a contact named Bread and Butter").capabilityKey,
    "crm.contact.create",
  )
})

test("record requests require exact identity and preserve u64 values", () => {
  const result = action("Open invoice 9007199254740993")
  assert.equal(result.recordId, "9007199254740993")
  assert.match(assistantActionHref(result)!, /9007199254740993/)
  assert.notEqual(
    assistantActionHref(action("Open sale order 42")),
    assistantActionHref(action("Open sale order 99")),
  )
  for (const text of [
    "Open invoice",
    "Open invoice INV-42",
    "Open invoice -42",
    "Open invoices -42",
    "Open invoice 18446744073709551616",
  ]) {
    assert.equal(request(text).kind, "clarify", text)
  }
})

test("an exact current selection can satisfy record identity but never a different entity", () => {
  const selected = resolveAssistantActionRequest("Open invoice", {
    scope,
    selection: { entityType: "account_move", entityId: "44" },
  })
  assert.equal(selected.kind, "action")
  if (selected.kind === "action") assert.equal(selected.action.recordId, "44")
  assert.equal(
    resolveAssistantActionRequest("Open invoice", {
      scope,
      selection: { entityType: "sale_order", entityId: "44" },
    }).kind,
    "clarify",
  )
})

test("lists and module navigation do not need or invent record identities", () => {
  assert.equal(action("Open invoices").capabilityKey, "accounting.invoice.list")
  assert.equal(
    action("Take me to warehouse").capabilityKey,
    "warehouse.navigate",
  )
  assert.equal(action("Show products").capabilityKey, "products.navigate")
  assert.equal(
    assistantActionHref(action("Open cycle counts")),
    "/warehouse?tab=cycle-wizard",
  )
})

test("workflow requests prepare exact native review without claiming execution", () => {
  const result = action("Post invoice 42")
  assert.equal(result.kind, "prepare_workflow")
  assert.equal(result.capabilityKey, "accounting.invoice.review")
  assert.equal(result.prompt, "Post invoice 42")
  assert.equal(
    getAssistantCapability(result.capabilityKey)?.permission.action,
    "read",
  )
  assert.match(getAssistantCapability(result.capabilityKey)!.label, /^Review /)
  assert.equal(request("Renew subscription").kind, "clarify")
  assert.equal(request("Pay vehicle 42").kind, "clarify")
})

test("unsupported and advisory requests cannot silently reach hidden task mutations", () => {
  for (const text of [
    "Create a task",
    "@create task for tomorrow",
    "Open projects",
    "Create a cycle count",
  ])
    assert.equal(request(text).kind, "clarify", text)
  for (const text of [
    "How do I create an invoice?",
    "What is an invoice?",
    "Créer une commande",
    "Open manufacturing order 42",
  ])
    assert.equal(request(text).kind === "action", false, text)
})

test("captured actions are actor, organization and company bound", () => {
  const result = action("Create an invoice")
  assert.deepEqual(decodeAssistantAction(result, scope), result)
  for (const changed of [
    { ...scope, actorId: "actor-B" },
    { ...scope, companyId: "8" },
    { ...scope, organizationId: "2" },
  ])
    assert.equal(decodeAssistantAction(result, changed), undefined)
  assert.equal(
    decodeAssistantAction(result, scope, { allowedModules: ["crm"] }),
    undefined,
  )
})

test("runtime decoding rejects arbitrary parameters, mismatched kinds and malformed identities", () => {
  const result = action("Open invoice 42")
  for (const extra of [
    { href: "https://evil.example" },
    { params: { companyId: "8" } },
    { reducer: "post_invoice" },
  ])
    assert.equal(
      decodeAssistantAction({ ...result, ...extra }, scope),
      undefined,
    )
  for (const recordId of [
    "0",
    "-1",
    "42.1",
    "1e3",
    "00042",
    "18446744073709551616",
    42,
    {},
    null,
  ])
    assert.equal(
      decodeAssistantAction({ ...result, recordId }, scope),
      undefined,
    )
  assert.equal(
    decodeAssistantAction({ ...result, kind: "open_form" }, scope),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(
      { ...result, capabilityKey: "manufacturing.order.open" },
      scope,
    ),
    undefined,
  )
  assert.equal(
    decodeAssistantAction({ ...result, prompt: "unrelated" }, scope),
    undefined,
  )
})

test("prompts are bounded plain instructions, never automatically applied values", () => {
  const result = action("Create an invoice")
  assert.equal(
    decodeAssistantAction({ ...result, values: { amount: 9000 } }, scope),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(
      { ...result, prompt: "x".repeat(ASSISTANT_PROMPT_LIMIT + 1) },
      scope,
    ),
    undefined,
  )
  assert.equal(
    request("Create an invoice " + "x".repeat(ASSISTANT_PROMPT_LIMIT)).kind,
    "none",
  )
})

test("catalog covers all ten Alpha modules without hidden family discovery", () => {
  assert.equal(
    new Set(ALPHA_ASSISTANT_CAPABILITIES.map((item) => item.key)).size,
    ALPHA_ASSISTANT_CAPABILITIES.length,
  )
  for (const module of ALPHA_ASSISTANT_MODULES)
    assert.ok(getAssistantCapability(`${module}.navigate`))
  for (const hidden of [
    "inventory",
    "manufacturing",
    "hr",
    "projects",
    "messages",
    "iot",
    "map",
    "ai-harness",
  ])
    assert.equal(getAssistantCapability(`${hidden}.navigate`), undefined)
})
