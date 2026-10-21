import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CsvImportResult } from "./csv-import-result"
import { createCsvImportRequest } from "@lumiere/query-hooks/hooks/csv-import-request"

const hooks = vi.hoisted(() => ({
  query: { data: undefined as unknown, isError: false, error: new Error("Permission denied"), isFetching: false, refetch: vi.fn().mockResolvedValue({}) },
  mutation: { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false },
  receipt: vi.fn(),
}))
vi.mock("@lumiere/query-hooks/hooks/tracked-csv-import", () => ({
  useTrackedCsvImport: () => hooks.mutation,
  useCsvImportReceipt: (...args: unknown[]) => { hooks.receipt(...args); return hooks.query },
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("./import-job-status-panel", () => ({ ImportJobStatusPanel: ({ job }: { job?: { id: string } }) => <div>{job ? `Job ${job.id}` : "No job details"}</div> }))
const request = createCsvImportRequest(1n, "hr_employee", "name\nAda\n", "employees.csv", { companyId: 2n }, "a".repeat(32))
afterEach(() => { cleanup(); vi.clearAllMocks(); hooks.query.data = undefined; hooks.query.isError = false })

describe("exact CSV results", () => {
  it("does not start exact lookup until initial submission settles", () => {
    const view = render(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={2n} initialPending onNewFile={vi.fn()} />)
    expect(hooks.receipt).toHaveBeenLastCalledWith(request, false)
    view.rerender(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={2n} onNewFile={vi.fn()} />)
    expect(hooks.receipt).toHaveBeenLastCalledWith(request, true)
  })
  it("retry reuses exact frozen payload after response loss", async () => {
    render(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={2n} initialError="Response lost" onNewFile={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Retry same submission" }))
    await waitFor(() => expect(hooks.mutation.mutateAsync).toHaveBeenCalledWith(request))
    expect(hooks.query.refetch).toHaveBeenCalledTimes(1)
  })
  it("hides cached result after a denied exact read", () => {
    hooks.query.data = { jobId: "5", entity: request.entity, status: "success", errors: [] }
    hooks.query.isError = true
    render(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={2n} onNewFile={vi.fn()} />)
    expect(screen.queryByText("Job 5")).toBeNull()
    expect(screen.getByText("Permission denied")).toBeTruthy()
  })
  it("shows terminal failed receipt and redacted errors without offering duplicate retry", () => {
    hooks.query.data = { jobId: "5", entity: request.entity, status: "failed", errors: [], errorsRedacted: true }
    render(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={2n} onNewFile={vi.fn()} />)
    expect(screen.getByText("Job 5")).toBeTruthy()
    expect(screen.getByText("Your permissions do not include all row error details.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry same submission" })).toBeNull()
    expect(screen.getByRole("button", { name: "Import another file" })).toBeTruthy()
  })
  it("does not query or expose a receipt in a changed organization", () => {
    hooks.query.data = { jobId: "5", entity: request.entity, status: "success", errors: [] }
    render(<CsvImportResult request={request} activeOrganizationId={2n} activeCompanyId={2n} onNewFile={vi.fn()} />)
    expect(hooks.receipt).toHaveBeenLastCalledWith(request, false)
    expect(screen.queryByText("Job 5")).toBeNull()
  })
  it("hides cached results and disables receipt reads after the active company changes", () => {
    hooks.query.data = { jobId: "5", entity: request.entity, status: "success", errors: [] }
    render(<CsvImportResult request={request} activeOrganizationId={1n} activeCompanyId={3n} onNewFile={vi.fn()} />)
    expect(hooks.receipt).toHaveBeenLastCalledWith(request, false)
    expect(screen.queryByText("Job 5")).toBeNull()
    expect(screen.queryByRole("button", { name: "Retry same submission" })).toBeNull()
  })

})
