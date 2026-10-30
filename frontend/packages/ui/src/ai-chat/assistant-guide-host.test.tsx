import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { GuideDocument } from "../lib/assistant-guide-types"

const controls = vi.hoisted(() => ({
  identity: "alice", companyId: 7, params: new URLSearchParams("companyId=7"),
  read: vi.fn(), history: vi.fn(), save: vi.fn(), ask: vi.fn(), push: vi.fn(), replace: vi.fn(),
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: controls.t }) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ organizationId: 1, identity: controls.identity }) }))
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({ useOperatingCompanyId: () => controls.companyId }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: controls.push, replace: controls.replace }), useSearchParams: () => controls.params }))
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock("@lumiere/ui", async () => {
  const viewer = await import("./assistant-guide-viewer")
  return { AssistantGuideModal: viewer.AssistantGuideModal, AssistantGuideViewer: viewer.AssistantGuideViewer }
})
vi.mock("@/lib/assistant-guide-context", () => ({ useAssistantGuideConversation: () => ({ ready: true, ask: controls.ask }) }))
vi.mock("@/lib/assistant-guides", async (actual) => ({
  ...(await actual<typeof import("../../../../web/lib/assistant-guides")>()),
  readAssistantGuide: controls.read, assistantGuideHistory: controls.history, saveAssistantGuide: controls.save,
}))
import { GuideRequestError } from "../../../../web/lib/assistant-guides"
import { AssistantGuideHost } from "../../../../web/components/assistant-guide-host"
import { AssistantGuidePageClient } from "../../../../web/app/(modules)/documents/knowledge/[id]/guide-page-client"

const saved: GuideDocument = { guideId: "42", revision: 1, headRevision: 1, reviewState: "draft", canWrite: true,
  draftKey: "guide-test", title: "Original guide", markdown: "Original instructions", companyId: "7", module: "accounting", sources: [] }
const request = { messageId: "message-1", reference: { guideId: "42", revision: 1 } }

beforeEach(() => {
  controls.identity = "alice"; controls.companyId = 7; controls.params = new URLSearchParams("companyId=7")
  controls.t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  controls.read.mockReset().mockResolvedValue(saved)
  controls.history.mockReset().mockResolvedValue([saved])
  controls.save.mockReset(); controls.ask.mockReset(); controls.push.mockReset(); controls.replace.mockReset()
})
afterEach(cleanup)

