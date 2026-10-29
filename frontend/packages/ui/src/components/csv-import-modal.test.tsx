import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CsvImportModal } from "./csv-import-modal"
import type { FormConfig } from "../lib/form-types"
import type { CsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"

const toast = vi.hoisted(() => vi.fn())
const tracked = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }))
const receiptChecks = vi.hoisted(() => vi.fn())
vi.mock("@lumiere/query-hooks/hooks/tracked-csv-import", () => ({ useTrackedCsvImport: () => tracked }))
vi.mock("../import-assistant/csv-import-result", () => ({ CsvImportResult: ({ request, initialError, initialPending, onNewFile }: {
  request: CsvImportRequest; initialError?: string | null; initialPending?: boolean; onNewFile: () => void
}) => <div>
  <p>Exact submission {request.requestId}</p>
  {initialPending ? <p>Submission pending</p> : null}
  {initialError ? <p role="alert">{initialError}</p> : null}
  <button type="button" onClick={() => receiptChecks(request)}>Check results</button>
  <button type="button" onClick={onNewFile}>Import another file</button>
</div> }))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toast }))
vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()),  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
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

async function chooseCsv(text: string, name = "source.csv") {
  const file = new File([text], name, { type: "text/csv" })
  Object.defineProperty(file, "text", { value: async () => text })
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } })
  await screen.findByRole("region", { name: "Source control totals" })
}

