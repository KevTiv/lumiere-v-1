import { describe, expect, it } from "vitest"

import { buildModuleTabRow, type ModuleTab } from "./module-types"

const tab = (id: string): ModuleTab => ({ id, label: id, type: "custom" })

describe("buildModuleTabRow", () => {
  it("keeps leading and trailing ungrouped tabs around labelled groups", () => {
    const tabs = ["dashboard", "invoices", "taxes", "bills", "operations"].map(tab)
    const row = buildModuleTabRow(tabs, [
      { label: "Documents", tabIds: ["invoices", "bills"] },
      { label: "Setup", tabIds: ["taxes"] },
    ])
    expect(row.map((item) => (item.kind === "group" ? `#${item.label}` : item.tab.id))).toEqual([
      "dashboard",
      "#Documents",
      "invoices",
      "bills",
      "#Setup",
      "taxes",
      "operations",
    ])
  })

  it("is the plain tab list without groups", () => {
    const row = buildModuleTabRow([tab("a"), tab("b")], undefined)
    expect(row).toEqual([
      { kind: "tab", tab: tab("a") },
      { kind: "tab", tab: tab("b") },
    ])
  })
})
