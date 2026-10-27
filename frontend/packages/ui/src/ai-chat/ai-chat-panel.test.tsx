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
