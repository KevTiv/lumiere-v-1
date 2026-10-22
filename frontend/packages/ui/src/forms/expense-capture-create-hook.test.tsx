import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OperationRequestError } from "../../../api-client/src/operation-outcome"

// UI does not depend on React Query; mock the adapter resolved by its owning package.
vi.mock("../../../query-hooks/node_modules/@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (options: {
    mutationFn: (input: unknown) => Promise<void>
  }) => ({ mutateAsync: options.mutationFn }),
}))
const state = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("../../../query-hooks/src/http", () => ({
  apiFetch: state.fetch,
  fetchQueryList: vi.fn(),
  rqBigIntKey: (id: bigint) => String(id),
}))
import { useCreateExpense } from "../../../query-hooks/src/hooks/expenses"

afterEach(cleanup)
beforeEach(() => state.fetch.mockReset())
function mountedHook() {
  return renderHook(() => useCreateExpense(9n, 2n))
}
const input = {
  employeeId: 7n,
  currencyId: 3n,
  clientRequestId: "capture-hook-key",
}

describe("capture create transport errors", () => {
  it("preserves the typed definite rejection and server message", async () => {
    state.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Rate is inactive" }), {
        status: 422,
      }),
    )
    const hook = mountedHook()
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(input),
      ).rejects.toMatchObject({
        name: "OperationRequestError",
        status: 422,
        code: "invalid_input",
        retry: "never",
        message: "Rate is inactive",
      })
    })
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it("keeps reconcile disposition for server delivery uncertainty", async () => {
    state.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Delivery status unknown" }), {
        status: 503,
      }),
    )
    const hook = mountedHook()
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(input),
      ).rejects.toMatchObject({ status: 503, retry: "reconcile" })
    })
  })
  it("requires the operation acknowledgement and preserves a network error", async () => {
    state.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    )
    const hook = mountedHook()
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(input),
      ).rejects.toBeInstanceOf(OperationRequestError)
    })
    const lost = new TypeError("Network response lost")
    state.fetch.mockRejectedValueOnce(lost)
    await act(async () => {
      await expect(hook.result.current.mutateAsync(input)).rejects.toBe(lost)
    })
  })
})
