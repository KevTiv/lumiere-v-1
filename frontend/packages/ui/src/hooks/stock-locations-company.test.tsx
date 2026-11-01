import { createElement, type ReactNode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "../../../query-hooks/node_modules/@tanstack/react-query"

const state = vi.hoisted(() => ({ companyId: 41, ready: true, rows: vi.fn() }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ activeCompanyId: state.companyId, activeCompanyReady: state.ready }) }))
vi.mock("../../../query-hooks/src/http", () => ({
  apiFetch: vi.fn(), fetchQueryList: state.rows, rqBigIntKey: String,
  coalesceQueryInitialData: (rows: unknown) => rows,
}))
import { useStockLocations } from "../../../query-hooks/src/hooks/inventory/stock-operations"

afterEach(() => { cleanup(); state.rows.mockReset(); state.companyId = 41; state.ready = true })

it("reads the selected company without reusing another company's server seed", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const seed = [{ id: 1n, name: "Primary company location", companyId: 41n }]
  state.rows.mockResolvedValueOnce(seed)
  const hook = renderHook(() => useStockLocations(7n, seed as Parameters<typeof useStockLocations>[1]), { wrapper })
  await waitFor(() => expect(hook.result.current.data).toEqual(seed))
  expect(state.rows).toHaveBeenLastCalledWith("/api/query/stock-locations?companyId=41", expect.any(String))
  let finish: (rows: typeof seed) => void = () => {}
  state.rows.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  state.companyId = 42
  hook.rerender()
  expect(hook.result.current.data).toBeUndefined()
  await waitFor(() => expect(state.rows).toHaveBeenLastCalledWith("/api/query/stock-locations?companyId=42", expect.any(String)))
  const selected = [{ id: 2n, name: "Selected company location", companyId: 42n }]
  await act(async () => finish(selected))
  await waitFor(() => expect(hook.result.current.data).toEqual(selected))
  expect(client.getQueryData(["stock-locations", "7", "company", 41])).toEqual(seed)
  expect(client.getQueryData(["stock-locations", "7", "company", 42])).toEqual(selected)
  await act(async () => { await client.invalidateQueries({ queryKey: ["stock-locations", "7"], refetchType: "none" }) })
  expect(client.getQueryState(["stock-locations", "7", "company", 41])?.isInvalidated).toBe(true)
  expect(client.getQueryState(["stock-locations", "7", "company", 42])?.isInvalidated).toBe(true)
  client.clear()
})

it("waits for company scope before reading or exposing a server seed", () => {
  state.ready = false
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => useStockLocations(7n, [{ id: 1n }] as Parameters<typeof useStockLocations>[1]), { wrapper })
  expect(hook.result.current.data).toBeUndefined()
  expect(hook.result.current.fetchStatus).toBe("idle")
  expect(state.rows).not.toHaveBeenCalled()
  client.clear()
})
