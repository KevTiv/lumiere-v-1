import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useAssistantNativeFormController } from "./assistant-native-form-provider"

const request = (requestId = "request-1", scopeKey = "actor:org:company") => ({
  requestId,
  scopeKey,
  moduleId: "sales",
  tabId: "orders",
  prompt: "Prepare an order for review",
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("assistant native form handoff lifetime", () => {
  it("admits one outstanding request and never replaces it with a second request", () => {
    const hook = renderHook(() =>
      useAssistantNativeFormController("actor:org:company"),
    )
    act(() => {
      expect(hook.result.current.requestForm(request())).toBe("pending")
      expect(hook.result.current.requestForm(request("request-2"))).toBe("busy")
    })
    expect(hook.result.current.pending?.requestId).toBe("request-1")
    act(() => hook.result.current.settle("wrong-request", "opened"))
    expect(hook.result.current.pending?.requestId).toBe("request-1")
    act(() => hook.result.current.settle("request-1", "opened"))
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.outcome?.status).toBe("opened")
  })

  it("drops requests and outcomes across actor, organization or company scope changes", () => {
    const hook = renderHook(
      ({ scope }) => useAssistantNativeFormController(scope),
      { initialProps: { scope: "actor:org:company" } },
    )
    act(() => {
      hook.result.current.requestForm(request())
    })
    hook.rerender({ scope: "other-actor:org:company" })
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.isCurrent("request-1")).toBe(false)
    act(() => {
      hook.result.current.settle("request-1", "opened")
      expect(hook.result.current.requestForm(request())).toBe("scope_changed")
    })
    expect(hook.result.current.outcome).toBeNull()
  })

  it("expires an unmounted or unavailable destination without opening it later", () => {
    vi.useFakeTimers()
    const hook = renderHook(() =>
      useAssistantNativeFormController("actor:org:company"),
    )
    act(() => {
      hook.result.current.requestForm(request())
    })
    act(() => vi.advanceTimersByTime(15_000))
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.outcome?.status).toBe("unavailable")
    expect(hook.result.current.isCurrent("request-1")).toBe(false)
    act(() => hook.result.current.settle("request-1", "opened"))
    expect(hook.result.current.outcome?.status).toBe("unavailable")
  })

  it("cancels only the exact request and rejects unscoped handoffs", () => {
    const hook = renderHook(() =>
      useAssistantNativeFormController("actor:org:company"),
    )
    act(() => {
      expect(
        hook.result.current.requestForm(request("wrong-scope", "other")),
      ).toBe("scope_changed")
      hook.result.current.requestForm(request())
      hook.result.current.cancel("wrong-request")
    })
    expect(hook.result.current.pending?.requestId).toBe("request-1")
    act(() => hook.result.current.cancel("request-1"))
    expect(hook.result.current.pending).toBeNull()
    expect(hook.result.current.outcome).toBeNull()
  })
})
