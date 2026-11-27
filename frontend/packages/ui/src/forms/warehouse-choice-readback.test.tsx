import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { useWarehouses } from "../../../query-hooks/src/hooks/inventory/warehouses"

const fetchQueryList = vi.hoisted(() => vi.fn())

vi.mock("../../../query-hooks/src/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../query-hooks/src/http")>(),
  fetchQueryList,
}))

function WarehouseReadback() {
  const query = useWarehouses(4n, undefined, true, 22n)
  return <output>{query.data?.map(({ name }) => name).join(", ") || "No warehouses"}</output>
}

afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
  fetchQueryList.mockReset()
})

it("refreshes a fresh company cache and finds the saved warehouse when its tab regains focus", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchQueryList.mockResolvedValue([])
  render(<QueryClientProvider client={queryClient}><WarehouseReadback /></QueryClientProvider>)
  await waitFor(() => expect(queryClient.getQueryData(["warehouses", "4", "company", "22"])).toEqual([]))
  expect(fetchQueryList).toHaveBeenCalledOnce()
  expect(fetchQueryList).toHaveBeenCalledWith("/api/query/warehouses?companyId=22", expect.any(String))

  act(() => focusManager.setFocused(false))
  fetchQueryList.mockResolvedValue([{ id: "9", companyId: "22", name: "Saved warehouse" }])
  act(() => focusManager.setFocused(true))

  expect(await screen.findByText("Saved warehouse")).toBeTruthy()
  expect(fetchQueryList).toHaveBeenCalledTimes(2)
})
