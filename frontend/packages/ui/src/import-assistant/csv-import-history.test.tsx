import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chooseSelectValue } from "../components/select-test-utils"
import { CsvImportHistory } from "./csv-import-history"

const queries = vi.hoisted(() => ({
  jobs: { data: [] as Record<string, unknown>[], isError: false, isLoading: false, isFetching: false, refetch: vi.fn() },
  errors: { data: [] as Record<string, unknown>[], isError: false, isFetching: false, refetch: vi.fn() },
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? "")) }) }))
vi.mock("@lumiere/query-hooks/hooks/import-jobs", () => ({
  useImportJobs: () => queries.jobs,
  useImportJobErrors: () => queries.errors,
  canRollbackImportJob: () => false,
  canCleanupAbandonedAccountMoveImport: (job: Record<string, unknown>) =>
    job.table_name === "account_move",
  downloadImportJobErrorsCsv: vi.fn(),
  errorsForJob: (rows: Record<string, unknown>[], job: Record<string, unknown>) => rows.filter((row) => String(row.job_id) === String(job.id)),
}))

afterEach(() => { cleanup(); vi.useRealTimers() })
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(queries.jobs, { data: [
    { id: 2, table_name: "hr_employee", status: "partial", imported_rows: 2, error_rows: 1 },
    { id: 3, table_name: "project_project", status: "success", imported_rows: 5 },
  ], isError: false, isLoading: false, isFetching: false })
  Object.assign(queries.errors, { data: [
    { id: 1, job_id: 2, row_number: 3, error_message: "Unknown employee", field_name: "employee_id" },
    { id: 2, job_id: 3, row_number: 4, error_message: "Other job error" },
  ], isError: false, isFetching: false })
})

describe("CSV import outcome history", () => {
  it("leaves selection empty and filters history by the actual entity", () => {
    render(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    expect(screen.getByRole("combobox").hasAttribute("data-placeholder")).toBe(true)
    expect(screen.queryByText(/#3/)).toBeNull()
    expect(screen.queryByText("Unknown employee")).toBeNull()
    expect(screen.getByText(/not automatically linked/)).toBeTruthy()
  })
  it("shows selected counts and only that job's inline row errors", () => {
    render(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    chooseSelectValue(screen.getByRole("combobox"), "2")
    expect(screen.getByText("partial")).toBeTruthy()
    expect(screen.getByText(/Row 3: Unknown employee/)).toBeTruthy()
    expect(screen.queryByText(/Other job error/)).toBeNull()
    expect(screen.getByText("common.importAssistant.jobImported:").parentElement?.textContent).toContain("2")
    expect(screen.getByText("common.importAssistant.jobErrors:").parentElement?.textContent).toContain("1")
  })
  it("reports errors even with stale data and refreshes both queries", () => {
    queries.errors.isError = true
    render(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded")
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }))
    expect(queries.jobs.refetch).toHaveBeenCalled()
    expect(queries.errors.refetch).toHaveBeenCalled()
  })
  it("hides cached jobs, selected counts and row errors after a 403 refetch failure", () => {
    const view = render(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    chooseSelectValue(screen.getByRole("combobox"), "2")
    expect(screen.getByText(/Row 3: Unknown employee/)).toBeTruthy()
    Object.assign(queries.jobs, { isError: true, error: Object.assign(new Error("Forbidden"), { status: 403 }) })
    view.rerender(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded")
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(screen.queryByText(/#2/)).toBeNull()
    expect(screen.queryByText("common.importAssistant.jobImported:")).toBeNull()
    expect(screen.queryByText(/Row 3: Unknown employee/)).toBeNull()
    expect(screen.queryByRole("button", { name: "common.importAssistant.downloadErrors" })).toBeNull()
    expect(screen.getByRole("button", { name: "Refresh history" })).toBeTruthy()
  })
  it("does not expose cached cleanup candidates after import history access fails", () => {
    queries.jobs.data = [
      { id: 41, table_name: "account_move", status: "success", metadata: "proven-parent" },
    ]
    queries.jobs.isError = true
    render(
      <CsvImportHistory
        organizationId={1n}
        tableName="account_move_line"
        abandonedAccountingCleanup={{
          companyId: 7n,
          authorized: true,
          onCleanup: vi.fn(),
        }}
      />,
    )
    expect(screen.queryByText("Abandoned journal import drafts")).toBeNull()
  })
  it("refreshes terminal cached jobs after submission and stops polling on close", () => {
    vi.useFakeTimers()
    const view = render(<CsvImportHistory organizationId={1n} tableName="hr_employee" />)
    expect(queries.jobs.refetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(queries.jobs.refetch).toHaveBeenCalledTimes(2)
    view.unmount()
    vi.advanceTimersByTime(2000)
    expect(queries.jobs.refetch).toHaveBeenCalledTimes(2)
  })
})
