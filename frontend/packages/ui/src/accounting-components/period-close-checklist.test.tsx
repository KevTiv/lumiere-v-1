import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PeriodCloseChecklist, type PeriodCloseChecklistProps } from "./period-close-checklist"
import { chooseSelectValue } from "../components/select-test-utils"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return String(options.defaultValue)
      if ("count" in (options ?? {})) return `${key}:${String(options?.count)}`
      return key
    },
  }),
}))

afterEach(cleanup)

const timestamp = (iso: string) => ({
  microsSinceUnixEpoch: BigInt(Date.parse(`${iso}T00:00:00.000Z`)) * 1000n,
})

const period = {
  id: 10n,
  companyId: 1n,
  name: "January 2026",
  dateFrom: timestamp("2026-01-01"),
  dateTo: timestamp("2026-01-31"),
  state: { tag: "Open" },
}

function props(overrides: Partial<PeriodCloseChecklistProps> = {}): PeriodCloseChecklistProps {
  return {
    companyId: 1n,
    fiscalYears: [{ id: 1n, companyId: 1n }],
    accountPeriods: [period],
    moves: [],
    bankStatements: [],
    bankStatementLines: [],
    financialReports: [],
    onNavigateToTab: vi.fn(),
    ...overrides,
  }
}

function selectTargetPeriod(): void {
  chooseSelectValue(screen.getByTestId("period-close-target"), "10")
}

function stepStatus(id: string): string | null {
  return screen.getByTestId(`period-close-step-${id}`).getAttribute("data-status")
}