describe("CSV submission outcomes", () => {
  it("requires source total review before submitting accounting rows", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined)
    render(<CsvImportModal config={config} organizationId={1n} companyId={2n} tableName="account_move_line" onImport={onImport} onClose={vi.fn()} />)
    const csv = "ref_,debit,credit\nA,25,0\nA,0,25\n"
    await chooseCsv(csv)
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("checkbox", { name: "I checked these source totals and references." }))
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(csv))
  })

  it("blocks invalid source totals and requires review again after replacing the file", async () => {
    render(<CsvImportModal config={config} tableName="account_move_line" onImport={vi.fn()} onClose={vi.fn()} />)
    await chooseCsv("debit,credit\n100,0\n0,nope\n")
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
    await chooseCsv("debit,credit\n100,0\n0,100\n")
    await waitFor(() => expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("checkbox"))
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(false)
    await chooseCsv("debit,credit\n200,0\n0,200\n")
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("prevents legacy accounting continuation under a changed company", async () => {
    const onImport = vi.fn()
    const { rerender } = render(<CsvImportModal config={config} organizationId={1n} companyId={2n} tableName="account_move_line" onImport={onImport} onClose={vi.fn()} />)
    await chooseCsv("debit,credit\n10,0\n0,10\n")
    fireEvent.click(screen.getByRole("checkbox"))
    rerender(<CsvImportModal config={config} organizationId={1n} companyId={3n} tableName="account_move_line" onImport={onImport} onClose={vi.fn()} />)
    expect(screen.getByRole("alert").textContent).toContain("Select and review the source file again")
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    expect(onImport).not.toHaveBeenCalled()
  })

  it("does not restore an asynchronously read file after its company changes", async () => {
    let resolveFile!: (text: string) => void
    const file = new File(["pending"], "pending.csv", { type: "text/csv" })
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { resolveFile = resolve }) })
    const onImport = vi.fn()
    const { rerender } = render(<CsvImportModal config={config} organizationId={1n} companyId={2n} tableName="account_move_line" onImport={onImport} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } })
    rerender(<CsvImportModal config={config} organizationId={1n} companyId={3n} tableName="account_move_line" onImport={onImport} onClose={vi.fn()} />)
    resolveFile("debit,credit\n10,0\n0,10\n")
    await waitFor(() => expect((screen.getByLabelText("CSV file") as HTMLInputElement).disabled).toBe(false))
    expect(screen.queryByRole("region", { name: "Source control totals" })).toBeNull()
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
    expect(onImport).not.toHaveBeenCalled()
  })

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

  it.each(["denied", "error", "partial", "loading"] as const)("blocks a mounted ready import when its source becomes %s", async (status) => {
    const onImport = vi.fn()
    const fileReader = vi.fn().mockResolvedValue({ csvText: "name\nAda\n" })
    const props = { config, organizationId: 1n, tableName: "hr_employee", trackedImport: { companyId: 2n }, onImport, onClose: vi.fn(), fileReader }
    const { rerender } = render(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    const file = new File(["name\nAda\n"], "employees.csv", { type: "text/csv" })
    fireEvent.change(screen.getByLabelText("CSV or Excel file"), { target: { files: [file] } })
    await screen.findByText("Ada")
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<CsvImportModal {...props} sourceState={{ status }} />)
    expect(screen.queryByText("Ada")).toBeNull()
    const submit = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement
    const input = screen.getByLabelText("CSV or Excel file") as HTMLInputElement
    expect(submit.disabled).toBe(true)
    expect(input.disabled).toBe(true)
    // The handler must guard too: DOM disablement alone cannot authorize an operation.
    submit.disabled = false
    input.disabled = false
    fireEvent.click(submit)
    fireEvent.change(input, { target: { files: [file] } })
    expect(fileReader).toHaveBeenCalledTimes(1)
    expect(tracked.mutateAsync).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
    expect(screen.queryByText(/Exact submission/)).toBeNull()
  })

  it("also guards the legacy callback after ready becomes denied", async () => {
    const onImport = vi.fn()
    const props = { config, onImport, onClose: vi.fn() }
    const { rerender } = render(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    await chooseFile()
    rerender(<CsvImportModal {...props} sourceState={{ status: "denied" }} />)
    const submit = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement
    submit.disabled = false
    fireEvent.click(submit)
    expect(onImport).not.toHaveBeenCalled()
  })

  it("keeps an unknown tracked submission and result checking mounted when the source becomes denied", async () => {
    const onImport = vi.fn()
    tracked.mutateAsync.mockRejectedValue(new Error("Response lost"))
    const props = { config, organizationId: 1n, tableName: "hr_employee", trackedImport: { companyId: 2n }, onImport, onClose: vi.fn() }
    const { rerender } = render(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await screen.findByText("Response lost")
    const request = tracked.mutateAsync.mock.calls[0]![0] as CsvImportRequest
    const result = screen.getByText(`Exact submission ${request.requestId}`)

    rerender(<CsvImportModal {...props} sourceState={{ status: "denied" }} />)
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBe(result)
    expect(screen.getByText("You do not have access to these records.")).toBeTruthy()
    expect(screen.queryByText("Ada")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Check results" }))
    expect(receiptChecks).toHaveBeenCalledWith(request)
    fireEvent.click(screen.getByRole("button", { name: "Import another file" }))
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBe(result)
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull()
    expect(tracked.mutateAsync).toHaveBeenCalledTimes(1)
    expect(onImport).not.toHaveBeenCalled()

    rerender(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBe(result)
    expect(tracked.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it("keeps an in-flight submission reference and pending status when the source starts loading", async () => {
    let rejectImport!: (error: Error) => void
    tracked.mutateAsync.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectImport = reject }))
    const props = { config, organizationId: 1n, tableName: "hr_employee", trackedImport: { companyId: 2n }, onImport: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    await chooseFile()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    const request = tracked.mutateAsync.mock.calls[0]![0] as CsvImportRequest
    expect(screen.getByText("Submission pending")).toBeTruthy()
    rerender(<CsvImportModal {...props} sourceState={{ status: "loading" }} />)
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBeTruthy()
    expect(screen.getByText("Submission pending")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Import another file" }))
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBeTruthy()
    rejectImport(new Error("Response lost"))
    await screen.findByText("Response lost")
    expect(screen.queryByText("Submission pending")).toBeNull()
    expect(screen.getByText(`Exact submission ${request.requestId}`)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Check results" }))
    expect(receiptChecks).toHaveBeenCalledWith(request)
    expect(tracked.mutateAsync).toHaveBeenCalledTimes(1)
    expect(props.onImport).not.toHaveBeenCalled()
  })

  it("does not restore a late file-read preview after source access is denied", async () => {
    let resolveFile!: (value: { csvText: string }) => void
    const fileReader = vi.fn(() => new Promise<{ csvText: string }>((resolve) => { resolveFile = resolve }))
    const props = { config, fileReader, onImport: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    fireEvent.change(screen.getByLabelText("CSV or Excel file"), { target: { files: [new File([""], "employees.csv")] } })
    rerender(<CsvImportModal {...props} sourceState={{ status: "denied" }} />)
    resolveFile({ csvText: "name\nAda\n" })
    await waitFor(() => expect(fileReader).toHaveResolved())
    expect(screen.queryByText("Ada")).toBeNull()
    rerender(<CsvImportModal {...props} sourceState={{ status: "ready" }} />)
    expect(screen.queryByText("Ada")).toBeNull()
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true)
  })

})
