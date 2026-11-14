import assert from "node:assert/strict"
import test from "node:test"
import {
  ALPHA_ASSISTANT_CAPABILITIES,
  ALPHA_ASSISTANT_MODULES,
  ASSISTANT_CAPABILITIES,
  ASSISTANT_PAGE_MODULES,
  ASSISTANT_PROMPT_LIMIT,
  assistantActionHref,
  decodeAssistantAction,
  getAssistantCapability,
  parseAssistantWidgetKey,
  resolveAssistantActionRequest,
  type AssistantAction,
  type AssistantActionScope,
  type AssistantPageCatalog,
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

test("Warehouse Assistant actions focus the exact transfer in the alpha workspace", () => {
  assert.equal(assistantActionHref(action("Open stock transfer 42")), "/warehouse?tab=transfers&filter=id%3A42")
  assert.equal(assistantActionHref(action("Open cycle count wizard")), "/warehouse?tab=cycle-wizard")
  assert.equal(request("Open cycle count 42").kind, "clarify")
  for (const text of ["Review stock transfer 42", "Validate stock transfer 42", "Receive stock transfer 42"]) {
    const review = action(text)
    assert.equal(review.kind, "prepare_workflow")
    assert.equal(assistantActionHref(review), "/inventory/transfers/42?tab=operations")
    assert.equal(getAssistantCapability(review.capabilityKey)?.permission.action, "read")
  }
})

test("operations actions open exact report output and vehicle review tabs", () => {
  assert.equal(
    assistantActionHref(action("Open report 9007199254740993")),
    "/reports?tab=reports&report=9007199254740993",
  )
  assert.equal(assistantActionHref(action("Open catalog item 42")), "/products?tab=products&filter=id%3A42")
  assert.equal(assistantActionHref(action("Open vehicle 42")), "/fleet/vehicles/42")
  for (const [text, key, tab] of [
    ["Service vehicle 42", "fleet.vehicle.service", "service"],
    ["Maintain vehicle 42", "fleet.vehicle.maintain", "service"],
    ["Inspect vehicle 42", "fleet.vehicle.inspect", "inspections"],
  ] as const) {
    const review = action(text)
    assert.equal(review.kind, "prepare_workflow")
    assert.equal(review.capabilityKey, key)
    assert.equal(assistantActionHref(review), `/fleet/vehicles/42?tab=${tab}`)
  }
})

test("workflow requests prepare exact native review without claiming execution", () => {
  const result = action("Post invoice 42")
  assert.equal(result.kind, "prepare_workflow")
  assert.equal(result.capabilityKey, "accounting.invoice.post")
  assert.equal(result.prompt, "Post invoice 42")
  assert.equal(
    getAssistantCapability(result.capabilityKey)?.permission.action,
    "read",
  )
  assert.match(getAssistantCapability(result.capabilityKey)!.label, /^Review /)
  assert.equal(request("Renew subscription").kind, "clarify")
  assert.equal(request("Pay vehicle 42").kind, "clarify")
})

test("finance handoffs name the requested effect and reach its native owner", () => {
  for (const [prompt, label, href] of [
    ["Post invoice 42", "Review invoice posting", "/accounting/invoices/42"],
    ["Pay vendor bill 7", "Review vendor bill payment", "/accounting/invoices/7"],
    ["Post journal entry 42", "Review journal entry posting", "/accounting?tab=journal-entries&filter=id%3A42"],
    ["Submit expense report 42", "Review expense report submission", "/expenses/reports/42"],
    ["Confirm sales order 42", "Review sales order confirmation", "/sales/orders/42"],
    ["Convert lead 42", "Review lead conversion", "/crm?tab=leads&filter=id%3A42"],
    ["Receive purchase order 42", "Review purchase receipt", "/purchasing/orders/42?tab=lines"],
    ["Amend subscription 42", "Review subscription amendment", "/subscriptions/42?tab=amendments"],
  ] as const) {
    const result = action(prompt)
    assert.equal(result.kind, "prepare_workflow")
    assert.equal(getAssistantCapability(result.capabilityKey)?.label, label)
    assert.equal(assistantActionHref(result), href)
  }
  assert.equal(assistantActionHref(action("Open sale order 42")), "/sales/orders/42")
  assert.equal(assistantActionHref(action("Open purchase order 42")), "/purchasing/orders/42")
  assert.equal(assistantActionHref(action("Review invoice 42")), "/accounting/invoices/42")
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

test("support actions hand off to company-bound native records and existing settings and overview destinations", () => {
  for (const [text, expected] of [
    ["Open my work", "/tasks"],
    ["Open task 42", "/tasks?source=projects&taskId=42&taskCompany=7"],
    ["Review task 42", "/tasks?source=projects&taskId=42&taskCompany=7&taskView=edit"],
    ["Assign task 42", "/tasks?source=projects&taskId=42&taskCompany=7&taskView=assign"],
    ["Approve approval request 42", "/approvals?taskId=42&taskCompany=7"],
    ["Open document 42", "/documents/42"],
    ["Open calendar event 42", "/calendar/events/42"],
    ["Open saved imports", "/settings?section=imports"],
    ["Open overdue invoices", "/accounting?tab=invoices&ownerQueue=overdue-invoices"],
    ["Review draft bills", "/accounting?tab=bills&ownerQueue=draft-bills"],
    ["Open low-stock alerts", "/warehouse?tab=stock&ownerQueue=low-stock"],
  ]) {
    assert.equal(assistantActionHref(action(text!)), expected, text)
  }
  assert.equal(action("Approve approval request 42").kind, "prepare_workflow")
  assert.equal(request("Review approval request").kind, "clarify")
  assert.deepEqual(request("Open overdue invoices or draft bills").kind, "none")
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

const page: AssistantPageCatalog = {
  moduleId: "sales",
  pageId: "dashboard",
  widgets: [
    { key: "builtin:orders-by-state", label: "Orders by status" },
    { key: "saved:9007199254740993", label: "Monthly revenue" },
  ],
}

test("page commands open the native editor across modules without broadening business actions", () => {
  for (const module of ASSISTANT_PAGE_MODULES) {
    const edit = action(`Edit the ${module} page`)
    assert.equal(edit.kind, "edit_page")
    assert.equal(edit.capabilityKey, `${module}.page.edit`)
    assert.equal(assistantActionHref(edit), `/${module}`)
    const add = action(`Add a chart to ${module}`)
    assert.equal(add.kind, "add_widget")
    assert.equal(add.capabilityKey, `${module}.widget.add`)
    assert.equal(add.prompt, `Add a chart to ${module}`)
    assert.equal(add.widgetKey, undefined)
  }
  assert.equal(
    new Set(ASSISTANT_CAPABILITIES.map((item) => item.key)).size,
    ASSISTANT_CAPABILITIES.length,
  )
  assert.equal(getAssistantCapability("projects.task.create"), undefined)
  assert.equal(
    getAssistantCapability("distributor.page.edit")?.permission.resource,
    "module:inventory",
  )
  assert.equal(
    getAssistantCapability("trackers.page.edit")?.permission.resource,
    "dashboard:analytics",
  )
})

test("page discovery has its own module scope without expanding business action visibility", () => {
  const options = {
    allowedModules: ["sales"],
    allowedPageModules: ASSISTANT_PAGE_MODULES,
  }
  for (const moduleId of ["hr", "projects"] as const) {
    for (const text of ["Edit this page", "Add a chart"]) {
      const resolution = resolveAssistantActionRequest(text, {
        scope,
        module: moduleId,
        page: { moduleId, pageId: "dashboard", widgets: [] },
        ...options,
      })
      assert.equal(resolution.kind, "action")
      if (resolution.kind !== "action")
        throw new Error("Expected a page action")
      assert.deepEqual(
        decodeAssistantAction(resolution.action, scope, options),
        resolution.action,
      )
      assert.equal(
        decodeAssistantAction(resolution.action, scope, {
          allowedModules: ["sales"],
        }),
        undefined,
      )
      assert.equal(
        decodeAssistantAction(resolution.action, scope, {
          allowedModules: [moduleId],
          allowedPageModules: [],
        }),
        undefined,
      )
    }
  }
  assert.equal(
    decodeAssistantAction(action("Create an invoice"), scope, options),
    undefined,
  )
  const hiddenForm = resolveAssistantActionRequest("Create an invoice", {
    scope,
    ...options,
  })
  assert.notEqual(hiddenForm.kind, "action")
  assert.equal(getAssistantCapability("hr.employee.create"), undefined)
  assert.equal(getAssistantCapability("projects.task.create"), undefined)
})

test("current-page requests preserve intent and select only an unambiguous offered widget", () => {
  const edit = resolveAssistantActionRequest("Edit this page", {
    scope,
    module: "sales",
    page,
  })
  assert.equal(edit.kind, "action")
  if (edit.kind === "action") assert.equal(edit.action.pageId, "dashboard")
  const add = resolveAssistantActionRequest("Add a chart for Monthly revenue", {
    scope,
    module: "sales",
    page,
  })
  assert.equal(add.kind, "action")
  if (add.kind !== "action") throw new Error("Expected a page action")
  assert.equal(add.action.widgetKey, "saved:9007199254740993")
  assert.equal(add.action.prompt, "Add a chart for Monthly revenue")
  assert.equal(add.action.recordId, undefined)
  const ambiguous = resolveAssistantActionRequest(
    "Add a chart for Monthly revenue",
    {
      scope,
      module: "sales",
      page: {
        ...page,
        widgets: [
          ...page.widgets,
          { key: "saved:42", label: "Monthly revenue" },
        ],
      },
    },
  )
  assert.equal(ambiguous.kind, "action")
  if (ambiguous.kind === "action")
    assert.equal(ambiguous.action.widgetKey, undefined)
  assert.equal(request("Edit this page").kind, "clarify")
  assert.equal(request("How can I add a chart?", "sales").kind, "none")
  assert.equal(
    request("Add an invoice with a chart", "accounting").kind,
    "action",
  )
  assert.equal(
    action("Add an invoice with a chart", "accounting").kind,
    "open_form",
  )
})

test("page actions return to the captured module tab", () => {
  for (const prompt of ["Edit this page", "Add a chart"] as const) {
    const resolution = resolveAssistantActionRequest(prompt, {
      scope,
      module: "sales",
      page: { ...page, pageId: "orders" },
    })
    assert.equal(resolution.kind, "action")
    if (resolution.kind !== "action") throw new Error("Expected a page action")
    assert.equal(assistantActionHref(resolution.action), "/sales?tab=orders")
    assert.equal(
      assistantActionHref({
        ...resolution.action,
        pageId: "../other",
      } as AssistantAction),
      undefined,
    )
  }
})

test("widget proposals reject malformed selectors, stale scope, foreign views and injected definitions", () => {
  const selected: AssistantAction = {
    version: 1,
    kind: "add_widget",
    capabilityKey: "sales.widget.add",
    scope,
    pageId: "dashboard",
    widgetKey: "saved:9007199254740993",
    prompt: "Add monthly revenue",
  }
  assert.deepEqual(decodeAssistantAction(selected, scope, { page }), selected)
  assert.equal(
    decodeAssistantAction(selected, { ...scope, actorId: "other" }, { page }),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(selected, scope, { page: { ...page, widgets: [] } }),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(selected, scope, {
      page: { ...page, moduleId: "purchasing" },
    }),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(selected, scope, {
      page: { ...page, pageId: "orders" },
    }),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(selected, scope, { allowedModules: ["crm"], page }),
    undefined,
  )
  for (const widgetKey of [
    "saved:0",
    "saved:01",
    "saved:18446744073709551616",
    "builtin:",
    "builtin:../admin",
    "https://example.com",
    42,
  ]) {
    assert.equal(parseAssistantWidgetKey(widgetKey), undefined)
    assert.equal(
      decodeAssistantAction({ ...selected, widgetKey }, scope),
      undefined,
    )
  }
  for (const extra of [
    { query: "SELECT * FROM account_move" },
    { component: "<div />" },
    { params: {} },
    { recordId: "42" },
    { pageId: "/admin" },
  ]) {
    assert.equal(
      decodeAssistantAction({ ...selected, ...extra }, scope),
      undefined,
    )
  }
  assert.equal(
    decodeAssistantAction(
      { ...selected, kind: "edit_page", capabilityKey: "sales.page.edit" },
      scope,
    ),
    undefined,
  )
  assert.equal(
    decodeAssistantAction(
      { ...action("Open invoice 42"), widgetKey: "saved:42" },
      scope,
    ),
    undefined,
  )
})
