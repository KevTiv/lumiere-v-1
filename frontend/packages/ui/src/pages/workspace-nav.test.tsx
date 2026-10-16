import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Tabs, TabsContent } from "../components/tabs"
import type { ModuleTab, ModuleWorkspaceNav } from "../lib/module-types"
import { WorkspaceNav } from "./workspace-nav"

afterEach(cleanup)
const tabs: ModuleTab[] = ["dashboard", "invoices", "credit-control", "bills", "taxes"].map((id) => ({ id, label: id, type: "custom" }))
const config: ModuleWorkspaceNav = {
  label: "Accounting workspaces",
  workspaces: [
    { id: "overview", label: "Overview", tabIds: ["dashboard"] },
    { id: "receivables", label: "Receivables", tabIds: ["invoices", "credit-control"] },
    { id: "payables", label: "Payables", tabIds: ["bills"] },
  ],
  overflow: [{ id: "setup", label: "Configuration", tabIds: ["taxes"] }],
}

function Workspace({ initialTab = "dashboard" }: { initialTab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab)
  return <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value))}>
    <WorkspaceNav moduleId="accounting" tabs={tabs} config={config} activeTab={activeTab} onTabChange={setActiveTab} hrefForTab={(id) => `/accounting?tab=${id}`} />
    {tabs.map((tab) => <TabsContent key={tab.id} value={tab.id}>{tab.id} content</TabsContent>)}
  </Tabs>
}

describe("WorkspaceNav", () => {
  it("derives the workspace and accessible panel from an existing secondary-tab deep link", () => {
    render(<Workspace initialTab="credit-control" />)
    expect(screen.getByRole("link", { name: "Receivables" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["invoices", "credit-control"])
    expect(screen.getByRole("tab", { name: "credit-control" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel").textContent).toBe("credit-control content")
  })

  it("changes workspaces and supports keyboard navigation between their local views", async () => {
    render(<Workspace />)
    fireEvent.click(screen.getByRole("link", { name: "Receivables" }))
    expect(screen.getByRole("tabpanel").textContent).toBe("invoices content")
    const invoices = screen.getByRole("tab", { name: "invoices" })
    invoices.focus()
    fireEvent.keyDown(invoices, { key: "ArrowRight" })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: "credit-control" })))
    fireEvent.click(screen.getByRole("tab", { name: "credit-control" }))
    expect(screen.getByRole("tabpanel").textContent).toBe("credit-control content")
  })

  it("keeps the current local view when selecting its already active workspace", () => {
    render(<Workspace initialTab="credit-control" />)
    const workspace = screen.getByRole("link", { name: "Receivables" })
    expect(workspace.getAttribute("href")).toBe("/accounting?tab=credit-control")
    fireEvent.click(workspace)
    expect(screen.getByRole("tabpanel").textContent).toBe("credit-control content")
  })

  it("keeps configuration deep links selected and opens all settings in a keyboard-accessible menu", async () => {
    render(<Workspace initialTab="taxes" />)
    expect(screen.getByRole("tab", { name: "taxes" }).getAttribute("aria-selected")).toBe("true")
    fireEvent.keyDown(screen.getByRole("button", { name: "Advanced / Configuration" }), { key: "Enter" })
    const setting = await screen.findByRole("menuitem", { name: "taxes" })
    expect(setting.getAttribute("href")).toBe("/accounting?tab=taxes")
    expect(setting.getAttribute("aria-current")).toBe("page")
  })

  it("opens a configuration view and dismisses its menu after selection", async () => {
    render(<Workspace />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Advanced / Configuration" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "taxes" }))
    expect(screen.getByRole("tabpanel").textContent).toBe("taxes content")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("leaves modified clicks available for native open-in-new-tab behavior", () => {
    render(<Workspace />)
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })
    // Observe native behavior without asking jsdom to navigate after the assertion.
    let prevented = false
    const link = screen.getByRole("link", { name: "Receivables" })
    link.addEventListener("click", (event) => { prevented = event.defaultPrevented; event.preventDefault() }, { once: true })
    link.dispatchEvent(click)
    expect(prevented).toBe(false)
    expect(screen.getByRole("tabpanel").textContent).toBe("dashboard content")
  })
})
