import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useHistoryPeriod } from "../../../../web/lib/use-history-period"

const navigation = vi.hoisted(() => ({ query: "" }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => "/sales",
}))

function navigate(query: string, hash = "") {
  navigation.query = query
  window.history.replaceState(null, "", `/sales?${query}${hash}`)
}

describe("history period navigation", () => {
  beforeEach(() => { navigate("") })

  it("distinguishes a malformed or reversed link from an intentional all-history selection", () => {
    navigate("period=custom:2023-01-01:2022-01-01")
    const { result, rerender } = renderHook(() => useHistoryPeriod())
    expect(result.current[2]).toBe(true)
    navigate("period=all")
    rerender()
    expect(result.current[0]).toBe("all")
    expect(result.current[2]).toBe(false)
  })

  it("restores custom dates on navigation and preserves unrelated company and currency filters", () => {
    navigate("tab=orders&filter=companyId:7&filter=currencyId:2", "#overview")
    const { result, rerender } = renderHook(() => useHistoryPeriod())
    const period = { kind: "custom" as const, from: "1940-01-01", through: "2023-12-31" }
    act(() => result.current[1](period))
    expect(result.current[0]).toEqual(period)
    const query = new URLSearchParams(window.location.search)
    expect(query.get("tab")).toBe("orders")
    expect(query.getAll("filter")).toEqual(["companyId:7", "currencyId:2"])
    expect(query.get("period")).toBe("custom:1940-01-01:2023-12-31")
    expect(window.location.hash).toBe("#overview")
    navigate("period=7d")
    rerender()
    expect(result.current[0]).toBe("7d")
  })

  it("restores the committed period on remount before Next updates its search snapshot", () => {
    navigate("period=all")
    const first = renderHook(() => useHistoryPeriod())
    act(() => first.result.current[1]("180d"))
    expect(new URLSearchParams(window.location.search).get("period")).toBe("180d")
    expect(navigation.query).toBe("period=all")
    first.unmount()

    const remounted = renderHook(() => useHistoryPeriod())
    expect(remounted.result.current[0]).toBe("180d")
    expect(remounted.result.current[2]).toBe(false)
  })
})