for (const owner of ["modal", "page"] as const) describe(`${owner} guide revalidation`, () => {
  const tree = () => owner === "modal"
    ? <AssistantGuideHost request={request} companyId={controls.companyId} organizationId={1} onClose={vi.fn()} onSaved={vi.fn()} onAsk={controls.ask} />
    : <AssistantGuidePageClient guideId="42" />

  it("retains title, Markdown and question after transient failure, then retries the exact revision", async () => {
    render(tree())
    fireEvent.click(await screen.findByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retain my title" } })
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Retain my edits" } })
    fireEvent.change(screen.getByLabelText("Ask about this document"), { target: { value: "Retain my question" } })
    controls.read.mockRejectedValueOnce(new GuideRequestError("temporarily unavailable", 503))
    fireEvent.focus(window)
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("edits are retained"))
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Retain my title")
    expect(screen.getByLabelText("Guide content (Markdown)")).toHaveProperty("value", "Retain my edits")
    expect(screen.getByLabelText("Ask about this document")).toHaveProperty("value", "Retain my question")
    expect(screen.getByRole("button", { name: "Save new revision" })).toHaveProperty("disabled", true)
    controls.read.mockResolvedValue({ ...saved, headRevision: 2 })
    fireEvent.click(screen.getByRole("button", { name: "Retry access check" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry access check" })).toBeNull())
    expect(controls.read).toHaveBeenLastCalledWith({ guideId: "42", revision: 1 }, "7", expect.any(AbortSignal))
    expect(screen.getByLabelText("Guide content (Markdown)")).toHaveProperty("value", "Retain my edits")
    expect(screen.getByLabelText("Ask about this document")).toHaveProperty("value", "Retain my question")
    expect(screen.getByRole("button", { name: "Save new revision" })).toHaveProperty("disabled", false)
  })

  it("ignores an older denied result after a newer access check succeeds", async () => {
    render(tree())
    fireEvent.click(await screen.findByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Keep this working draft" } })
    let rejectOld!: (cause: Error) => void
    controls.read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    controls.read.mockResolvedValue({ ...saved, headRevision: 2 })
    fireEvent.focus(window)
    fireEvent.focus(window)
    await screen.findByText("A newer revision is available")
    await act(async () => { rejectOld(new GuideRequestError("old denial", 403)) })
    expect(screen.getByLabelText("Guide content (Markdown)")).toHaveProperty("value", "Keep this working draft")
    expect(screen.queryByRole("button", { name: "Retry access check" })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("does not replace an acknowledged save with an older background read", async () => {
    render(tree())
    fireEvent.click(await screen.findByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Acknowledged new instructions" } })
    let resolveOld!: (value: GuideDocument) => void
    controls.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    fireEvent.focus(window)
    controls.save.mockResolvedValue({ ...saved, revision: 2, headRevision: 2, markdown: "Acknowledged new instructions" })
    fireEvent.click(screen.getByRole("button", { name: "Save new revision" }))
    await waitFor(() => expect(screen.getByTestId("assistant-guide-save-state").textContent).not.toBe("Unsaved changes"))
    await act(async () => { resolveOld(saved) })
    expect(screen.queryByText("Original instructions")).toBeNull()
    expect(screen.getByText("Acknowledged new instructions")).toBeTruthy()
    controls.read.mockResolvedValue({ ...saved, revision: 2, headRevision: 2, markdown: "Acknowledged new instructions" })
    fireEvent.focus(window)
    await waitFor(() => expect(controls.read).toHaveBeenLastCalledWith({ guideId: "42", revision: 2 }, "7", expect.any(AbortSignal)))
  })

  it("offers an explicit retry after an initial unavailable read", async () => {
    controls.read.mockRejectedValueOnce(new GuideRequestError("Initial dependency unavailable", 503))
    render(tree())
    fireEvent.click(await screen.findByRole("button", { name: "Retry access check" }))
    await screen.findByTestId("assistant-guide-viewer")
    expect(screen.queryByRole("button", { name: "Retry access check" })).toBeNull()
  })

  if (owner === "modal") it("retains a dirty editor when display translations change", async () => {
    const view = render(tree())
    fireEvent.click(await screen.findByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Keep edits while changing preferences" } })
    controls.t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
    view.rerender(tree())
    expect(screen.getByLabelText("Guide content (Markdown)")).toHaveProperty("value", "Keep edits while changing preferences")
    expect(controls.read).toHaveBeenCalledOnce()
  })

  it("removes protected content after an authoritative denial and can reopen when access returns", async () => {
    render(tree())
    await screen.findByTestId("assistant-guide-viewer")
    controls.read.mockRejectedValueOnce(new GuideRequestError("access revoked", 403))
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByTestId("assistant-guide-viewer")).toBeNull())
    expect(screen.queryByText("Original instructions")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry access check" }))
    await screen.findByTestId("assistant-guide-viewer")
    expect(screen.getByText("Original instructions")).toBeTruthy()
  })

  it("clears the previous actor's document while the new actor's read is pending", async () => {
    const view = render(tree())
    await screen.findByTestId("assistant-guide-viewer")
    controls.read.mockImplementation(() => new Promise(() => {}))
    controls.identity = "bob"
    view.rerender(tree())
    await waitFor(() => expect(screen.queryByTestId("assistant-guide-viewer")).toBeNull())
    expect(screen.queryByText("Original instructions")).toBeNull()
  })
})
