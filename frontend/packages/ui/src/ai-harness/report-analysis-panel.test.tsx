import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReportAnalysisPanel } from "../../../../web/app/(modules)/ai-harness/report-analysis-panel"
import { chooseSelectValue } from "../components/select-test-utils"

const state = vi.hoisted(() => ({
  mutateAsync: vi.fn(), reset: vi.fn(), data: undefined as unknown,
  pending: false, failed: false, agentsUnavailable: false, agentsPending: false,
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-agents", () => ({ useAiAgents: () => ({
  isError: state.agentsUnavailable, isPending: state.agentsPending,
  data: [
    { id: 7, organizationId: 1, companyId: 1, isActive: true, name: "Approved pilot" },
    { id: 8, organizationId: 1, companyId: 2, isActive: true, name: "Other company" },
    { id: 9, organizationId: 2, companyId: 1, isActive: true, name: "Other organization" },
    { id: 10, organizationId: 1, companyId: 1, isActive: false, name: "Inactive agent" },
  ],
}) }))
vi.mock("@lumiere/query-hooks/hooks/ai-skills", () => ({ useAiReportAnalysis: () => ({
  mutateAsync: state.mutateAsync, reset: state.reset, data: state.data,
  isPending: state.pending, isError: state.failed,
}) }))
const key = (value: string) => `aiHarness.reportAnalysis.${value}`
const props = { organizationId: 1n, companies: [{ id: 1, name: "Alpha" }, { id: 2, name: "Second" }] }
function prepare() {
  chooseSelectValue(screen.getByLabelText(key("agent")), "7")
  fireEvent.change(screen.getByLabelText(key("question")), { target: { value: "  Summarize the current report.  " } })
}
beforeEach(() => {
  state.mutateAsync.mockReset().mockResolvedValue(undefined)
  state.reset.mockReset()
  state.data = undefined
  state.pending = state.failed = state.agentsUnavailable = state.agentsPending = false
})
afterEach(cleanup)

describe("governed report analysis", () => {
  it("requires an explicit active scoped agent and suppresses repeated submission while the request is unresolved", async () => {
    let finish!: () => void
    state.mutateAsync.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<ReportAnalysisPanel {...props} />)
    const button = screen.getByRole("button", { name: key("run"), exact: true })
    expect(button.hasAttribute("disabled")).toBe(true)
    prepare()
    expect(button.hasAttribute("disabled")).toBe(false)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(state.mutateAsync).toHaveBeenCalledTimes(1)
    expect(state.mutateAsync).toHaveBeenCalledWith({ companyId: 1, agentId: 7, inputs: { query: "Summarize the current report." }, maxSteps: 5 })
    await act(async () => finish())
  })

  it("clears agent selection when company changes and excludes foreign or inactive agents", () => {
    render(<ReportAnalysisPanel {...props} />)
    prepare()
    chooseSelectValue(screen.getByLabelText(key("company")), "2")
    expect(screen.getByRole("button", { name: key("run"), exact: true }).hasAttribute("disabled")).toBe(true)
    fireEvent.keyDown(screen.getByLabelText(key("agent")), { key: "Enter" })
    expect(screen.getByRole("option", { name: "Other company" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "Approved pilot" })).toBeNull()
    expect(screen.queryByRole("option", { name: "Other organization" })).toBeNull()
    expect(screen.queryByRole("option", { name: "Inactive agent" })).toBeNull()
    fireEvent.click(screen.getByRole("option", { name: "Other company" }))
    expect(state.reset).toHaveBeenCalled()
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })

  it("shows the returned review status and links to the exact saved run without starting another request", () => {
    state.data = { summary: "Operator review is required.", run: { run_id: 42, status: "waiting_approval" } }
    render(<ReportAnalysisPanel {...props} />)
    expect(screen.getByText("Operator review is required.")).toBeTruthy()
    expect(screen.getByText("aiHarness.enums.runStatuses.waitingApproval")).toBeTruthy()
    expect(screen.getByRole("link", { name: key("inspect") }).getAttribute("href")).toBe("/ai-harness?tab=evidence-reviewer&companyId=1&runId=42")
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })

  it("keeps unavailable agents and an uncertain request visible without automatic resubmission", async () => {
    state.agentsUnavailable = true
    const view = render(<ReportAnalysisPanel {...props} />)
    expect(screen.getByText(key("agentsUnavailable"))).toBeTruthy()
    expect(screen.getByRole("button", { name: key("run"), exact: true }).hasAttribute("disabled")).toBe(true)
    state.agentsUnavailable = false
    state.failed = true
    view.rerender(<ReportAnalysisPanel {...props} />)
    expect(screen.getByText(key("failed"))).toBeTruthy()
    expect(screen.getByRole("link", { name: key("history") }).getAttribute("href")).toBe("/ai-harness?tab=run-lifecycle")
    expect(state.mutateAsync).not.toHaveBeenCalled()
  })
})
