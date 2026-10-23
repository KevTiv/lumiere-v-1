import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuotationDocumentDialog } from "../../../../web/app/(modules)/sales/quotation-document-dialog"

const harness = vi.hoisted(() => ({
  preview: vi.fn(), generate: vi.fn(), download: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(),
  canCreate: true, queryError: false, queryLoading: false, queryPending: false,
  session: { identity: "alice", organizationId: 7, activeCompanyId: 2, activeCompanyReady: true, companyIds: [2, 3] },
}))

vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => harness.session }))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({ useRBAC: () => ({
  permissionsReady: true, currentUser: { id: "alice" },
  checkPermission: (_resource: string, action: string) => ({ allowed: action !== "create" || harness.canCreate }),
}) }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
// The UI package does not itself depend on React Query. Resolve the web
// component's package entry so this seam mocks the same module instance.
vi.mock("../../../../web/node_modules/@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: harness.invalidate }) }))
vi.mock("@lumiere/query-hooks/hooks/quotations", () => ({
  previewQuotationDocument: (...args: unknown[]) => harness.preview(...args),
  generateQuotationDocument: (...args: unknown[]) => harness.generate(...args),
  downloadQuotationDocument: (...args: unknown[]) => harness.download(...args),
}))
vi.mock("@lumiere/query-hooks/hooks/templates", () => ({ useDocumentTemplates: () => ({
  data: harness.queryPending ? undefined : [31, 32].map((id) => ({ id, name: `Layout ${id}`, organizationId: 7, companyId: 2,
    isActive: true, model: "sale_order", reportType: "lumiere-document-layout-v1",
    metadata: JSON.stringify({ documentDesigner: { schemaVersion: 1, engine: "grapesjs", kind: "document",
      project: { assets: [], styles: [], pages: [{ frames: [{ component: { type: "wrapper", components: [{ type: "text", tagName: "p", content: "{{customer.name}}" }] } }] }] } } }),
  })), isError: harness.queryError, isLoading: harness.queryLoading, isPending: harness.queryPending, refetch: harness.refetch,
}) }))

const k = (key: string) => `sales.quotationDocument.${key}`
const preview = { html: "<h1>Customer preview</h1>", revision: "a".repeat(64), templateId: "31", templateName: "Layout 31", orderId: "9", reference: "Q-009" }
const output = { documentId: "50", downloadUrl: "/api/documents/blobs/object/7/generated/abc?sha256=" + "b".repeat(64), fileName: "quotation-9.pdf", checksum: "b".repeat(64), revision: "a".repeat(64) }
const props = { organizationId: 7, companyId: 2, identity: "alice", orderId: "9" }

beforeEach(() => {
  harness.preview.mockReset().mockResolvedValue(preview)
  harness.generate.mockReset().mockResolvedValue(output)
  harness.download.mockReset().mockResolvedValue(undefined)
  harness.refetch.mockReset()
  harness.invalidate.mockReset()
  harness.canCreate = true
  harness.queryError = false
  harness.queryLoading = false
  harness.queryPending = false
  harness.session = { identity: "alice", organizationId: 7, activeCompanyId: 2, activeCompanyReady: true, companyIds: [2, 3] }
})
afterEach(cleanup)

async function showPreview() {
  fireEvent.change(screen.getByLabelText(k("layout")), { target: { value: "31" } })
  fireEvent.click(screen.getByRole("button", { name: k("preview"), exact: true }))
  await screen.findByTitle(k("previewTitle"))
}

describe("quotation document review and save", () => {
  it("keeps a paused initial query in loading state and opens management without leaving the quotation", () => {
    harness.queryPending = true
    render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    expect(screen.getByText(k("loading"))).toBeTruthy()
    expect(screen.queryByText(k("noLayouts"))).toBeNull()
    expect(screen.getByLabelText(k("layout")).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("link", { name: k("manageTemplates") }).getAttribute("target")).toBe("_blank")
  })

  it("requires a selected preview and displays generated HTML in an inert sandbox", async () => {
    render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    expect(screen.getByRole("button", { name: k("generate"), exact: true }).hasAttribute("disabled")).toBe(true)
    await showPreview()
    expect(harness.preview).toHaveBeenCalledWith({ organizationId: 7, companyId: "2", orderId: "9", templateId: "31" }, expect.any(AbortSignal))
    const frame = screen.getByTitle(k("previewTitle"))
    expect(frame.getAttribute("sandbox")).toBe("")
    expect(frame.getAttribute("srcdoc")).toBe(preview.html)
    expect(screen.getByRole("button", { name: k("generate"), exact: true }).hasAttribute("disabled")).toBe(false)
  })

  it("submits one save on rapid clicks and downloads the saved object without rendering again", async () => {
    let finish!: (value: typeof output) => void
    harness.generate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    await showPreview()
    const save = screen.getByRole("button", { name: k("generate"), exact: true })
    act(() => { fireEvent.click(save); fireEvent.click(save) })
    expect(harness.generate).toHaveBeenCalledOnce()
    expect(harness.generate).toHaveBeenCalledWith({ organizationId: 7, companyId: "2", orderId: "9", templateId: "31" }, preview.revision)
    await act(async () => { finish(output) })
    expect(screen.getByText(k("saved"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: k("download"), exact: true }))
    await waitFor(() => expect(harness.download).toHaveBeenCalledWith(output, 7, expect.any(AbortSignal)))
    expect(harness.preview).toHaveBeenCalledOnce()
    expect(harness.generate).toHaveBeenCalledOnce()
    expect(harness.invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] })
  })

  it("discards a stale preview when selection changes while a request is in flight", async () => {
    let finish!: (value: typeof preview) => void
    harness.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(k("layout")), { target: { value: "31" } })
    fireEvent.click(screen.getByRole("button", { name: k("preview"), exact: true }))
    const signal = harness.preview.mock.calls[0]![1] as AbortSignal
    fireEvent.change(screen.getByLabelText(k("layout")), { target: { value: "32" } })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(preview) })
    expect(screen.queryByTitle(k("previewTitle"))).toBeNull()
    expect(screen.getByRole("button", { name: k("generate"), exact: true }).hasAttribute("disabled")).toBe(true)
  })

  it("closes on a company change and rejects saving the previous company preview", async () => {
    const onClose = vi.fn()
    const view = render(<QuotationDocumentDialog {...props} onClose={onClose} />)
    await showPreview()
    harness.session.activeCompanyId = 3
    view.rerender(<QuotationDocumentDialog {...props} onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: k("generate"), exact: true }))
    expect(harness.generate).not.toHaveBeenCalled()
  })

  it("cancels a pending file download when its company scope changes", async () => {
    let finish!: () => void
    harness.download.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    const view = render(<QuotationDocumentDialog {...props} onClose={onClose} />)
    await showPreview()
    fireEvent.click(screen.getByRole("button", { name: k("generate"), exact: true }))
    await screen.findByText(k("saved"))
    fireEvent.click(screen.getByRole("button", { name: k("download"), exact: true }))
    const signal = harness.download.mock.calls[0]![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    harness.session.activeCompanyId = 3
    view.rerender(<QuotationDocumentDialog {...props} onClose={onClose} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish() })
    expect(onClose).toHaveBeenCalled()
  })

  it("allows read-only preview while requiring document creation permission to save", async () => {
    harness.canCreate = false
    render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    await showPreview()
    expect(screen.getByText(k("readOnly"))).toBeTruthy()
    expect(screen.getByRole("button", { name: k("generate"), exact: true }).hasAttribute("disabled")).toBe(true)
    expect(harness.generate).not.toHaveBeenCalled()
  })

  it("offers retry for failed collection reads and requires a new preview after an unconfirmed save", async () => {
    harness.queryError = true
    harness.generate.mockRejectedValueOnce(new Error("The quotation changed"))
    const view = render(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: k("retry"), exact: true }))
    expect(harness.refetch).toHaveBeenCalledOnce()
    harness.queryError = false
    view.rerender(<QuotationDocumentDialog {...props} onClose={vi.fn()} />)
    await showPreview()
    fireEvent.click(screen.getByRole("button", { name: k("generate"), exact: true }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The quotation changed"))
    expect(screen.queryByTitle(k("previewTitle"))).toBeNull()
    expect(screen.queryByText(k("saved"))).toBeNull()
    expect(harness.generate).toHaveBeenCalledOnce()
  })
})
