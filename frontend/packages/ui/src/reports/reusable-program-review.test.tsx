import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReusableProgramReview } from "../../../../web/app/(modules)/reports/reusable-program-review"

const candidate = { title: "Period review", programKey: "period-review", versionLabel: "1", applicationContract: "v0.3.163", graphHash: "a".repeat(64), inputSchema: {
  type: "object", additionalProperties: false, required: ["limit", "includeEmpty"], properties: { limit: { type: "integer", minimum: 0, maximum: 50 }, includeEmpty: { type: "boolean" } },
} }
const scope = { organizationId: "1", companyId: 2, actorIdentity: "actor-one", authorizationRevision: "revision-one" }
const row = { runId: 42, status: "agent_settled", skillId: 3, agentId: 4, stepCount: 2, tokensUsed: 100, startedAt: "2026-11-01T10:00:00Z", completedAt: null, economics: null }
const fetcher = vi.fn()
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("internal reusable program candidate review", () => {
  it("renders without fetching or executing, preserves zero and false in local validation", () => {
    render(<ReusableProgramReview candidate={candidate} scope={scope} />)
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Run program" }).hasAttribute("disabled")).toBe(true)
    fireEvent.change(screen.getByLabelText("limit (required)"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("includeEmpty (required)"), { target: { value: "1" } })
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }))
    expect(screen.getByRole("status").textContent).toContain("Inputs match")
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("loads the existing session-owned history only on request and does not infer completed", async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ runs: [row], nextCursor: null }) })
    const inspect = vi.fn()
    render(<ReusableProgramReview candidate={candidate} scope={scope} onInspectRun={inspect} />)
    fireEvent.click(screen.getByRole("button", { name: "Load existing runs" }))
    await screen.findByText("Run #42 · agent_settled · 2 steps")
    expect(fetcher).toHaveBeenCalledWith("/api/ai/evidence/runs/history", expect.objectContaining({ method: "POST", body: JSON.stringify({ companyId: 2, cursor: null, limit: 20 }) }))
    fireEvent.click(screen.getByRole("button", { name: "View run #42" }))
    expect(inspect).toHaveBeenCalledWith(42)
  })
  it("aborts old scope and clears inputs when company or actor changes", async () => {
    let finish!: (value: unknown) => void
    fetcher.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<ReusableProgramReview candidate={candidate} scope={scope} />)
    fireEvent.change(screen.getByLabelText("limit (required)"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Load existing runs" }))
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal
    view.rerender(<ReusableProgramReview candidate={candidate} scope={{ ...scope, companyId: 3, actorIdentity: "actor-two" }} />)
    expect(signal.aborted).toBe(true)
    expect((screen.getByLabelText("limit (required)") as HTMLInputElement).value).toBe("")
    await act(async () => finish({ ok: true, json: async () => ({ runs: [row], nextCursor: null }) }))
    expect(screen.queryByText(/Run #42/)).toBeNull()
  })
  it("does not convert denied or malformed history to an empty or successful result", async () => {
    fetcher.mockResolvedValueOnce({ ok: false, status: 403 }).mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [{ ...row, runId: 0 }], nextCursor: null }) })
    render(<ReusableProgramReview candidate={candidate} scope={scope} />)
    fireEvent.click(screen.getByRole("button", { name: "Load existing runs" }))
    await screen.findByRole("alert")
    expect(screen.queryByText("No governed runs were returned.")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Load existing runs" }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await screen.findByRole("alert")
    expect(screen.queryByText("No governed runs were returned.")).toBeNull()
  })
  it("rejects unsupported schema constraints before presenting an editable form", () => {
    render(<ReusableProgramReview candidate={{ ...candidate, inputSchema: { ...candidate.inputSchema, oneOf: [] } }} scope={scope} />)
    expect(screen.getByRole("alert").textContent).toContain("unsupported")
    expect(screen.queryByRole("button", { name: "Check inputs" })).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("preserves invalid optional numeric text until it is corrected or deliberately cleared", () => {
    render(<ReusableProgramReview candidate={{ ...candidate, inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 0 } } } }} scope={scope} />)
    const input = screen.getByLabelText("limit") as HTMLInputElement
    fireEvent.change(input, { target: { value: "1e3" } })
    expect(input.value).toBe("1e3")
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }))
    expect(screen.getByRole("status").textContent).toContain("invalid")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Check inputs" }))
    expect(screen.getByRole("status").textContent).toContain("Inputs match")
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(["organization", "authorization", "version"])("discards late history on %s change", async (change) => {
    let finish!: (value: unknown) => void
    fetcher.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<ReusableProgramReview candidate={candidate} scope={scope} />)
    fireEvent.click(screen.getByRole("button", { name: "Load existing runs" }))
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal
    view.rerender(<ReusableProgramReview candidate={change === "version" ? { ...candidate, versionLabel: "2" } : candidate} scope={change === "organization" ? { ...scope, organizationId: "4" } : change === "authorization" ? { ...scope, authorizationRevision: "revision-two" } : scope} />)
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ ok: true, json: async () => ({ runs: [row], nextCursor: null }) }))
    expect(screen.queryByText(/Run #42/)).toBeNull()
  })
})