describe("PeriodCloseChecklist", () => {
  it("blocks close checks on partial or denied sources and retries the failed read", () => {
    const retry = vi.fn()
    const { rerender } = render(<PeriodCloseChecklist {...props({ sourceStates: { moves: { status: "partial", onRetry: retry }, financialReports: { status: "denied" } } })} />)
    selectTargetPeriod()
    expect(stepStatus("draft-moves")).toBe("blocked")
    expect(stepStatus("trial-balance")).toBe("blocked")
    expect(stepStatus("vat-report")).toBe("blocked")
    expect(stepStatus("close-period")).toBe("blocked")
    fireEvent.click(within(screen.getByTestId("period-close-step-draft-moves")).getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledTimes(1)
    rerender(<PeriodCloseChecklist {...props()} />)
    expect(stepStatus("draft-moves")).toBe("done")
    expect(stepStatus("close-period")).toBe("pending")
  })

  it("does not carry selected period evidence into another company", () => {
    const { rerender } = render(<PeriodCloseChecklist {...props()} />)
    selectTargetPeriod()
    expect(stepStatus("draft-moves")).toBe("done")
    rerender(<PeriodCloseChecklist {...props({ companyId: 2n, fiscalYears: [{ id: 2n, companyId: 2n }], accountPeriods: [{ ...period, companyId: 2n }] })} />)
    expect(screen.getByTestId("period-close-target").getAttribute("data-placeholder")).not.toBeNull()
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("hides cached calendar evidence when fiscal sources are denied", () => {
    render(<PeriodCloseChecklist {...props({ sourceStates: { accountPeriods: { status: "denied" } } })} />)
    expect(screen.queryByRole("option", { name: "January 2026" })).toBeNull()
    expect((screen.getByTestId("period-close-target") as HTMLSelectElement).disabled).toBe(true)
    expect(stepStatus("fiscal-calendar")).toBe("blocked")
  })

  it("carries exact source context to Reports and rejects a report one microsecond short", () => {
    const exactEnd = { microsSinceUnixEpoch: BigInt(Date.parse("2026-01-31T23:59:59.999Z")) * 1000n + 999n }
    render(<PeriodCloseChecklist {...props({ organizationId: 9n, accountPeriods: [{ ...period, dateTo: exactEnd }], financialReports: [{ companyId: 1n, reportType: { tag: "TrialBalance" }, state: { tag: "Generated" }, dateFrom: period.dateFrom, dateTo: { microsSinceUnixEpoch: exactEnd.microsSinceUnixEpoch - 1n } }] })} />)
    selectTargetPeriod()
    expect(stepStatus("trial-balance")).toBe("pending")
    const href = within(screen.getByTestId("period-close-step-trial-balance")).getByRole("link").getAttribute("href")!
    const context = new URL(href, "https://example.test").searchParams
    expect(context.get("organizationId")).toBe("9")
    expect(context.get("companyId")).toBe("1")
    expect(context.get("periodId")).toBe("10")
    expect(context.get("dateTo")).toBe("2026-01-31T23:59:59.999999Z")
  })

  it("honors only explicitly applicable report requirements", () => {
    const { rerender } = render(<PeriodCloseChecklist {...props({ requiredReports: ["trial-balance"] })} />)
    selectTargetPeriod()
    expect(stepStatus("close-period")).toBe("blocked")
    rerender(<PeriodCloseChecklist {...props({ requiredReports: ["trial-balance"], financialReports: [{ companyId: 1n, reportType: { trial_balance: [] }, state: { generated: [] }, dateFrom: period.dateFrom, dateTo: period.dateTo }] })} />)
    expect(stepStatus("trial-balance")).toBe("done")
    expect(stepStatus("vat-report")).toBe("pending")
    expect(stepStatus("close-period")).toBe("pending")
    rerender(<PeriodCloseChecklist {...props({ requiredReports: ["trial-balance", "vat-report"], financialReports: [{ companyId: 1n, reportType: { trial_balance: [] }, state: { generated: [] }, dateFrom: period.dateFrom, dateTo: period.dateTo }] })} />)
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("counts draft bills from HTTP sum-enum projections as unfinished work", () => {
    render(<PeriodCloseChecklist {...props({ moves: [{ id: 90n, companyId: 1n, date: timestamp("2026-01-15"), state: { draft: [] }, moveType: { in_invoice: [] } }] })} />)
    selectTargetPeriod()
    expect(stepStatus("draft-moves")).toBe("pending")
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("requires a concrete company period before evaluating scoped readiness", () => {
    render(<PeriodCloseChecklist {...props()} />)

    expect(stepStatus("fiscal-calendar")).toBe("done")
    expect(stepStatus("draft-moves")).toBe("blocked")
    expect(stepStatus("bank-recon")).toBe("blocked")
    expect(stepStatus("trial-balance")).toBe("blocked")
    expect(stepStatus("vat-report")).toBe("blocked")
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("scopes moves and report readiness to the selected period and company", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          accountPeriods: [
            period,
            { ...period, id: 20n, companyId: 2n, name: "Other company period" },
          ],
          moves: [
            { id: 1n, companyId: 1n, date: timestamp("2026-01-15"), state: { tag: "Draft" } },
            { id: 2n, companyId: 2n, date: timestamp("2026-01-15"), state: { tag: "Draft" } },
            { id: 3n, companyId: 1n, date: timestamp("2026-02-15"), state: { tag: "Draft" } },
          ],
          bankStatements: [
            { id: 100n, companyId: 1n },
            { id: 200n, companyId: 2n },
          ],
          bankStatementLines: [
            { id: 1n, statementId: 100n, date: timestamp("2026-01-20"), isReconciled: false },
            { id: 2n, statementId: 200n, date: timestamp("2026-01-20"), isReconciled: false },
          ],
          financialReports: [
            {
              id: 1n,
              companyId: 1n,
              reportType: { tag: "TrialBalance" },
              state: { tag: "Generated" },
              dateFrom: timestamp("2026-01-01"),
              dateTo: timestamp("2026-01-31"),
            },
            {
              id: 2n,
              companyId: 2n,
              reportType: { tag: "VatReturn" },
              state: { tag: "Generated" },
              dateFrom: timestamp("2026-01-01"),
              dateTo: timestamp("2026-01-31"),
            },
            {
              id: 3n,
              companyId: 1n,
              reportType: { tag: "VatReturn" },
              state: { tag: "Generated" },
              dateFrom: timestamp("2026-02-01"),
              dateTo: timestamp("2026-02-28"),
            },
          ],
        })}
      />,
    )

    expect(screen.queryByRole("option", { name: "Other company period" })).toBeNull()
    selectTargetPeriod()

    expect(stepStatus("draft-moves")).toBe("pending")
    expect(stepStatus("bank-recon")).toBe("pending")
    expect(stepStatus("trial-balance")).toBe("done")
    expect(stepStatus("vat-report")).toBe("pending")
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("does not claim bank reconciliation is complete when a line has no canonical statement", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          bankStatementLines: [
            { id: 1n, statementId: 4n, date: timestamp("2026-01-20"), isReconciled: false },
          ],
        })}
      />,
    )

    selectTargetPeriod()

    expect(stepStatus("bank-recon")).toBe("blocked")
    expect(screen.getByTestId("period-close-step-bank-recon").textContent).toContain(
      "Bank statement ownership cannot be resolved for this period.",
    )
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("fails closed when a bank line resolves to ambiguous statements", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          bankStatements: [
            { id: 4n, companyId: 1n },
            { id: 4n, companyId: 1n },
          ],
          bankStatementLines: [
            { id: 1n, statementId: 4n, date: timestamp("2026-01-20"), isReconciled: false },
          ],
        })}
      />,
    )

    selectTargetPeriod()

    expect(stepStatus("bank-recon")).toBe("blocked")
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("fails closed when the canonical bank statement has no company owner", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          bankStatements: [{ id: 4n }],
          bankStatementLines: [
            { id: 1n, statementId: 4n, date: timestamp("2026-01-20"), isReconciled: false },
          ],
        })}
      />,
    )

    selectTargetPeriod()

    expect(stepStatus("bank-recon")).toBe("blocked")
    expect(stepStatus("close-period")).toBe("blocked")
  })

  it("links report prerequisites to their intended Reports tabs", () => {
    render(<PeriodCloseChecklist {...props()} />)

    const trialLink = within(screen.getByTestId("period-close-step-trial-balance")).getByRole("link")
    const vatLink = within(screen.getByTestId("period-close-step-vat-report")).getByRole("link")

    expect(trialLink.getAttribute("href")).toBe("/reports?tab=trial-balance")
    expect(vatLink.getAttribute("href")).toBe("/reports?tab=reports")
  })

  it("marks exact-period prerequisites done when their scoped evidence is complete", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          financialReports: [
            {
              companyId: 1n,
              reportType: { tag: "TrialBalance" },
              state: { tag: "Exported" },
              dateFrom: timestamp("2026-01-01"),
              dateTo: timestamp("2026-01-31"),
            },
            {
              companyId: 1n,
              reportType: { tag: "VatReturn" },
              state: { tag: "Archived" },
              dateFrom: timestamp("2026-01-01"),
              dateTo: timestamp("2026-01-31"),
            },
          ],
        })}
      />,
    )

    selectTargetPeriod()

    expect(stepStatus("draft-moves")).toBe("done")
    expect(stepStatus("bank-recon")).toBe("done")
    expect(stepStatus("trial-balance")).toBe("done")
    expect(stepStatus("vat-report")).toBe("done")
    expect(stepStatus("close-period")).toBe("pending")
  })

  it("does not mark a configured but unopened period as closed", () => {
    render(
      <PeriodCloseChecklist
        {...props({ accountPeriods: [{ ...period, state: { tag: "Draft" } }] })}
      />,
    )

    selectTargetPeriod()

    expect(stepStatus("close-period")).toBe("blocked")
  })
})
