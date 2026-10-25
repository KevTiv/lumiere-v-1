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
