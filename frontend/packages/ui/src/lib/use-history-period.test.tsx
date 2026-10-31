import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useHistoryPeriod } from "../../../../web/lib/use-history-period"

const navigation = vi.hoisted(() => ({ query: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  usePathname: () => "/sales",
  useRouter: () => ({ replace: navigation.replace }),
}))

describe("history period navigation", () => {
  beforeEach(() => { navigation.query = ""; navigation.replace.mockReset() })

  it("distinguishes a malformed or reversed link from an intentional all-history selection", () => {
    navigation.query = "period=custom:2023-01-01:2022-01-01"
    const { result, rerender } = renderHook(() => useHistoryPeriod())
    expect(result.current[2]).toBe(true)
    navigation.query = "period=all"
    rerender()
    expect(result.current[0]).toBe("all")
    expect(result.current[2]).toBe(false)
  })

  it("restores custom dates on navigation and preserves unrelated company and currency filters", () => {
    navigation.query = "tab=orders&filter=companyId:7&filter=currencyId:2"
    const { result, rerender } = renderHook(() => useHistoryPeriod())
    const period = { kind: "custom" as const, from: "1940-01-01", through: "2023-12-31" }
    act(() => result.current[1](period))
    expect(result.current[0]).toEqual(period)
    const href = navigation.replace.mock.calls[0]?.[0] as string
    const query = new URL(href, "https://example.test").searchParams
    expect(query.getAll("filter")).toEqual(["companyId:7", "currencyId:2"])
    expect(query.get("period")).toBe("custom:1940-01-01:2023-12-31")
    navigation.query = "period=7d"
    rerender()
    expect(result.current[0]).toBe("7d")
  })
})
