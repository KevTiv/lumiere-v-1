import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssistantGuideModal, AssistantGuideViewer, buildGuideHtmlPreview, guideMarkdownWithoutHtml } from "./assistant-guide-viewer"
import { extractGuideHtmlDerivative, isSavedGuide, safeGuideHref } from "../lib/assistant-guide-types"
import type { GuideDocument, GuideDraft } from "../lib/assistant-guide-types"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, token) => String(options?.[token] ?? token)) }),
}))

const draft: GuideDraft = { draftKey: "message:11", title: "Review a vendor bill", markdown: "## Check the supplier\n\nOpen the linked bill before changing it.", module: "accounting", companyId: "7", sources: [{ kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "11", label: "Vendor bill VB-11", href: "/accounting/11", snapshot_at: "2026-10-28T12:00:00Z" }] }
const saved: GuideDocument = { ...draft, guideId: "9007199254740993", revision: 2, headRevision: 2, reviewState: "draft", canWrite: true }

afterEach(cleanup)

describe("ERP help document viewer", () => {
  it("retains an unsaved draft and its changes when persistence fails", async () => {
    const onSave = vi.fn(async () => { throw new Error("Write permission was revoked") })
    render(<AssistantGuideViewer document={draft} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My revised bill guide" } })
    fireEvent.click(screen.getByRole("button", { name: "Save guide" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Write permission was revoked")
    expect(screen.getByTestId("assistant-guide-save-state").textContent).toBe("Unsaved draft")
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My revised bill guide")
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "My revised bill guide", companyId: "7", sources: draft.sources }), undefined)
  })

  it("uses the exact saved revision for updates and disables unchanged saves", async () => {
    const onSave = vi.fn(async () => ({ ...saved, revision: 3 }))
    render(<AssistantGuideViewer document={saved} onSave={onSave} />)
    expect((screen.getByRole("button", { name: "Save new revision" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Updated checks" } })
    expect(screen.getByTestId("assistant-guide-save-state").textContent).toBe("Unsaved changes")
    fireEvent.click(screen.getByRole("button", { name: "Save new revision" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ markdown: "Updated checks" }), 2))
  })

  it("retains an explicit HTML derivative when only the title changes", async () => {
    const onSave = vi.fn(async () => saved)
    render(<AssistantGuideViewer document={{ ...draft, html: "<h1>Bill checks</h1>" }} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed bill checks" } })
    fireEvent.click(screen.getByRole("button", { name: "Save guide" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Renamed bill checks", markdown: draft.markdown, html: "<h1>Bill checks</h1>" }), undefined))
  })

  it("keeps the ERP reference and returns a same-session explanation in the document", async () => {
    const onAsk = vi.fn(async () => "Check the approved supplier on the bill.")
    render(<AssistantGuideViewer document={saved} onAsk={onAsk} />)
    expect(screen.getByRole("link", { name: "Vendor bill VB-11" }).getAttribute("href")).toBe("/accounting/11")
    const timestamp = screen.getByText(/^Record as of /)
    expect(timestamp.getAttribute("datetime")).toBe("2026-10-28T12:00:00Z")
    expect(timestamp.textContent).not.toContain("T12:00:00Z")
    fireEvent.change(screen.getByLabelText("Ask about this document"), { target: { value: "Explain the supplier check" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("Explain the supplier check"))
    expect(await screen.findByText("Check the approved supplier on the bill.")).toBeTruthy()
  })

  it("asks about current unsaved edits without silently saving or changing source identity", async () => {
    const onAsk = vi.fn(async (_question: string, _draftOverride?: GuideDraft) => "Review this edited draft against the current bill.")
    const onSave = vi.fn()
    render(<AssistantGuideViewer document={saved} onAsk={onAsk} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My current bill checks" } })
    fireEvent.change(screen.getByLabelText("Guide content (Markdown)"), { target: { value: "Unsaved check: confirm the supplier's tax details." } })
    fireEvent.change(screen.getByLabelText("Ask about this document"), { target: { value: "Explain this check" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("Explain this check", expect.objectContaining({ title: "My current bill checks", markdown: "Unsaved check: confirm the supplier's tax details.", companyId: saved.companyId, module: saved.module, draftKey: saved.draftKey, sources: saved.sources })))
    const quotedDraft = onAsk.mock.calls[0]?.[1] as GuideDraft | undefined
    expect(quotedDraft).not.toHaveProperty("guideId")
    expect(quotedDraft).not.toHaveProperty("revision")
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId("assistant-guide-save-state").textContent).toBe("Unsaved changes")
  })

  it("requires current write permission for a saved guide", () => {
    render(<AssistantGuideViewer document={{ ...saved, canWrite: false }} onSave={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Edit guide" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Save new revision" })).toBeNull()
  })

  it("requires an explicit discard before closing a guide with unsaved edits", async () => {
    const onOpenChange = vi.fn()
    render(<AssistantGuideModal open onOpenChange={onOpenChange} document={saved} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit guide" }))
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "An unfinished edit" } })
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("An unfinished edit")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not show a body or save action for an invalid saved identity", () => {
    render(<AssistantGuideViewer document={{ ...saved, guideId: "18446744073709551616", markdown: "Protected body" }} onSave={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toContain("document reference is invalid")
    expect(screen.queryByText("Protected body")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save guide" })).toBeNull()
  })

  it("keeps raw HTML and unsafe Markdown destinations out of the ERP DOM", async () => {
    const { container } = render(<AssistantGuideViewer document={{ ...draft, markdown: '# Safe title\n\n<script>alert(1)</script>\n\n[Run](javascript:alert)\n\n<img src="https://example.com/leak">' }} />)
    await screen.findByRole("heading", { name: "Safe title" })
    expect(container.querySelector("script, img, iframe, form")).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it("renders HTML only inside a scriptless sandbox with no network or navigation", async () => {
    render(<AssistantGuideViewer document={{ ...draft, html: '<h1>Bill checks</h1><script>parent.fetch("/steal")</script><img src="https://example.com/leak"><a href="https://example.com">Open</a><form action="/erp"><button>Post</button></form>' }} />)
    fireEvent.click(screen.getByRole("button", { name: "HTML preview" }))
    const frame = await screen.findByTitle("Static HTML document preview")
    expect(frame.getAttribute("sandbox")).toBe("")
    const source = frame.getAttribute("srcdoc") ?? ""
    expect(source).toContain("default-src 'none'")
    expect(source).toContain("form-action 'none'")
    expect(source).toContain("<h1>Bill checks</h1>")
    expect(source).not.toMatch(/<script|<img|<form|href=|action=/)
  })
})

describe("guide content boundaries", () => {
  it("extracts only one closed bounded HTML fence from an admitted answer", () => {
    const html = "<h1>ERP guide</h1>"
    expect(extractGuideHtmlDerivative(`Here is the guide.\n\n\`\`\`html\n${html}\n\`\`\``)).toBe(html)
    expect(extractGuideHtmlDerivative(`~~~HTML\r\n${html}\r\n~~~`)).toBe(html)
    expect(extractGuideHtmlDerivative(`<html>${html}</html>`)).toBeUndefined()
    expect(extractGuideHtmlDerivative(`\`\`\`html\n${html}`)).toBeUndefined()
    expect(extractGuideHtmlDerivative(`\`\`\`html\n${html}\n\`\`\`\n\`\`\`html\n${html}\n\`\`\``)).toBeUndefined()
    expect(extractGuideHtmlDerivative(`\`\`\`html\n${html}\n\`\`\`\n\`\`\`js\nalert(1)\n\`\`\``)).toBeUndefined()
    expect(extractGuideHtmlDerivative(`\`\`\`html\n${"a".repeat(131_073)}\n\`\`\``)).toBeUndefined()
    expect(extractGuideHtmlDerivative(`\`\`\`html\n${"界".repeat(50_000)}\n\`\`\``)).toBeUndefined()
  })

  it("keeps Markdown formatting while disabling raw HTML, and retains literal code", () => {
    expect(guideMarkdownWithoutHtml('## Title\n<script>alert(1)</script>\n`<code>`')).toBe('## Title\n&lt;script&gt;alert(1)&lt;/script&gt;\n`<code>`')
    const html = buildGuideHtmlPreview('<meta http-equiv="refresh" content="0;url=https://example.com"><iframe src="/erp"></iframe><p onclick="alert(1)" style="background-image:url(https://example.com/leak)">Text</p>')
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("url(")
    expect(html).not.toContain("background-image")
  })

  it("only accepts safe web and application links", () => {
    expect(safeGuideHref("/accounting/11")).toBe("/accounting/11")
    for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.com", "/\\example.com", "https:\n//example.com"]) expect(safeGuideHref(value)).toBeUndefined()
  })

  it("retains u64 precision and rejects fabricated oversized identities", () => {
    expect(isSavedGuide(saved)).toBe(true)
    expect(isSavedGuide(draft)).toBe(false)
    expect(isSavedGuide({ ...saved, guideId: "18446744073709551616" })).toBe(false)
    expect(isSavedGuide({ ...saved, revision: 0 })).toBe(false)
  })
})
