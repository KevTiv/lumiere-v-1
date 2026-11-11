import { chooseSelectValue } from "../components/select-test-utils"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  it("keeps the shell composer mounted when a dock becomes a modal", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    try {
      const onClose = vi.fn()
      const { rerender, unmount } = render(
        <AIChatPanel open docked workspaceHost={host} onClose={onClose} />,
      )
      const input = await screen.findByTestId("erp-ai-chat-input") as HTMLTextAreaElement
      fireEvent.change(input, { target: { value: "Keep the unsent draft" } })
      rerender(<AIChatPanel open workspaceHost={host} onClose={onClose} />)
      const dialog = screen.getByRole("dialog", { name: "aiChat.title" })
      expect(within(dialog).getByTestId("erp-ai-chat-input")).toBe(input)
      expect(input.value).toBe("Keep the unsent draft")
      fireEvent.change(input, { target: { value: "Keep the unsent draft /no-such-skill" } })
      expect(within(dialog).getByText("aiChat.deck.noMatches")).toBeTruthy()
      fireEvent.keyDown(input, { key: "Escape" })
      expect(within(dialog).queryByText("aiChat.deck.noMatches")).toBeNull()
      expect(input.value).toBe("Keep the unsent draft /no-such-skill")
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.keyDown(input, { key: "Escape" })
      expect(onClose).toHaveBeenCalledOnce()
      unmount()
    } finally {
      host.remove()
    }
  })

  it("updates starters with page context and preserves an unsent question without sending", () => {
    const onSendMessage = vi.fn()
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} context={{ module: "settings", activeTab: "imports" }} />)
    expect(screen.getByRole("button", { name: "aiChat.starters.importReview.label" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "aiChat.quickActions.salesSummary" })).toBeNull()
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Keep my question" } })
    fireEvent.click(screen.getByRole("button", { name: "aiChat.starters.sourceHistory.label" }))
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("Keep my question\n\naiChat.starters.sourceHistory.prompt")
    rerender(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} context={{ route: "/sales" }} />)
    expect(screen.getByRole("button", { name: "aiChat.starters.quotationHelp.label" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "aiChat.starters.importReview.label" })).toBeNull()
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("Keep my question\n\naiChat.starters.sourceHistory.prompt")
    expect(onSendMessage).not.toHaveBeenCalled()
    rerender(<AIChatPanel open docked onClose={vi.fn()} onSendMessage={onSendMessage} context={{ route: "/sales" }} />)
    expect(screen.queryByRole("button", { name: "aiChat.starters.quotationHelp.label" })).toBeNull()
    expect(screen.queryByRole("group", { name: "aiChat.quickActions.label" })).toBeNull()
  })

  it("prepares ERP actions without sending or replacing unsent work, including after a reply", async () => {
    const onSendMessage = vi.fn()
    render(<AIChatPanel open docked onClose={vi.fn()} onSendMessage={onSendMessage} initialMessages={[{ id: "saved", role: "assistant", content: "Review this invoice.", timestamp: new Date() }]} />)
    await screen.findByText("Review this invoice.")
    const input = screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "Keep my invoice question" } })
    fireEvent.click(screen.getByRole("button", { name: "aiChat.deck.cards" }))
    fireEvent.click(screen.getByRole("button", { name: "aiChat.quickActions.createDraft" }))
    expect(input.value).toBe("Keep my invoice question")
    expect(screen.getByRole("button", { name: "aiChat.quickActions.createDraft" }).getAttribute("aria-pressed")).toBe("true")
    expect(document.activeElement).toBe(input)
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId("erp-ai-chat-message-assistant").textContent).toContain("Review this invoice.")
  })

  it("finds configured skills with slash, selects several without sending, and sends their prompts together", async () => {
    const onSendMessage = vi.fn(async () => ({ content: "Prepared for review." }))
    render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} config={{ skills: [
      { id: "bank", label: "Reconcile accounts", prompt: "Review reconciliation differences.", keywords: ["bank"] },
    ] }} />)
    const input = screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "Keep this question /bank" } })
    expect(screen.getByRole("button", { name: "Reconcile accounts" }).getAttribute("data-active")).toBe("true")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input.value).toBe("Keep this question ")
    expect(onSendMessage).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: "Keep this question /report" } })
    fireEvent.keyDown(input, { key: "Tab" })
    expect(within(screen.getByRole("group", { name: "aiChat.quickActions.label" })).getByRole("button", { name: "aiChat.quickActions.generateReport" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getAllByRole("button", { name: "aiChat.deck.remove" })).toHaveLength(2)
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledExactlyOnceWith("Keep this question\n\naiChat.quickActions.reportPrompt\n\nReview reconciliation differences."))
  })

  it("cycles slash matches without sending and keeps an unmatched query available to edit", () => {
    const onSendMessage = vi.fn()
    render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} />)
    const input = screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "/" } })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getByRole("button", { name: "aiChat.quickActions.findRecords" }).getAttribute("data-active")).toBe("true")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input.value).toBe("")
    expect(screen.getByRole("button", { name: "aiChat.quickActions.findRecords" }).getAttribute("aria-pressed")).toBe("true")
    fireEvent.change(input, { target: { value: "/no-such-skill" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSendMessage).not.toHaveBeenCalled()
    expect(input.value).toBe("/no-such-skill")
    expect(screen.getByText("aiChat.deck.noMatches")).toBeTruthy()
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByText("aiChat.deck.noMatches")).toBeNull()
  })

  it("removes a selected skill without changing the typed draft or an in-progress slash query", () => {
    render(<AIChatPanel open onClose={vi.fn()} />)
    const input = screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement
    fireEvent.click(screen.getByRole("button", { name: "aiChat.deck.cards" }))
    fireEvent.click(screen.getByRole("button", { name: "aiChat.quickActions.createDraft" }))
    fireEvent.change(input, { target: { value: "Keep this /find" } })
    fireEvent.click(screen.getByRole("button", { name: "aiChat.deck.remove" }))
    expect(input.value).toBe("Keep this /find")
    expect(screen.queryByRole("group", { name: "aiChat.deck.selected" })).toBeNull()
  })

  it("restores a failed request without duplicating selected skill prompts on retry", async () => {
    const onSendMessage = vi.fn().mockRejectedValueOnce(new Error("Retry this request")).mockResolvedValue({ content: "Prepared." })
    render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} />)
    fireEvent.click(screen.getByRole("button", { name: "aiChat.deck.cards" }))
    fireEvent.click(screen.getByRole("button", { name: "aiChat.quickActions.createDraft" }))
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "New invoice" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("New invoice"))
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2))
    expect(onSendMessage.mock.calls[0]?.[0]).toBe("New invoice\n\naiChat.quickActions.createDraftPrompt")
    expect(onSendMessage.mock.calls[1]?.[0]).toBe(onSendMessage.mock.calls[0]?.[0])
  })

  it("uses the full dialog layout for error help even when side chat is requested", () => {
    render(<AIChatPanel open docked modal onClose={vi.fn()} />)
    expect(screen.getByTestId("erp-ai-chat-panel").getAttribute("data-mode")).toBe("full")
  })

  it("starts a file-only drop without sending or replacing an unsent question", async () => {
    const onImportFiles = vi.fn(async () => {})
    const onSendMessage = vi.fn()
    const file = new File(["name\nEggs"], "products.csv", { type: "text/csv" })
    render(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} onImportFiles={onImportFiles} onSendMessage={onSendMessage} importCompanyLabel="Mugisha Farm" importTaskContent={<div>Saved farm task</div>} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Keep this question" } })
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), { dataTransfer: { types: ["Files"], files: [file] } })
    await waitFor(() => expect(onImportFiles).toHaveBeenCalledExactlyOnceWith([file]))
    expect(onSendMessage).not.toHaveBeenCalled()
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("Keep this question")
    expect(screen.getByTestId("erp-ai-chat-import-tasks").textContent).toContain("Saved farm task")
    expect(screen.getByTitle("Mugisha Farm")).toBeTruthy()
  })

  it("opens current context in side chat without resetting the composer", async () => {
    render(<AIChatPanel open docked onClose={vi.fn()} context={{
      activeView: "Sales",
      selectedData: { selectionSummary: "Quotation SO-023" },
    }} />)
    const input = screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "Keep my question" } })
    fireEvent.click(screen.getByRole("button", { name: "aiChat.workspace.context" }))
    const popover = await screen.findByRole("dialog", { name: "aiChat.workspace.context" })
    expect(within(popover).getByText("Quotation SO-023")).toBeTruthy()
    fireEvent.keyDown(popover, { key: "Escape" })
    expect(input.value).toBe("Keep my question")
  })

  it("accepts multiple files from the picker and clears it for future selection", async () => {
    const onImportFiles = vi.fn(async () => {})
    render(<AIChatPanel open docked onClose={vi.fn()} config={{ enableFileUpload: true }} onImportFiles={onImportFiles} importFileNames={["saved-counts.csv"]} />)
    expect(screen.queryByRole("button", { name: "aiChat.workspace.addFiles" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^aiChat\.workspace\.files/ }))
    expect(screen.getByRole("listitem").textContent).toContain("saved-counts.csv")
    const files = [new File(["name\nEggs"], "products.csv"), new File(["workbook"], "counts.XLSX")]
    const input = screen.getByTestId("erp-ai-chat-file-input") as HTMLInputElement
    const click = vi.spyOn(input, "click")
    fireEvent.click(screen.getByTestId("erp-ai-chat-attach"))
    expect(click).toHaveBeenCalledOnce()
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(onImportFiles).toHaveBeenCalledExactlyOnceWith(files))
    expect(input.value).toBe("")
  })

  it("respects upload configuration and unavailable intake without dispatching", async () => {
    const onImportFiles = vi.fn(async () => {})
    const file = new File(["name\nEggs"], "products.csv")
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} onImportFiles={onImportFiles} />)
    expect(screen.queryByTestId("erp-ai-chat-attach")).toBeNull()
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), { dataTransfer: { types: ["Files"], files: [file] } })
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.unavailable")
    rerender(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} />)
    expect((screen.getByTestId("erp-ai-chat-attach") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), { dataTransfer: { types: ["Files"], files: [file] } })
    expect(onImportFiles).not.toHaveBeenCalled()
  })

  it("leaves ordinary text drags alone", () => {
    const onImportFiles = vi.fn(async () => {})
    render(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} onImportFiles={onImportFiles} />)
    const completed = fireEvent.drop(screen.getByTestId("erp-ai-chat-input"), { dataTransfer: { types: ["text/plain"], files: [] } })
    expect(completed).toBe(true)
    expect(onImportFiles).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("rejects unsupported, oversized, empty, and excessive file selections before dispatch", () => {
    const onImportFiles = vi.fn(async () => {})
    render(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} onImportFiles={onImportFiles} />)
    const drop = (files: File[]) => fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), { dataTransfer: { types: ["Files"], files } })
    drop([new File(["text"], "instructions.pdf")])
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.unsupportedFile")
    drop([new File([], "empty.csv")])
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.emptyFile")
    drop([new File([new Uint8Array(5_000_001)], "large.csv")])
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.fileTooLarge")
    drop(Array.from({ length: 21 }, (_, index) => new File(["row"], `${index}.csv`)))
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.tooManyFiles")
    drop(Array.from({ length: 5 }, (_, index) => new File([new Uint8Array(4_000_001)], `${index}.csv`)))
    expect(screen.getByRole("alert").textContent).toBe("aiChat.import.totalTooLarge")
    expect(onImportFiles).not.toHaveBeenCalled()
  })

  it("prevents duplicate intake while preparing and shows a recoverable failure", async () => {
    let reject!: (error: Error) => void
    const onImportFiles = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    render(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} onImportFiles={onImportFiles} />)
    const transfer = { dataTransfer: { types: ["Files"], files: [new File(["name\nEggs"], "products.csv")] } }
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), transfer)
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), transfer)
    expect(onImportFiles).toHaveBeenCalledOnce()
    expect(screen.getByRole("status").textContent).toBe("aiChat.import.savingAttachments")
    expect((screen.getByTestId("erp-ai-chat-attach") as HTMLButtonElement).disabled).toBe(true)
    await act(async () => reject(new Error("Check the saved task before retrying.")))
    expect(screen.getByRole("alert").textContent).toBe("Check the saved task before retrying.")
    expect((screen.getByTestId("erp-ai-chat-attach") as HTMLButtonElement).disabled).toBe(false)
  })

  it("hides late intake failures after changing the actor or company scope", async () => {
    let reject!: (error: Error) => void
    const onImportFiles = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} context={{ companyId: 7 }} importScopeKey="actor-one:org-one:7" onImportFiles={onImportFiles} />)
    fireEvent.drop(screen.getByTestId("erp-ai-chat-panel"), { dataTransfer: { types: ["Files"], files: [new File(["private"], "products.csv")] } })
    rerender(<AIChatPanel open onClose={vi.fn()} config={{ enableFileUpload: true }} context={{ companyId: 8 }} importScopeKey="actor-two:org-one:8" onImportFiles={onImportFiles} />)
    await act(async () => reject(new Error("Private old company failure")))
    expect(screen.queryByText("Private old company failure")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
    expect((screen.getByTestId("erp-ai-chat-attach") as HTMLButtonElement).disabled).toBe(false)
  })

  it("prepares an error question once without replacing an unsent draft or dispatching it", () => {
    const onSendMessage = vi.fn()
    const request = { id: "error-1", text: "Explain this ERP error using current authorized evidence.\nDisplayed error: Cannot post" }
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "My earlier unsent question" } })
    rerender(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} composerRequest={request} />)
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe(`My earlier unsent question\n\n${request.text}`)
    rerender(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} composerRequest={{ ...request }} />)
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe(`My earlier unsent question\n\n${request.text}`)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it("keeps the same composer while error help opens in a keyboard-accessible modal", async () => {
    const onSendMessage = vi.fn()
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Earlier draft" } })
    rerender(<AIChatPanel open modal onClose={vi.fn()} onSendMessage={onSendMessage} composerRequest={{ id: "error-2", text: "Explain the error" }} />)
    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("Earlier draft\n\nExplain the error")
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it("reports unavailable assistance without inventing financial data when no transport is configured", async () => {
    render(<AIChatPanel open onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "@sales sales summary" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await screen.findByText("aiChat.turn.notConfigured")
    expect(screen.queryByText(/284,392|1,847|Revenue:/)).toBeNull()
  })


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

  it("does not publish an old scope's late answer into a new scoped panel", async () => {
    let resolve!: (reply: { content: string }) => void
    const oldSend = vi.fn(() => new Promise<{ content: string }>((done) => { resolve = done }))
    const { rerender } = render(<AIChatPanel key="company-7" open onClose={vi.fn()} onSendMessage={oldSend} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "Private company seven question" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    rerender(<AIChatPanel key="company-8" open onClose={vi.fn()} initialMessages={[]} />)
    await act(async () => { resolve({ content: "Private company seven answer" }) })
    expect(screen.queryByText("Private company seven question")).toBeNull()
    expect(screen.queryByText("Private company seven answer")).toBeNull()
    expect((screen.getByTestId("erp-ai-chat-input") as HTMLTextAreaElement).value).toBe("")
  })
  it("shows history-save failure without hiding the available answer", async () => {
    const onSendMessage = vi.fn(async () => ({ content: "Review the posted invoices first." }))
    const { rerender } = render(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} />)
    fireEvent.change(screen.getByTestId("erp-ai-chat-input"), { target: { value: "What should I review?" } })
    fireEvent.click(screen.getByTestId("erp-ai-chat-send"))
    await screen.findByText("Review the posted invoices first.")
    rerender(<AIChatPanel open onClose={vi.fn()} onSendMessage={onSendMessage} historySaveFailed />)
    expect(screen.getByRole("alert").textContent).toBe("aiChat.historySaveFailed")
    expect(screen.getByText("Review the posted invoices first.")).toBeTruthy()
    expect(onSendMessage).toHaveBeenCalledOnce()
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
      screen.getByRole("combobox", { name: "aiChat.workspace.contextSelect" }),
      "module:inventory",
    )
    expect(onContextChange).toHaveBeenCalledWith("module:inventory")
    fireEvent.click(screen.getByRole("button", { name: "aiChat.workspace.dockBesideErp" }))
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
