import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentProps, ReactNode } from "react"
import { NavigationGuardProvider } from "../forms/navigation-guard-provider"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

const state = vi.hoisted(() => ({ identity: "alice", organizationId: 7, companyIds: [1, 2], activeCompanyReady: true, activeCompanyId: 1, setActiveCompanyId: vi.fn() }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => state }))
vi.mock("@lumiere/query-hooks/hooks/organization-company", () => ({ useCompanies: () => ({ data: [{ id: 1, name: "Company One" }, { id: 2, name: "Company Two" }], isLoading: false }) }))
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({ useOperatingCompanyId: () => state.activeCompanyId }))
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: (props: ComponentProps<"button">) => <button {...props} />,
}))
import { CompanySwitcher } from "./company-switcher"

function Editor({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  useUnsavedChangesGuard(dirty, pending)
  return null
}
function tree(dirty = true, pending = false) {
  return <NavigationGuardProvider><Editor dirty={dirty} pending={pending} /><CompanySwitcher /></NavigationGuardProvider>
}
beforeEach(() => {
  state.identity = "alice"; state.organizationId = 7; state.companyIds = [1, 2]
  state.activeCompanyReady = true; state.activeCompanyId = 1; state.setActiveCompanyId.mockClear()
})
afterEach(cleanup)

describe("company changes use the shared editor guard", () => {
  it("retains the company when dirty-work discard is cancelled", async () => {
    render(tree())
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"))
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
  })
  it("changes company exactly once after confirmed discard", async () => {
    render(tree())
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(state.setActiveCompanyId).toHaveBeenCalledExactlyOnceWith(2))
  })
  it("blocks a user switch during a save and does not replay it after the save", async () => {
    const view = render(tree(false, true))
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    await Promise.resolve()
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    view.rerender(tree(false, false))
    await Promise.resolve()
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
  })
  it("rechecks pending state before applying an accepted switch", async () => {
    const view = render(tree())
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    await screen.findByTestId("confirm-dialog-confirm")
    view.rerender(tree(true, true))
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
  })
  it("rechecks the actor and company grants after confirmation", async () => {
    const view = render(tree())
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    await screen.findByTestId("confirm-dialog-confirm")
    state.identity = "bob"; state.companyIds = [1]
    view.rerender(tree())
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
  })
  it("does not prompt for the current company, and permits clean authorized switching", () => {
    const view = render(tree())
    fireEvent.click(screen.getByTestId("company-switcher-option-1"))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(state.setActiveCompanyId).not.toHaveBeenCalled()
    view.rerender(tree(false))
    fireEvent.click(screen.getByTestId("company-switcher-option-2"))
    expect(state.setActiveCompanyId).toHaveBeenCalledExactlyOnceWith(2)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})
