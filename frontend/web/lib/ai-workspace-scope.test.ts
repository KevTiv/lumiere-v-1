import assert from "node:assert/strict"
import test from "node:test"
import { AI_WORKSPACE_SCOPES, resolveAiWorkspaceScope } from "./ai-workspace-scope"

const selectedOrder = {
  entityType: "sale_order",
  entityId: "9007199254740993",
  activeTab: "orders",
  selectionSummary: "Draft order",
}

test("current-page context keeps the route and selected record", () => {
  assert.deepEqual(resolveAiWorkspaceScope("current", "/sales", selectedOrder), {
    label: "Current page",
    pathname: "/sales",
    commands: [],
    selection: selectedOrder,
    usesCurrentPage: true,
  })
})

test("choosing a module never carries a record selected in another module", () => {
  assert.deepEqual(resolveAiWorkspaceScope("module:inventory", "/sales", selectedOrder), {
    label: "Inventory",
    pathname: "/inventory",
    commands: ["inventory"],
    selection: null,
    usesCurrentPage: false,
  })
})

test("group context is not a fabricated ERP route or a cross-company grant", () => {
  const scope = resolveAiWorkspaceScope("group:commercial", "/sales", selectedOrder)
  assert.equal(scope.pathname, "/")
  assert.deepEqual(scope.commands, ["sales", "customers"])
  assert.equal(scope.selection, null)
  assert.equal("companyId" in scope, false)
})

test("all modules and unknown choices default to safe explicit contexts", () => {
  const all = resolveAiWorkspaceScope("all", "/accounting", selectedOrder)
  assert.equal(all.pathname, "/")
  assert.equal(all.selection, null)
  assert.deepEqual(resolveAiWorkspaceScope("unexpected", "/crm", null), {
    label: "Current page",
    pathname: "/crm",
    commands: [],
    selection: null,
    usesCurrentPage: true,
  })
  assert.equal(new Set(AI_WORKSPACE_SCOPES.map((scope) => scope.value)).size, AI_WORKSPACE_SCOPES.length)
})
