import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { toCreateFinancialReportParams } from "../../../erp-shared/src/reports-create-params"

vi.mock("../../../query-hooks/node_modules/@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown> }) => ({ mutateAsync: options.mutationFn }),
}))
const state = vi.hoisted(() => ({ fetch: vi.fn(), rows: vi.fn(), download: vi.fn() }))
vi.mock("../../../query-hooks/src/http", () => ({ apiFetch: state.fetch, fetchQueryList: state.rows, rqBigIntKey: String }))
vi.mock("../../../query-hooks/src/hooks/templates", () => ({ downloadDocumentExport: state.download }))
import { useCreateFinancialReportFlow, useExportFinancialReport } from "../../../query-hooks/src/hooks/reports"

afterEach(cleanup)
beforeEach(() => { state.fetch.mockReset(); state.rows.mockReset(); state.download.mockReset() })
const input = { name: "October balances", reportType: "trialBalance", currencyId: "3", dateFrom: "2026-10-01", dateTo: "2026-10-31" }

function arrange(generated: boolean) {
  let row: Record<string, unknown>
  state.rows.mockImplementation(async () => row ? [row] : [])
  state.fetch.mockImplementation(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { params?: { metadata?: unknown }; companyId?: unknown }
    if (!row) {
      row = { ...toCreateFinancialReportParams(input), id: "41", organizationId: "9", companyId: "2", metadata: body.params?.metadata, state: "draft" }
    } else if (generated) row = { ...row, state: "generated" }
    return new Response("{}", { status: 200 })
  })
}

it("returns the exact saved identity only after generation readback", async () => {
  arrange(true)
  const hook = renderHook(() => useCreateFinancialReportFlow(9n, 2n))
  await act(async () => { expect(await hook.result.current.mutateAsync(input)).toEqual({ id: "41" }) })
  expect(state.fetch).toHaveBeenCalledTimes(2)
})

it("unverified generation cannot open a result or dispatch generation again on retry", async () => {
  arrange(false)
  const hook = renderHook(() => useCreateFinancialReportFlow(9n, 2n))
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow(/unverified/) })
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow(/not sent again/) })
  expect(state.fetch).toHaveBeenCalledTimes(2)
})

it("downloads an already-exported report in another format without replaying export registration", async () => {
  state.rows.mockResolvedValue([{ id: "41", organizationId: "9", companyId: "2", state: "exported" }])
  const hook = renderHook(() => useExportFinancialReport(9n, 2n))
  await act(async () => { await hook.result.current.mutateAsync({ reportId: "41", exportFormat: "csv" }) })
  expect(state.fetch).not.toHaveBeenCalled()
  expect(state.download).toHaveBeenCalledWith("csv", "financial-report", 41, "financial_report_41.csv")
})

it("requires the same company and an exportable state before dispatching or downloading", async () => {
  const hook = renderHook(() => useExportFinancialReport(9n, 2n))
  for (const row of [
    { id: "41", organizationId: "9", companyId: "3", state: "generated" },
    { id: "41", organizationId: "9", companyId: "2", state: "draft" },
  ]) {
    state.rows.mockResolvedValue([row])
    await act(async () => { await expect(hook.result.current.mutateAsync({ reportId: "41", exportFormat: "pdf" })).rejects.toThrow() })
  }
  expect(state.fetch).not.toHaveBeenCalled()
  expect(state.download).not.toHaveBeenCalled()
})
