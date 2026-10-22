import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BillSourcePreview } from "../../../../web/components/finance-source-preview"
const fixture = vi.hoisted(() => ({ isError: false, data: [] as Record<string, unknown>[], versions: [] as Record<string, unknown>[] }))
vi.mock("@lumiere/query-hooks/hooks/documents", () => ({ useDocuments: () => ({ ...fixture, isLoading: false }), useDocumentVersions: () => ({ data: fixture.versions, isLoading: false, isError: false }) }))
vi.mock("@lumiere/query-hooks/hooks/expenses", () => ({ useExpenseReceipts: () => ({ data: [], isError: false, isLoading: false }) }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("../../../../web/lib/expenses-create-params", () => ({ parseAttachmentIds: () => [] }))
const url = "/api/documents/blobs/object/7/eu/abcdef"
beforeEach(() => {
  fixture.isError = false
  fixture.data = [{ id: 3, organizationId: 7, companyId: 2, resModel: "account_move", resId: 9, url, mimetype: "image/png", name: "invoice.png" }]
  fixture.versions = [{ id: 1, documentId: 3, organizationId: 7, isCurrent: true, url, mimetype: "image/png", fileName: "invoice.png" }]
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }))
  URL.createObjectURL = vi.fn().mockReturnValue("blob:finance-evidence")
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe("saved Finance source previews", () => {
  it("loads saved bytes through the authenticated endpoint and releases the preview on close", async () => {
    const view = render(<BillSourcePreview organizationId={7n} companyId={2n} recordId="9" />)
    await waitFor(() => expect(screen.getByAltText("invoice.png").getAttribute("src")).toBe("blob:finance-evidence"))
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: "same-origin", cache: "no-store" }))
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:finance-evidence")
  })
  it("offers a typed native PDF viewer and fallback when the browser cannot render it", async () => {
    fixture.versions[0] = { ...fixture.versions[0], mimetype: "application/pdf", fileName: "bill.pdf" }
    render(<BillSourcePreview organizationId={7n} companyId={2n} recordId="9" />)
    await waitFor(() => expect(screen.getByTestId("finance-source-pdf").getAttribute("data")).toBe("blob:finance-evidence"))
    expect(screen.getByTestId("finance-source-pdf").getAttribute("type")).toBe("application/pdf")
    expect(screen.getByText("PDF selected. Your browser cannot display its preview.")).toBeTruthy()
  })
  it("does not show cached evidence as an empty or successful read after denial", () => {
    fixture.isError = true
    render(<BillSourcePreview organizationId={7n} companyId={2n} recordId="9" />)
    expect(screen.getByText("Evidence is unavailable. This does not mean no document is attached.")).toBeTruthy()
    expect(screen.queryByAltText("invoice.png")).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it("drops the old company preview immediately when the scope changes", async () => {
    const view = render(<BillSourcePreview organizationId={7n} companyId={2n} recordId="9" />)
    await screen.findByAltText("invoice.png")
    view.rerender(<BillSourcePreview organizationId={7n} companyId={8n} recordId="9" />)
    expect(screen.queryByAltText("invoice.png")).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:finance-evidence")
  })
})
