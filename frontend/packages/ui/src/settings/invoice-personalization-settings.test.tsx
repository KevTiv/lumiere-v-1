import { chooseSelectValue } from "../components/select-test-utils"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { resolveInvoiceProfile, type InvoiceProfileVersion } from "@lumiere/erp-shared/invoice-personalization"
import type { InvoiceProfileSaveInput, InvoiceProfileSaveOutcome } from "@lumiere/query-hooks/hooks/invoice-personalization"
import { InvoicePersonalizationEditor, InvoicePersonalizationSettings, type InvoicePersonalizationEditorProps } from "./invoice-personalization-settings"

const permissions = vi.hoisted(() => new Set(["document_template:read", "document_template:create", "organization:write", "company:write"]))
const publish = vi.hoisted(() => vi.fn())
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ permissionsReady: true, checkPermission: (resource: string, action: string) => ({ allowed: permissions.has(`${resource}:${action}`) }) }) }))
vi.mock("@lumiere/query-hooks/hooks/invoice-personalization", async (original) => ({
  ...await original<typeof import("@lumiere/query-hooks/hooks/invoice-personalization")>(),
  useInvoicePersonalization: () => ({ profile: resolveInvoiceProfile(), organizationVersion: null, companyVersion: null, state: { status: "ready" }, refetch: vi.fn() }),
  useSaveInvoicePersonalizationVersion: () => ({ mutateAsync: publish }),
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))

beforeAll(() => { Element.prototype.scrollIntoView ??= () => {} })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); permissions.clear(); for (const key of ["document_template:read", "document_template:create", "organization:write", "company:write"]) permissions.add(key) })
const version = (id: string, companyId: string | null, values: InvoiceProfileVersion["values"]): InvoiceProfileVersion => ({ id, organizationId: "1", companyId, name: `Version ${id}`, values })
const saved = (input: InvoiceProfileSaveInput): InvoiceProfileSaveOutcome => ({ status: "saved", submission: { ...input, name: "Invoice profile test" }, version: version("11", input.companyId, input.values), isCurrent: true })
function props(overrides: Partial<InvoicePersonalizationEditorProps> = {}): InvoicePersonalizationEditorProps {
  return { organizationId: 1, companyId: "2", companyName: "Alpha company", company: { name: "Canonical Alpha", addressStreet: "Main street", taxId: "TIN-1" },
    state: { status: "ready" }, profile: resolveInvoiceProfile({ terms: "Organization terms" }),
    organizationVersion: version("1", null, { terms: "Organization terms" }), companyVersion: version("10", "2", {}),
    canPublishCompany: true, canPublishOrganization: true, onSave: vi.fn(async (input) => saved(input)), onCheck: vi.fn(), ...overrides }
}
function customizeTerms(text: string) {
  chooseSelectValue(
    screen.getByRole("combobox", { name: "Terms source" }),
    "custom",
  )
  fireEvent.change(screen.getByTestId("invoice-profile-terms"), { target: { value: text } })
}
const clickSave = () => fireEvent.click(screen.getByTestId("invoice-profile-save"))
const terms = () => screen.getByTestId("invoice-profile-terms") as HTMLElement & { value: string }

