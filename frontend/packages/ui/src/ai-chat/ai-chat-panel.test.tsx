import { chooseSelectValue } from "../components/select-test-utils"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { forwardRef, type ReactNode } from "react"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
    function MockScrollArea({ children, className }, ref) {
      return <div ref={ref} className={className}>{children}</div>
    },
  ),
}))

vi.mock("./ai-action-draft-card", () => ({
  AiActionDraftCard: ({ draft }: { draft: { draftId: number } }) => (
    <div data-testid="assistant-action-draft">Draft {draft.draftId}</div>
  ),
}))

import { AIChatPanel } from "./ai-chat-panel"

afterEach(cleanup)

describe("AI chat workspace", () => {
  it("opens substantial contextual answers as unsaved guides with their ERP sources", async () => {
    const onOpenGuide = vi.fn()
    const content = "## Review this vendor bill\n\n" + "Check the supplier, lines, and linked records before posting. ".repeat(6)
    const source = { kind: "live" as const, trust: "authoritative" as const, entity_type: "account_move", entity_id: "52", href: "/accounting/52" }
    render(<AIChatPanel open docked onClose={vi.fn()} context={{ module: "accounting", companyId: 7 }} config={{ onOpenGuide }} initialMessages={[{ id: "42", role: "assistant", content, timestamp: new Date(), sources: [source], metadata: { runId: 11 } }]} />)
    fireEvent.click(await screen.findByTestId("assistant-guide-card"))
    expect(onOpenGuide).toHaveBeenCalledWith({ messageId: "42", draft: expect.objectContaining({ title: "Review this vendor bill", markdown: content, module: "accounting", companyId: "7", runId: "11", sources: [source], draftKey: "message:42" }) })
  })

  it("opens saved guide references without using stored document bodies", async () => {
    const onOpenGuide = vi.fn()
    const reference = { guideId: "9007199254740993", revision: 2, title: "Bill posting guide", module: "accounting" }
    render(<AIChatPanel open onClose={vi.fn()} config={{ onOpenGuide, guideLibraryHref: "/documents/knowledge?module=accounting" }} initialMessages={[{ id: "42", role: "assistant", content: "This guide may help.", timestamp: new Date(), guides: [reference] }]} />)
    fireEvent.click(await screen.findByTestId("assistant-guide-card"))
    expect(onOpenGuide).toHaveBeenCalledWith({ messageId: "42", reference })
    expect(screen.getByRole("link").getAttribute("href")).toBe("/documents/knowledge?module=accounting")
  })

  it("opens both the generated answer and a related saved guide as separate documents", async () => {
    const onOpenGuide = vi.fn()
    const content = "## Current vendor bill checks\n\n" + "Review this bill using the current supplier and linked ERP records. ".repeat(6)
    const reference = { guideId: "9007199254740993", revision: 2, title: "Saved posting procedure", module: "accounting" }
    const source = { kind: "live" as const, trust: "authoritative" as const, entity_type: "account_move", entity_id: "52", href: "/accounting/52" }
    render(<AIChatPanel open docked onClose={vi.fn()} context={{ module: "accounting", companyId: 7 }} config={{ onOpenGuide }} initialMessages={[{ id: "44", role: "assistant", content, timestamp: new Date(), guides: [reference], sources: [source] }]} />)
    const cards = await screen.findAllByTestId("assistant-guide-card")
    expect(cards).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: /Saved posting procedure/ }))
    expect(onOpenGuide).toHaveBeenNthCalledWith(1, { messageId: "44", reference })
    fireEvent.click(screen.getByRole("button", { name: /Current vendor bill checks/ }))
    expect(onOpenGuide).toHaveBeenNthCalledWith(2, { messageId: "44", draft: expect.objectContaining({ draftKey: "message:44", markdown: content, module: "accounting", companyId: "7", sources: [source] }) })
  })

  it("offers the single generated HTML fence as a derivative while retaining the answer", async () => {
    const onOpenGuide = vi.fn()
    const html = `<h1>Vendor bill checks</h1><p>${"Check the linked ERP records. ".repeat(10)}</p>`
    const content = `## Vendor bill guide\n\n\`\`\`html\n${html}\n\`\`\``
    render(<AIChatPanel open onClose={vi.fn()} context={{ module: "accounting", companyId: 7 }} config={{ onOpenGuide }} initialMessages={[{ id: "43", role: "assistant", content, timestamp: new Date() }]} />)
    fireEvent.click(await screen.findByTestId("assistant-guide-card"))
    expect(onOpenGuide).toHaveBeenCalledWith({ messageId: "43", draft: expect.objectContaining({ markdown: content, html }) })
  })

  it("retains a failed request in the editor and shows the transport failure", async () => {
    const onStreamMessage = vi.fn(async () => { throw new Error("Service unavailable") })
    render(<AIChatPanel open onClose={vi.fn()} onStreamMessage={onStreamMessage} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Review my current stock" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("aiChat.requestFailed"))
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("Review my current stock")
    expect(screen.getByText("Service unavailable")).toBeTruthy()
    expect(onStreamMessage).toHaveBeenCalledOnce()
  })

  it("preserves a newer unsent draft when the previous request fails", async () => {
    let fail!: (reason: Error) => void
    const onStreamMessage = vi.fn(() => new Promise<never>((_resolve, reject) => { fail = reject }))
    render(<AIChatPanel open onClose={vi.fn()} onStreamMessage={onStreamMessage} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "First request" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect(onStreamMessage).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "New unsent draft" } })
    await act(async () => { fail(new Error("Network unavailable")) })
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("New unsent draft")
    expect(onStreamMessage).toHaveBeenCalledOnce()
  })
  it("opens full-screen with a context selector and uses the existing message transport", async () => {
    const onStreamMessage = vi.fn(async (_text: string, handlers: { onDelta: (text: string) => void }) => {
      handlers.onDelta("Current results")
      return { content: "Current results", runId: 42 }
    })
    const onContextChange = vi.fn()
    const onDockToggle = vi.fn()
    render(
      <AIChatPanel
        open
        onClose={vi.fn()}
        onDockToggle={onDockToggle}
        contextOptions={[
          { value: "current", label: "Current page", group: "Context" },
          { value: "module:inventory", label: "Inventory", group: "Modules" },
        ]}
        selectedContext="current"
        onContextChange={onContextChange}
        onStreamMessage={onStreamMessage}
      />,
    )

    expect(screen.getByTestId("erp-ai-chat-panel").getAttribute("data-mode")).toBe("full")
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Assistant context" }),
      "module:inventory",
    )
    expect(onContextChange).toHaveBeenCalledWith("module:inventory")
    fireEvent.click(screen.getByRole("button", { name: "Dock beside ERP" }))
    expect(onDockToggle).toHaveBeenCalledOnce()

    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Show my stock" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect(onStreamMessage).toHaveBeenCalledWith("Show my stock", expect.any(Object)))
    expect(await screen.findByText("Current results")).toBeTruthy()
    expect(screen.getByText("Inspect run").getAttribute("href")).toBe("/ai-harness?runId=42")
  })

  it("shows citations and existing draft cards in the side workspace", async () => {
    render(
      <AIChatPanel
        open
        docked
        onClose={vi.fn()}
        initialMessages={[{
          id: "assistant-1",
          role: "assistant",
          content: "A draft is ready",
          timestamp: new Date("2026-10-17T12:00:00Z"),
          sources: [{ kind: "live", trust: "authoritative", label: "Item record" }],
          actions: [{
            id: "action-1",
            type: "draft",
            label: "Review draft",
            draft: {
              draftId: 10,
              reducerName: "inventory.create",
              summary: "Proposed record",
              paramsJson: {},
              confidence: 0.8,
              warnings: [],
              elevated: false,
            },
          }],
        }]}
      />,
    )
    expect(screen.getByTestId("erp-ai-chat-panel").getAttribute("data-mode")).toBe("side")
    expect(await screen.findByText("A draft is ready")).toBeTruthy()
    expect(screen.getByText(/Item record/)).toBeTruthy()
    expect(screen.getByTestId("assistant-action-draft").textContent).toContain("10")
  })
})
