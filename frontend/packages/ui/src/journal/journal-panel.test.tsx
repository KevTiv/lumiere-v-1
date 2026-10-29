import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const session = vi.hoisted(() => ({ identity: "alice", connected: true, organizationId: 1, companyIds: [2], activeCompanyId: 2, activeCompanyReady: true }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => session }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key, i18n: { language: "en" } }) }))
vi.mock("@/lib/rbac-context", () => ({ useRBAC: () => ({ currentUser: { id: "alice", roles: [] } }) }))
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
import { JournalPanel } from "./journal-panel"

beforeEach(() => { localStorage.clear(); session.identity = "alice" })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function compose(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "ui.journal.other" }))
  const editor = screen.getByRole("textbox", { name: "Working note" })
  fireEvent.change(editor, { target: { value } })
  return editor
}

describe("browser working notes UI", () => {
  it("restores submitted working notes after remount and hides them after an actor switch", () => {
    const view = render(<JournalPanel open onClose={vi.fn()} />)
    compose("Review supplier credit")
    fireEvent.click(screen.getByRole("button", { name: "ui.journal.actions.saveNote" }))
    expect(screen.getByText("Review supplier credit")).toBeTruthy()
    view.unmount()
    const next = render(<JournalPanel open onClose={vi.fn()} />)
    expect(screen.getByText("Review supplier credit")).toBeTruthy()
    session.identity = "bob"
    next.rerender(<JournalPanel open onClose={vi.fn()} />)
    expect(screen.queryByText("Review supplier credit")).toBeNull()
  })

  it("retains the composition after a failed storage write", () => {
    render(<JournalPanel open onClose={vi.fn()} />)
    const editor = compose("Do not lose this note")
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded") })
    fireEvent.click(screen.getByRole("button", { name: "ui.journal.actions.saveNote" }))
    expect((editor as HTMLTextAreaElement).value).toBe("Do not lose this note")
    expect(screen.getByRole("alert").textContent).toContain("entries are retained")
  })
})
