import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CsvImportModal } from "./csv-import-modal"
import type { FormConfig } from "../lib/form-types"

const toast = vi.hoisted(() => vi.fn())
const tracked = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }))
vi.mock("@lumiere/query-hooks/hooks/tracked-csv-import", () => ({ useTrackedCsvImport: () => tracked }))
vi.mock("../import-assistant/csv-import-result", () => ({ CsvImportResult: ({ request }: { request: { requestId: string } }) => <div>Exact submission {request.requestId}</div> }))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toast }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("../import-assistant/csv-import-history", () => ({ CsvImportHistory: () => <div>Organization import history</div> }))
vi.mock("./dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))
const config = { title: "Import employees", submitLabel: "Import", fields: [] } as FormConfig
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function chooseFile() {
  const file = new File(["name\nAda\n"], "employees.csv", { type: "text/csv" })
  Object.defineProperty(file, "text", { value: async () => "name\nAda\n" })
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } })
  await waitFor(() => expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(false))
}

describe("CSV submission outcomes", () => {
  it("shows abandoned accounting cleanup history before a new submission", () => {
    render(
      <CsvImportModal
        config={config}
        organizationId={1n}
        tableName="account_move_line"
        abandonedAccountingCleanup={{ companyId: 7n, authorized: true, onCleanup: vi.fn() }}
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText("Organization import history")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy()
  })

  it("keeps the dialog open for history and prevents duplicate submission after acceptance", async () => {
    const onClose = vi.fn()
    const onImport = vi.fn().mockResolvedValue(undefined)
    render(<CsvImportModal config={config} organizationId={1n} tableName="hr_employee" onImport={onImport} onClose={onClose} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await screen.findByText("Organization import history")
    expect(onClose).not.toHaveBeenCalled()
    expect(onImport).toHaveBeenCalledWith("name\nAda\n")
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: "info" }))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it("preserves the selected file and displays reducer failure instead of opening history", async () => {
    const onClose = vi.fn()
    render(<CsvImportModal config={config} organizationId={1n} onImport={async () => { throw new Error("Permission denied") }} onClose={onClose} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await screen.findByText("Permission denied")
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText("Organization import history")).toBeNull()
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

  it("uses an optional app spreadsheet reader and submits its converted CSV", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    const fileReader = vi.fn().mockResolvedValue({ csvText: "name\nAda\n" })
    render(
      <CsvImportModal
        config={config}
        fileReader={fileReader}
        onImport={onImport}
        onClose={vi.fn()}
      />,
    )
    const file = new File(["workbook"], "employees.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    fireEvent.change(screen.getByLabelText("CSV or Excel file"), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Import" }))

    await waitFor(() => expect(onImport).toHaveBeenCalledWith("name\nAda\n"))
    expect(fileReader).toHaveBeenCalledWith(file)
  })

})
