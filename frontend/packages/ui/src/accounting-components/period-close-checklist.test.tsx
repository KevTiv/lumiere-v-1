import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

  it("keeps missing saved states and duplicate identities out of exact record counts", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          moves: [
            { id: 30n, companyId: 1n, date: timestamp("2026-01-20") },
            { id: 31n, companyId: 1n, date: timestamp("2026-01-20"), state: { tag: "Draft" } },
            { id: 31n, companyId: 1n, date: timestamp("2026-01-20"), state: { tag: "Draft" } },
          ],
          bankStatements: [{ id: 100n, companyId: 1n }],
          bankStatementLines: [{ id: 40n, statementId: 100n, date: timestamp("2026-01-20") }],
        })}
      />,
    )
    selectTargetPeriod()
    expect(stepStatus("draft-moves")).toBe("blocked")
    expect(stepStatus("bank-recon")).toBe("blocked")
    expect(
      within(screen.getByTestId("period-close-records-draft-moves")).queryByRole("link"),
    ).toBeNull()
    expect(
      within(screen.getByTestId("period-close-records-bank-recon")).queryByRole("table"),
    ).toBeNull()
  })

  it("shows an authoritative closed state even when advisory records remain unverified", () => {
    render(<PeriodCloseChecklist {...props({
      accountPeriods: [{ ...period, state: { tag: "Closed" } }],
      moves: [{ id: 30n, companyId: 1n, state: { tag: "Draft" } }],
    })} />)
    selectTargetPeriod()
    expect(stepStatus("close-period")).toBe("done")
    expect(stepStatus("draft-moves")).toBe("blocked")
  })

  it("does not offer to close an already closed period", () => {
    const close = vi.fn()
    render(
      <PeriodCloseChecklist
        {...props({
          accountPeriods: [{ ...period, state: { tag: "Closed" } }],
          onClosePeriod: close,
        })}
      />,
    )
    selectTargetPeriod()
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    expect(
      screen.getByRole("button", { name: "Close selected period" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(close).not.toHaveBeenCalled()
  })
  it("lists only exact selected-period records and links drafts to their canonical owner", () => {
    const inspect = vi.fn()
    render(
      <PeriodCloseChecklist
        {...props({
          onInspectBankLine: inspect,
          moves: [
            {
              id: 31n,
              name: "JAN-DRAFT",
              companyId: 1n,
              date: timestamp("2026-01-15"),
              state: { tag: "Draft" },
            },
            {
              id: 32n,
              name: "OTHER-DRAFT",
              companyId: 2n,
              date: timestamp("2026-01-15"),
              state: { tag: "Draft" },
            },
            {
              id: 33n,
              name: "FEB-DRAFT",
              companyId: 1n,
              date: timestamp("2026-02-15"),
              state: { tag: "Draft" },
            },
          ],
          bankStatements: [{ id: 100n, companyId: 1n }],
          bankStatementLines: [
            {
              id: 41n,
              statementId: 100n,
              name: "JAN-BANK",
              date: timestamp("2026-01-20"),
              amount: -20,
              isReconciled: false,
            },
          ],
        })}
      />,
    )
    selectTargetPeriod()
    expect(screen.getByRole("link", { name: "JAN-DRAFT · #31" }).getAttribute("href")).toBe(
      "/accounting?tab=journal-entries&filter=id%3A31",
    )
    expect(screen.queryByText(/OTHER-DRAFT|FEB-DRAFT/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "JAN-BANK · #41" }))
    expect(inspect).toHaveBeenCalledWith("100", "41")
  })

  it("does not mark known outside-period or completed records as unverified blockers", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          moves: [
            { id: 3n, state: { tag: "Posted" } },
            { id: 4n, date: timestamp("2026-02-15"), state: { tag: "Draft" } },
          ],
          bankStatementLines: [
            { id: 5n, isReconciled: true },
            { id: 6n, date: timestamp("2026-02-15"), isReconciled: false },
          ],
        })}
      />,
    )
    selectTargetPeriod()
    expect(stepStatus("draft-moves")).toBe("done")
    expect(stepStatus("bank-recon")).toBe("done")
    expect(screen.queryByText(/Unverified records/)).toBeNull()
  })

  it("keeps unresolved records separate from confirmed period counts", () => {
    render(
      <PeriodCloseChecklist
        {...props({
          moves: [{ id: 3n, date: timestamp("2026-01-20"), state: { tag: "Draft" } }],
        })}
      />,
    )
    selectTargetPeriod()
    expect(
      screen.getByText(/Their scope, identity, or saved state cannot be verified/),
    ).toBeTruthy()
    expect(
      within(screen.getByTestId("period-close-records-draft-moves")).queryByRole("link"),
    ).toBeNull()
    expect(stepStatus("draft-moves")).toBe("blocked")
  })

  it("reviews the exact period and consequences before calling the existing close handler", async () => {
    const close = vi.fn().mockResolvedValue({ id: "10" })
    render(<PeriodCloseChecklist {...props({ onClosePeriod: close })} />)
    selectTargetPeriod()
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    const dialog = screen.getByRole("dialog")
    expect(dialog.textContent).toContain("January 2026")
    expect(dialog.textContent).toContain("2026-01-01 – 2026-01-31 (UTC)")
    expect(dialog.textContent).toContain(
      "does not post drafts, reconcile bank lines, or generate reports",
    )
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Close selected period" }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(10n))
  })

  it("keeps an unconfirmed close result open without claiming success", async () => {
    const close = vi.fn().mockRejectedValue(new Error("Close outcome is unknown"))
    render(<PeriodCloseChecklist {...props({ onClosePeriod: close })} />)
    selectTargetPeriod()
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    fireEvent.click(screen.getByRole("button", { name: "Close selected period" }))
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain(
        "Close outcome is unknown",
      ),
    )
    expect(stepStatus("close-period")).toBe("pending")
  })

  it("does not enable close or show zero readiness when review sources are unavailable", () => {
    render(
      <PeriodCloseChecklist
        {...props({ onClosePeriod: vi.fn(), dataState: { status: "loading" } })}
      />,
    )
    selectTargetPeriod()
    expect(screen.getByText(/Counts and close readiness cannot be confirmed/)).toBeTruthy()
    expect(stepStatus("draft-moves")).toBe("blocked")
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    expect(
      screen.getByRole("button", { name: "Close selected period" }).hasAttribute("disabled"),
    ).toBe(true)
  })
  it("keeps the close action disabled until source readiness and applicable reports are verified", () => {
    const close = vi.fn()
    const { rerender } = render(<PeriodCloseChecklist {...props({ onClosePeriod: close, sourceStates: { moves: { status: "partial" } } })} />)
    selectTargetPeriod()
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    const closeButton = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Close selected period" })
    expect(closeButton().hasAttribute("disabled")).toBe(true)
    fireEvent.click(closeButton())
    expect(close).not.toHaveBeenCalled()
    rerender(<PeriodCloseChecklist {...props({ onClosePeriod: close, requiredReports: ["trial-balance"] })} />)
    expect(closeButton().hasAttribute("disabled")).toBe(true)
    rerender(<PeriodCloseChecklist {...props({ onClosePeriod: close, requiredReports: ["trial-balance"], financialReports: [{ companyId: 1n, reportType: { trial_balance: [] }, state: { generated: [] }, dateFrom: period.dateFrom, dateTo: period.dateTo }] })} />)
    expect(closeButton().hasAttribute("disabled")).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it("dismisses an open close review when the selected company changes", () => {
    const close = vi.fn()
    const { rerender } = render(<PeriodCloseChecklist {...props({ onClosePeriod: close })} />)
    selectTargetPeriod()
    fireEvent.click(screen.getByRole("button", { name: "Review close consequences" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    rerender(<PeriodCloseChecklist {...props({ companyId: 2n, fiscalYears: [{ id: 2n, companyId: 2n }], accountPeriods: [{ ...period, companyId: 2n }], onClosePeriod: close })} />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(close).not.toHaveBeenCalled()
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
            {
              id: 1n,
              companyId: 1n,
              date: timestamp("2026-01-15"),
              state: { tag: "Draft" },
            },
            {
              id: 2n,
              companyId: 2n,
              date: timestamp("2026-01-15"),
              state: { tag: "Draft" },
            },
            {
              id: 3n,
              companyId: 1n,
              date: timestamp("2026-02-15"),
              state: { tag: "Draft" },
            },
          ],
          bankStatements: [
            { id: 100n, companyId: 1n },
            { id: 200n, companyId: 2n },
          ],
          bankStatementLines: [
            {
              id: 1n,
              statementId: 100n,
              date: timestamp("2026-01-20"),
              isReconciled: false,
            },
            {
              id: 2n,
              statementId: 200n,
              date: timestamp("2026-01-20"),
              isReconciled: false,
            },
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
            {
              id: 1n,
              statementId: 4n,
              date: timestamp("2026-01-20"),
              isReconciled: false,
            },
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
            {
              id: 1n,
              statementId: 4n,
              date: timestamp("2026-01-20"),
              isReconciled: false,
            },
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
            {
              id: 1n,
              statementId: 4n,
              date: timestamp("2026-01-20"),
              isReconciled: false,
            },
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

    const trialLink = within(screen.getByTestId("period-close-step-trial-balance")).getByRole(
      "link",
    )
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
