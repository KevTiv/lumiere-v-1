import assert from "node:assert/strict"
import test from "node:test"
import { createInstance } from "i18next"
import { businessWorkspaceNavigation, type BusinessWorkspaceModule } from "./business-workspace-navigation"
import { resolveWorkspaceNavigation } from "@lumiere/ui/lib/workspace-navigation"
import type { ModuleTab } from "@lumiere/ui/lib/module-types"
import en from "../../packages/i18n/src/locales/en.json"

const i18n = createInstance()
await i18n.init({ lng: "en", resources: { en: { translation: en } }, initImmediate: false })

for (const module of ["sales", "crm", "purchasing", "reports", "expenses"] as BusinessWorkspaceModule[]) {
  test(`${module}: translated, bounded workspaces retain every runtime destination exactly once`, () => {
    const config = businessWorkspaceNavigation(module, i18n.t)
    const groups = [...config.workspaces, ...(config.overflow ?? [])]
    const ids = groups.flatMap((group) => group.tabIds)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(config.workspaces.length <= 5)
    assert.equal(config.workspaces[0]?.label, "Overview")
    for (const group of groups) assert.ok(!group.label.startsWith("modules."), group.label)
    const tabs: ModuleTab[] = [...ids, "future-extension"].map((id) => ({ id, label: id, type: "custom" }))
    const result = resolveWorkspaceNavigation(tabs, config)
    const reachable = [...result.workspaces, ...result.overflow].flatMap((group) => group.tabs.map((tab) => tab.id))
    assert.deepEqual(new Set(reachable), new Set(tabs.map((tab) => tab.id)))
    assert.equal(reachable.length, tabs.length)
    assert.ok(result.overflow.some((group) => group.tabs.some((tab) => tab.id === "future-extension")))
  })
}

test("partial module installations omit empty workspaces and never invent tabs", () => {
  const result = resolveWorkspaceNavigation([{ id: "dashboard", label: "Dashboard", type: "dashboard" }], businessWorkspaceNavigation("purchasing", i18n.t))
  assert.deepEqual(result.workspaces.map((group) => group.id), ["overview"])
  assert.deepEqual(result.overflow, [])
})

test("runtime activity views join CRM while base-only installs retain a valid landing view", () => {
  const config = businessWorkspaceNavigation("crm", i18n.t)
  const tab = (id: string): ModuleTab => ({ id, label: id, type: "custom" })
  assert.equal(resolveWorkspaceNavigation([tab("activities")], config).workspaces[0]?.tabs[0]?.id, "activities")
  assert.deepEqual(resolveWorkspaceNavigation([tab("activities"), tab("my-activities")], config).workspaces[0]?.tabs.map((item) => item.id), ["my-activities", "activities"])
})

test("Expenses operations land on the connected Inbox and keep specialist settings separate", () => {
  const config = businessWorkspaceNavigation("expenses", i18n.t)
  const operations = config.workspaces.find((group) => group.id === "operations")
  assert.equal(operations?.tabIds[0], "inbox")
  assert.ok(operations?.tabIds.includes("card-reconciliation"))
  assert.ok(config.overflow?.some(group => group.tabIds.includes("expense-settings")))
})
