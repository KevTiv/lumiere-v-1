import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BillSourceDocuments, type BillSourceDocumentsProps } from "./bill-source-documents"
import { billSourceDocuments } from "../lib/bill-source-document-model"

vi.mock("@lumiere/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lumiere/i18n")>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; [name: string]: unknown }) =>
        options?.defaultValue ? actual.i18n.t(key, { ...options, lng: "en" }) : key,
    }),
  }
})
afterEach(cleanup)
const document = { id: 5n, organizationId: 1n, companyId: 2n, resModel: "account_move", resId: 3n, name: "Supplier receipt", isDeleted: false }
const props = (overrides: Partial<BillSourceDocumentsProps> = {}): BillSourceDocumentsProps => ({ organizationId: 1n, companyId: 2n, billId: 3n, documents: [document], sourceState: { status: "ready" }, onUpload: vi.fn().mockResolvedValue(undefined), onRefresh: vi.fn(), ...overrides })
const file = () => new File(["receipt bytes"], "receipt.pdf", { type: "application/pdf" })
const choose = (chosen = file()) => fireEvent.change(screen.getByLabelText("Receipt or supplier document (PDF or image, up to 20 MB)"), { target: { files: [chosen] } })

describe("manual bill source document path", () => {
  it("shows only canonical linked documents with internal review links", () => {
    render(<BillSourceDocuments {...props({ documents: [document, { ...document, id: 6n, companyId: 8n, name: "Other company" }, { ...document, id: 7n, isDeleted: true, name: "Deleted" }] })} />)
    expect(screen.getByRole("link", { name: "Supplier receipt" }).getAttribute("href")).toBe("/documents/5")
    expect(screen.queryByText("Other company")).toBeNull()
    expect(screen.queryByText("Deleted")).toBeNull()
    expect(billSourceDocuments([{ ...document, companyId: undefined }], props())).toBeNull()
  })

  it("hides cached attachments and inputs on denied or partial reads and allows retry", () => {
    const retry = vi.fn()
    const { rerender } = render(<BillSourceDocuments {...props({ sourceState: { status: "denied" } })} />)
    expect(screen.queryByText("Supplier receipt")).toBeNull()
    expect(screen.queryByRole("button", { name: "Attach to this bill" })).toBeNull()
    rerender(<BillSourceDocuments {...props({ sourceState: { status: "partial", onRetry: retry } })} />)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Supplier receipt")).toBeNull()
  })

  it("passes the selected local file to the managed callback and blocks duplicate clicks while pending", async () => {
    let complete!: () => void
    const onUpload = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    render(<BillSourceDocuments {...props({ onUpload })} />)
    const chosen = file(); choose(chosen)
    fireEvent.click(screen.getByRole("button", { name: "Attach to this bill" }))
    expect(onUpload).toHaveBeenCalledWith(chosen)
    expect((screen.getByRole("button", { name: "Attaching…" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Refresh documents" }) as HTMLButtonElement).disabled).toBe(true)
    complete()
    await waitFor(() => expect(screen.getByRole("button", { name: "Attach to this bill" })).toBeTruthy())
  })

  it("keeps an uncertain attempt blocked and exposes refresh without claiming success", () => {
    const onRefresh = vi.fn()
    render(<BillSourceDocuments {...props({ uploadState: { phase: "unknown" }, onRefresh })} />)
    expect(screen.getByRole("alert").textContent).toContain("submission is unverified")
    expect((screen.getByRole("button", { name: "Attach to this bill" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Refresh documents" }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it("clears selected file on a company change and rejects unsupported files", async () => {
    const onUpload = vi.fn()
    const { rerender } = render(<BillSourceDocuments {...props({ onUpload })} />)
    choose(new File(["<script>"], "receipt.html", { type: "text/html" }))
    fireEvent.click(screen.getByRole("button", { name: "Attach to this bill" }))
    expect(screen.getByRole("alert").textContent).toContain("Choose a non-empty PDF")
    expect(onUpload).not.toHaveBeenCalled()
    choose()
    rerender(<BillSourceDocuments {...props({ companyId: 4n, onUpload })} />)
    expect((screen.getByRole("button", { name: "Attach to this bill" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText("Supplier receipt")).toBeNull()
  })
})
