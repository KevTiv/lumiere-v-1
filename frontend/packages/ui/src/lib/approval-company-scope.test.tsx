import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { useApprovalInboxCount } from "@lumiere/query-hooks/hooks/approvals"

const request = vi.hoisted(() => vi.fn())
vi.mock("../../../query-hooks/src/http", () => ({ apiFetch: request }))

afterEach(cleanup)

it("uses the active-company inbox and hides stale approval counts after switching", async () => {
  request.mockReset()
  request
    .mockResolvedValueOnce(Response.json({ data: [
      { id: 1, companyId: 7, status: "Open" },
      { id: 2, company_id: 7, status: "Claimed" },
      { id: 3, companyId: 8, status: "Open" },
      { id: 4, companyId: 7, status: "Approved" },
    ] }))
    .mockResolvedValueOnce(Response.json({ data: [
      { id: 5, companyId: 8, status: "Open" },
    ] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  const { result, rerender, unmount } = renderHook<ReturnType<typeof useApprovalInboxCount>, { company: number | null }>(
    ({ company }: { company: number | null }) => useApprovalInboxCount(1, company),
    { wrapper: Wrapper, initialProps: { company: 7 } },
  )
  await waitFor(() => expect(result.current.count).toBe(2))
  rerender({ company: 8 })
  expect(result.current.count).toBe(0)
  await waitFor(() => expect(result.current.count).toBe(1))
  rerender({ company: null })
  expect(result.current.count).toBe(0)
  expect(request.mock.calls).toEqual([
    ["/api/query/workflow-human-tasks-inbox?companyId=7"],
    ["/api/query/workflow-human-tasks-inbox?companyId=8"],
  ])
  unmount()
  client.clear()
})
