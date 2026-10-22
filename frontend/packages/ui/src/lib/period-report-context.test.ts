import { describe, expect, it, vi } from "vitest"
import { applyPeriodReportFormContext, periodReportContextState, periodReportFormDefaults, periodReportHref, readPeriodReportContext, reportMatchesPeriodContext, type PeriodReportContext } from "./period-report-context"

const context: PeriodReportContext = { organizationId: "1", companyId: "2", periodId: "3", dateFrom: "2026-10-01T00:00:00.000000Z", dateTo: "2026-10-31T23:59:59.999999Z", reportType: "trial-balance" }
const micros = (value: bigint) => ({ microsSinceUnixEpoch: value })
const period = { id: 3n, organizationId: 1n, companyId: 2n, dateFrom: context.dateFrom, dateTo: context.dateTo }
const sources = { organizationId: 1n, companyId: 2n, periods: [period], periodState: { status: "ready" as const }, reportState: { status: "ready" as const } }

describe("period close report context", () => {
  it("round-trips exact source identities and microsecond endpoints through real navigation", () => {
    const url = new URL(periodReportHref(context), "https://example.test")
    expect(url.pathname).toBe("/reports")
    expect(url.searchParams.get("tab")).toBe("reports")
    expect(readPeriodReportContext(url.searchParams)).toEqual(context)
    expect(new URL(periodReportHref({ ...context, reportType: "vat-report" }), url.origin).searchParams.get("tab")).toBe("vat-report")
  })

  it("requires one exact canonical period in the active company", () => {
    expect(periodReportContextState(context, sources)).toEqual({ status: "ready" })
    expect(periodReportContextState(context, { ...sources, companyId: 9n }).status).toBe("error")
    expect(periodReportContextState(context, { ...sources, periods: [period, period] }).status).toBe("error")
    expect(periodReportContextState(context, { ...sources, periods: [{ ...period, dateTo: "2026-10-31T23:59:59.999998Z" }] }).status).toBe("error")
  })

  it("retains denied, partial and pending source states with retry", () => {
    const retry = vi.fn()
    expect(periodReportContextState(context, { ...sources, periodState: { status: "denied" } }).status).toBe("denied")
    expect(periodReportContextState(context, { ...sources, reportState: { status: "loading" } }).status).toBe("loading")
    const state = periodReportContextState(context, { ...sources, reportState: { status: "partial", onRetry: retry } })
    expect(state.status).toBe("error")
    if ("onRetry" in state) state.onRetry?.()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("filters reports by exact source period, company and type without millisecond truncation", () => {
    const row = { organizationId: 1n, companyId: 2n, reportType: { tag: "TrialBalance" }, dateFrom: micros(BigInt(Date.parse(context.dateFrom)) * 1000n), dateTo: micros(BigInt(Date.parse(context.dateTo)) * 1000n + 999n) }
    expect(reportMatchesPeriodContext(row, context)).toBe(true)
    expect(reportMatchesPeriodContext({ ...row, companyId: 9n }, context)).toBe(false)
    expect(reportMatchesPeriodContext({ ...row, dateTo: micros(row.dateTo.microsSinceUnixEpoch - 1n) }, context)).toBe(false)
    expect(reportMatchesPeriodContext({ ...row, reportType: "BalanceSheet" }, context)).toBe(false)
  })

  it("prefills visible dates and sends exact canonical endpoints and posted ledger basis", () => {
    expect(periodReportFormDefaults(context)).toMatchObject({ dateFrom: "2026-10-01", dateTo: "2026-10-31", targetMove: "posted" })
    expect(applyPeriodReportFormContext({ name: "Reviewed report", dateTo: "2030-01-01", targetMove: "all" }, context)).toMatchObject({ name: "Reviewed report", dateTo: context.dateTo, targetMove: "posted" })
  })
})
