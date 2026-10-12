import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CsvImportModal } from "./csv-import-modal"
import type { FormConfig } from "../lib/form-types"

const tracked = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }))
vi.mock("@lumiere/query-hooks/hooks/tracked-csv-import", () => ({ useTrackedCsvImport: () => tracked }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock("../import-assistant/csv-import-result", () => ({ CsvImportResult: ({ request }: { request: { requestId: string } }) => <div>Exact submission {request.requestId}</div> }))
vi.mock("./dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))
const config = {
  id: "csv-import-employees",
  title: "Import employees",
  submitLabel: "Import",
  sections: [{
    id: "csv-file",
    fields: [{
      id: "csvFile",
      name: "csvFile",
      type: "file",
      label: "CSV file",
      required: true,
      width: "full",
    }],
  }],
} satisfies FormConfig
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function chooseFile() {
  const file = new File(["name\nAda\n"], "employees.csv", { type: "text/csv" })
  Object.defineProperty(file, "text", { value: async () => "name\nAda\n" })
  fireEvent.change(screen.getByTestId("form-field-csvFile"), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(false))
}

describe("CSV submission outcomes", () => {
  it("uses the legacy callback only when tracked mode was not requested", async () => {
    const onClose = vi.fn()
    const onImport = vi.fn().mockResolvedValue(undefined)
    render(<CsvImportModal config={config} organizationId={1n} tableName="hr_employee" onImport={onImport} onClose={onClose} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onImport).toHaveBeenCalledWith("name\nAda\n")
  })
  it("preserves the dialog and displays a legacy reducer failure", async () => {
    const onClose = vi.fn()
    render(<CsvImportModal config={config} organizationId={1n} onImport={async () => { throw new Error("Permission denied") }} onClose={onClose} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await screen.findByText("Permission denied")
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy()
  })
  it("freezes a tracked request and never invokes the legacy callback after response loss", async () => {
    const onImport = vi.fn()
    tracked.mutateAsync.mockRejectedValue(new Error("Response lost"))
    render(<CsvImportModal config={config} organizationId={1n} tableName="hr_employee" trackedImport={{ companyId: 2n }} onImport={onImport} onClose={vi.fn()} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await screen.findByText(/Exact submission/)
    await waitFor(() => expect(tracked.mutateAsync).toHaveBeenCalledTimes(1))
    expect(onImport).not.toHaveBeenCalled()
    expect(tracked.mutateAsync.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      entity: "hr_employee", companyId: "2", fileName: "employees.csv", csvData: "name\nAda\n", requestId: expect.stringMatching(/^[a-f0-9]{32}$/),
    }))
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull()
  })
  it("fails closed for an unreviewed entity or unavailable operating company", async () => {
    const onImport = vi.fn()
    render(<CsvImportModal config={config} organizationId={1n} tableName="product_variant" trackedImport={{ companyId: 0n }} onImport={onImport} onClose={vi.fn()} />)
    const file = new File(["name\nAda\n"], "products.csv", { type: "text/csv" })
    Object.defineProperty(file, "text", { value: async () => "name\nAda\n" })
    fireEvent.change(screen.getByTestId("form-field-csvFile"), { target: { files: [file] } })
    await screen.findByText("Tracked import is unavailable for this entity or operating-company scope.")
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
    expect(onImport).not.toHaveBeenCalled()
    expect(tracked.mutateAsync).not.toHaveBeenCalled()
  })
})
