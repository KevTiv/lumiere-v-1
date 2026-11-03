import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { RunHistoryPanel } from "../../../../web/app/(modules)/ai-harness/run-history-panel"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it("opens evidence for the selected saved run without requesting lifecycle authority", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    runs: [{ runId: 42, status: "completed", skillId: 3, agentId: 4, stepCount: 2, tokensUsed: 120, startedAt: "2026-10-13T10:00:00Z" }],
    nextCursor: null,
  })))
  vi.stubGlobal("fetch", fetch)
  render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  const inspect = await screen.findByRole("link", { name: "Inspect", exact: true })
  expect(inspect.getAttribute("href")).toBe("/ai-harness?tab=evidence-reviewer&companyId=9&runId=42")
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith("/api/ai/evidence/runs/history", expect.objectContaining({
    method: "POST", body: JSON.stringify({ companyId: 9, cursor: null, limit: 20 }),
  }))
})

const run = (runId: number) => ({ runId, status: "completed", skillId: 3, agentId: 4, stepCount: 2, tokensUsed: 120, startedAt: "2026-10-13T10:00:00Z" })
const page = (runs: ReturnType<typeof run>[], nextCursor: string | null = null) => new Response(JSON.stringify({ runs, nextCursor }))

it("selects a loaded run only on explicit request and respects pending lifecycle work", async () => {
  const fetch = vi.fn().mockResolvedValue(page([run(42)]))
  const onSelectRun = vi.fn()
  vi.stubGlobal("fetch", fetch)
  const { rerender } = render(<RunHistoryPanel companyId={9} onSelectRun={onSelectRun} selectRunDisabled />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  const open = await screen.findByRole("button", { name: "Open run", exact: true })
  expect(onSelectRun).not.toHaveBeenCalled()
  expect(open.hasAttribute("disabled")).toBe(true)
  rerender(<RunHistoryPanel companyId={9} onSelectRun={onSelectRun} />)
  fireEvent.click(open)
  expect(onSelectRun).toHaveBeenCalledExactlyOnceWith(42)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByRole("link", { name: "Inspect", exact: true }).getAttribute("href")).toContain("runId=42")
})

it("distinguishes a service failure from empty history and retries successfully", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(page([]))
  vi.stubGlobal("fetch", fetch)
  render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  await screen.findByText("Run history unavailable")
  expect(screen.queryByText("No AI runs are available for this company.")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Try again", exact: true }))
  await screen.findByText("No AI runs are available for this company.")
  expect(screen.queryByText("Run history unavailable")).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each([401, 403])("removes loaded run metadata when access is rejected with %s", async (status) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(page([run(42)]))
    .mockResolvedValueOnce(new Response("{}", { status }))
  vi.stubGlobal("fetch", fetch)
  render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  await screen.findByRole("link", { name: "Inspect", exact: true })
  fireEvent.click(screen.getByRole("button", { name: "Refresh", exact: true }))
  await screen.findByText("Run history access required")
  expect(screen.queryByRole("link", { name: "Inspect", exact: true })).toBeNull()
  expect(screen.queryByText("Run #42")).toBeNull()
  expect(screen.getByRole("button", { name: "Check access again", exact: true })).toBeDefined()
  expect(screen.getByText(status === 401
    ? "Your session has expired. Sign in again, then check access."
    : "You do not have permission to view run history for this company. Ask an administrator to review your access.")).toBeDefined()
})

it("retries the failed older page without dropping or duplicating loaded runs", async () => {
  const cursor = "AAAAAAAAACo"
  const fetch = vi.fn()
    .mockResolvedValueOnce(page([run(42)], cursor))
    .mockRejectedValueOnce(new Error("connection interrupted"))
    .mockResolvedValueOnce(page([run(9)]))
  vi.stubGlobal("fetch", fetch)
  render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  fireEvent.click(await screen.findByRole("button", { name: "Load older runs", exact: true }))
  await screen.findByText("Run history unavailable")
  expect(screen.getByText("Run #42")).toBeDefined()
  fireEvent.click(screen.getByRole("button", { name: "Try again", exact: true }))
  await screen.findByText("Run #9")
  expect(screen.getAllByRole("link", { name: "Inspect", exact: true })).toHaveLength(2)
  const request = expect.objectContaining({ body: JSON.stringify({ companyId: 9, cursor, limit: 20 }) })
  expect(fetch).toHaveBeenNthCalledWith(2, "/api/ai/evidence/runs/history", request)
  expect(fetch).toHaveBeenNthCalledWith(3, "/api/ai/evidence/runs/history", request)
})

it("does not call malformed successful data an empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [{ runId: 42 }] }))))
  render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  await screen.findByText("The run history response was incomplete. Try again.")
  expect(screen.queryByText("No AI runs are available for this company.")).toBeNull()
})

it("cancels an in-flight history read when the company-scoped panel unmounts", () => {
  const fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
  vi.stubGlobal("fetch", fetch)
  const { unmount } = render(<RunHistoryPanel companyId={9} />)
  fireEvent.click(screen.getByRole("button", { name: "Load history", exact: true }))
  const signal = fetch.mock.calls[0]?.[1].signal as AbortSignal
  unmount()
  expect(signal.aborted).toBe(true)
})
