import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useExpenseAllocationReadback } from "../../../../web/app/(modules)/expenses/use-expense-allocation-readback"
import { StrictMode, type ReactNode } from "react"

const state = vi.hoisted(() => ({ query: {} as {
  data: { rows: unknown[]; snapshot: string }; isLoading: boolean; isError: boolean; isSuccess: boolean; isFetching: boolean;
  error?: unknown; refetch: ReturnType<typeof vi.fn>;
} }))
vi.mock("@lumiere/query-hooks/hooks/expenses-allocations", () => ({ useExpenseAllocations: () => state.query }))
const row = (patch: object = {}) => ({ id: "90", organizationId: "1", companyId: "2", expenseId: "7",
  projectId: "8", analyticAccountId: null, sharePercent: 100, amount: 12.345, billable: true, metadata: null, ...patch })
const scope = { organizationId: 1n, companyId: 2n, expenseId: 7n, identity: "actor" }
const snapshot = `v1:${"a".repeat(64)}`
function query(rows = [row()]) {
  const data = { rows, snapshot }
  return { data, isLoading: false, isError: false, isSuccess: true, isFetching: false,
    refetch: vi.fn(async () => ({ data })) }
}
afterEach(cleanup)

describe("saved allocation editor readback", () => {
  it("waits for the first verified read and retains its baseline across a failed refresh", async () => {
    state.query = { ...query([]), isLoading: true, isSuccess: false, isFetching: true }
    const { result, rerender } = renderHook(() => useExpenseAllocationReadback(scope, "Cannot verify", "Changed"))
    expect(result.current.initialized).toBe(false)
    state.query = query()
    rerender()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rows?.[0].projectId).toBe("8")
    state.query = { ...state.query, isError: true, isSuccess: false, error: { status: 503 } }
    rerender()
    expect(result.current.initialized).toBe(true)
    expect(result.current.ready).toBe(false)
    expect(result.current.rows?.[0].sharePercent).toBe("100")
    state.query = query()
    rerender()
    expect(result.current.ready).toBe(true)
    await act(async () => { expect(await result.current.verifyBeforeSave()).toBe(snapshot) })
    expect(state.query.refetch).toHaveBeenCalledTimes(1)
  })

  it("never replaces the editor baseline when a saved allocation changes", async () => {
    state.query = query()
    const { result, rerender } = renderHook(() => useExpenseAllocationReadback(scope, "Cannot verify", "Changed"))
    await waitFor(() => expect(result.current.ready).toBe(true))
    state.query = query([row({ projectId: "9" })])
    rerender()
    expect(result.current.rows?.[0].projectId).toBe("8")
    expect(result.current.error).toBe("Changed")
    expect(result.current.ready).toBe(false)
    await expect(result.current.verifyBeforeSave()).rejects.toThrow()
  })

  it("checks a fresh read before saving and blocks a changed or out-of-scope result", async () => {
    state.query = query()
    const { result } = renderHook(() => useExpenseAllocationReadback(scope, "Cannot verify", "Changed"))
    await waitFor(() => expect(result.current.ready).toBe(true))
    state.query.refetch.mockResolvedValue({ data: { rows: [row({ amount: 14 })], snapshot } })
    await expect(result.current.verifyBeforeSave()).rejects.toThrow("Changed")
    state.query.refetch.mockResolvedValue({ data: { rows: [row({ companyId: "3" })], snapshot } })
    await expect(result.current.verifyBeforeSave()).rejects.toThrow("Cannot verify")
  })

  it("rechecks current write admission after an awaited read and rejects another server snapshot", async () => {
    state.query = query()
    const { result, rerender } = renderHook(({ current }) => useExpenseAllocationReadback(current, "Cannot verify", "Changed"),
      { initialProps: { current: { ...scope, enabled: true } } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    state.query.refetch.mockResolvedValue({ data: { rows: [row()], snapshot: `v1:${"b".repeat(64)}` } })
    await expect(result.current.verifyBeforeSave()).rejects.toThrow("Changed")
    let resolve: ((value: unknown) => void) | undefined
    state.query.refetch.mockImplementation(() => new Promise((complete) => { resolve = complete }))
    const pending = result.current.verifyBeforeSave()
    const assertOldAdmission = result.current.assertCurrentAdmission
    rerender({ current: { ...scope, enabled: false } })
    expect(() => assertOldAdmission()).toThrow("Cannot verify")
    resolve?.({ data: { rows: [row()], snapshot } })
    await expect(pending).rejects.toThrow("Cannot verify")
  })

  it("clears protected saved data after denial or parent deletion and on actor/company changes", async () => {
    for (const status of [401, 403, 404, 410]) {
      state.query = query()
      const { result, rerender, unmount } = renderHook(({ current }) => useExpenseAllocationReadback(current, "Cannot verify", "Changed"), { initialProps: { current: scope } })
      await waitFor(() => expect(result.current.ready).toBe(true))
      state.query = { ...state.query, isError: true, isSuccess: false, error: { status } }
      rerender({ current: scope })
      expect(result.current.rows).toBeUndefined()
      expect(result.current.ready).toBe(false)
      state.query = { ...query(), isLoading: true, isSuccess: false, isFetching: true }
      rerender({ current: { ...scope, identity: "other", companyId: 3n } })
      expect(result.current.rows).toBeUndefined()
      unmount()
    }
  })

  it("invalidates a deferred save check through A → B → A even when the original snapshot still matches", async () => {
    state.query = query()
    const { result, rerender } = renderHook(({ current }) => useExpenseAllocationReadback(current, "Cannot verify", "Changed"),
      { initialProps: { current: scope }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> })
    await waitFor(() => expect(result.current.ready).toBe(true))
    let resolve: ((value: unknown) => void) | undefined
    state.query.refetch.mockImplementation(() => new Promise((complete) => { resolve = complete }))
    const post = vi.fn()
    const pending = result.current.verifyBeforeSave().then(post)
    const oldAssert = result.current.assertCurrentAdmission
    state.query = { ...query(), isLoading: true, isSuccess: false, isFetching: true }
    rerender({ current: { ...scope, companyId: 3n } })
    rerender({ current: scope })
    state.query = query()
    rerender({ current: scope })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(() => oldAssert()).toThrow("Cannot verify")
    resolve?.({ data: { rows: [row()], snapshot } })
    await expect(pending).rejects.toThrow("Cannot verify")
    expect(post).not.toHaveBeenCalled()
    expect(await result.current.verifyBeforeSave()).toBe(snapshot)
  })

  it("invalidates deferred reads when the editor unmounts", async () => {
    state.query = query()
    const { result, unmount } = renderHook(() => useExpenseAllocationReadback(scope, "Cannot verify", "Changed"))
    await waitFor(() => expect(result.current.ready).toBe(true))
    let resolve: ((value: unknown) => void) | undefined
    state.query.refetch.mockImplementation(() => new Promise((complete) => { resolve = complete }))
    const pending = result.current.verifyBeforeSave()
    unmount()
    resolve?.({ data: { rows: [row()], snapshot } })
    await expect(pending).rejects.toThrow("Cannot verify")
  })

  it("rejects masked/malformed initial rows and recognizes a verified empty allocation vector", async () => {
    state.query = query([row({ sharePercent: undefined })])
    const { result, rerender } = renderHook(() => useExpenseAllocationReadback(scope, "Cannot verify", "Changed"))
    await waitFor(() => expect(result.current.error).toBe("Cannot verify"))
    expect(result.current.initialized).toBe(false)
    state.query = query([])
    rerender()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.rows).toEqual([])
  })
})