describe("invoice personalization settings", () => {
  it("inherits organization defaults and publishes an explicit empty company override only after readback", async () => {
    const input = props()
    render(<InvoicePersonalizationEditor {...input} />)
    expect(terms().value).toBe("Organization terms")
    expect(terms().getAttribute("aria-disabled")).toBe("true")
    expect(terms().getAttribute("contenteditable")).toBe("false")
    customizeTerms("")
    clickSave()
    await screen.findByText("Published version #11 for Alpha company.")
    expect(input.onSave).toHaveBeenCalledWith({ organizationId: 1, companyId: "2", expectedVersionId: "10", values: { terms: "" } })
  })
  it("restores inheritance by publishing a new empty values object", async () => {
    const input = props({ companyVersion: version("10", "2", { terms: "Company terms" }) })
    render(<InvoicePersonalizationEditor {...input} />)
    fireEvent.click(screen.getByRole("button", { name: "Restore inheritance" }))
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith({ organizationId: 1, companyId: "2", expectedVersionId: "10", values: {} }))
  })
  it("retains dirty edits across a newer read and requires explicit reload instead of stale publication", async () => {
    const input = props()
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    customizeTerms("My unpublished terms")
    rerender(<InvoicePersonalizationEditor {...input} companyVersion={version("12", "2", { terms: "New current terms" })} />)
    expect(terms().value).toBe("My unpublished terms")
    expect(screen.getByText(/A newer version was published/)).toBeTruthy()
    const save = screen.getByTestId("invoice-profile-save") as HTMLButtonElement
    expect(save.disabled).toBe(true)
    save.disabled = false; fireEvent.click(save)
    expect(input.onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Reload latest version" }))
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(terms().value).toBe("New current terms"))
  })
  it("hides stale content when access fails and preserves the draft for ready recovery", () => {
    const input = props()
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    customizeTerms("Sensitive company draft")
    rerender(<InvoicePersonalizationEditor {...input} state={{ status: "denied" }} />)
    expect(screen.queryByTestId("invoice-profile-terms")).toBeNull()
    expect(screen.queryByText("Sensitive company draft")).toBeNull()
    expect((screen.getByTestId("invoice-profile-save") as HTMLButtonElement).disabled).toBe(true)
    rerender(<InvoicePersonalizationEditor {...input} />)
    expect(terms().value).toBe("Sensitive company draft")
    expect(input.onSave).not.toHaveBeenCalled()
  })
  it("holds a dirty draft on company switch, then discards explicitly into the exact new company", async () => {
    const input = props()
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    customizeTerms("Old company draft")
    rerender(<InvoicePersonalizationEditor {...input} companyId="3" companyName="Beta company" companyVersion={version("20", "3", { terms: "Beta terms" })} />)
    expect(screen.getByText(/The selected company changed/)).toBeTruthy()
    expect(screen.queryByTestId("invoice-profile-terms")).toBeNull()
    expect(input.onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Discard edits and use selected company" }))
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(terms().value).toBe("Beta terms"))
    customizeTerms("Beta draft")
    clickSave()
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith({ organizationId: 1, companyId: "3", expectedVersionId: "20", values: { terms: "Beta draft" } }))
  })
  it("does not apply an old company’s delayed save to the newly selected company", async () => {
    let finish!: (outcome: InvoiceProfileSaveOutcome) => void
    const onSave = vi.fn((_: InvoiceProfileSaveInput) => new Promise<InvoiceProfileSaveOutcome>((resolve) => { finish = resolve }))
    const input = props({ onSave })
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    customizeTerms("Alpha pending")
    clickSave()
    const oldInput = onSave.mock.calls[0]![0]
    rerender(<InvoicePersonalizationEditor {...input} companyId="3" companyName="Beta company" companyVersion={version("20", "3", { terms: "Beta terms" })} />)
    await act(async () => finish(saved(oldInput)))
    await waitFor(() => expect(terms().value).toBe("Beta terms"))
    expect(screen.queryByText(/Published version #11 for Beta/)).toBeNull()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(oldInput.companyId).toBe("2")
  })
  it("retains rejected edits and permits an explicit retry without a false saved state", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Publishing denied")).mockImplementationOnce(async (input: InvoiceProfileSaveInput) => saved(input))
    render(<InvoicePersonalizationEditor {...props({ onSave })} />)
    customizeTerms("Keep these edits")
    clickSave()
    await screen.findByText("Publishing denied")
    expect(terms().value).toBe("Keep these edits")
    expect(screen.queryByText(/Published version/)).toBeNull()
    clickSave()
    await screen.findByText("Published version #11 for Alpha company.")
    expect(onSave).toHaveBeenCalledTimes(2)
  })
  it("locks an unconfirmed publication and reconciles the same request even after a read denial", async () => {
    const onSave = vi.fn(async (input: InvoiceProfileSaveInput): Promise<InvoiceProfileSaveOutcome> => ({ status: "unconfirmed", submission: { ...input, name: "Exact uncertain profile" }, message: "Response lost" }))
    const onCheck = vi.fn(async (submission) => saved(submission))
    const input = props({ onSave, onCheck })
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    customizeTerms("Unknown outcome terms")
    clickSave()
    await screen.findByRole("button", { name: "Check saved version" })
    expect(screen.queryByTestId("invoice-profile-save")).toBeNull()
    expect(terms().getAttribute("aria-disabled")).toBe("true")
    expect(terms().getAttribute("contenteditable")).toBe("false")
    rerender(<InvoicePersonalizationEditor {...input} state={{ status: "denied" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Check saved version" }))
    await waitFor(() => expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ name: "Exact uncertain profile", companyId: "2", values: { terms: "Unknown outcome terms" } })))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
  it("requires actual organization write permission in addition to template creation", () => {
    permissions.delete("organization:write")
    render(<InvoicePersonalizationSettings organizationId={1} companyId={null} />)
    expect(screen.getByText(/Publishing requires document template creation/)).toBeTruthy()
    expect((screen.getByTestId("invoice-profile-save") as HTMLButtonElement).disabled).toBe(true)
    expect(publish).not.toHaveBeenCalled()
  })
  it("rejects unsupported and oversized logos before invoking managed storage", async () => {
    const uploadInvoiceLogo = vi.fn()
    render(<InvoicePersonalizationEditor {...props({ uploadInvoiceLogo })} />)
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })
    Object.defineProperty(svg, "arrayBuffer", { value: async () => new TextEncoder().encode("<svg/>").buffer })
    fireEvent.change(screen.getByTestId("invoice-profile-logoUrl"), { target: { files: [svg] } })
    await screen.findByText("Logo bytes must match PNG or JPEG content")
    const oversized = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" })
    fireEvent.change(screen.getByTestId("invoice-profile-logoUrl"), { target: { files: [oversized] } })
    await screen.findByText("Logo must be a non-empty PNG or JPEG no larger than 2 MiB")
    expect(uploadInvoiceLogo).not.toHaveBeenCalled()
  })
  it("does not start a logo upload when company changes during raster validation", async () => {
    const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(bytes.buffer)
    view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 1); view.setUint32(20, 1)
    const file = new File([bytes], "logo.png", { type: "image/png" })
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer })
    let decode!: (image: { width: number; height: number; close: () => void }) => void
    const decodeImage = vi.fn(() => new Promise((resolve) => { decode = resolve }))
    vi.stubGlobal("createImageBitmap", decodeImage)
    const uploadInvoiceLogo = vi.fn()
    const input = props({ uploadInvoiceLogo })
    const { rerender } = render(<InvoicePersonalizationEditor {...input} />)
    fireEvent.change(screen.getByTestId("invoice-profile-logoUrl"), { target: { files: [file] } })
    await waitFor(() => expect(decodeImage).toHaveBeenCalledOnce())
    rerender(<InvoicePersonalizationEditor {...input} companyId="3" companyName="Beta company" companyVersion={version("20", "3", {})} />)
    await act(async () => decode({ width: 1, height: 1, close: vi.fn() }))
    expect(uploadInvoiceLogo).not.toHaveBeenCalled()
  })
})
