import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AvailableHistory } from "../../../../web/components/available-history"
import { apiFetch } from "../../../../web/lib/api-fetch"
import { sourceHistoryCoverage, sourceHistoryRows } from "../../../../web/lib/history-data.fixtures"
import { historyQueryKey, resetHistoryQueries } from "../../../../web/lib/history-data"
import { chooseSelectValue } from "../components/select-test-utils"

vi.mock("../../../../web/lib/api-fetch", () => ({ apiFetch: vi.fn() }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "operator-one" }) }))
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({ useOperatingCompanyId: () => 7 }))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? "")),
  }),
}))

const request = vi.mocked(apiFetch)
const clients: QueryClient[] = []
const queryUrl = (input: string | URL | Request) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://example.test")
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })

function mount(companyId = 7, actorIdentity = "operator-one") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  const component = (company: number, actor: string) => <QueryClientProvider client={client}><AvailableHistory organizationId={42} companyId={company} actorIdentity={actor} timeZone="Africa/Kigali" /></QueryClientProvider>
  const view = render(component(companyId, actorIdentity))
  return { ...view, client, changeScope: (company: number, actor = actorIdentity) => view.rerender(component(company, actor)) }
}

beforeEach(() => {
  request.mockReset()
  request.mockImplementation(async (input) => {
    const url = queryUrl(input), company = Number(url.searchParams.get("companyId"))
    return json(url.pathname.endsWith("coverage") ? sourceHistoryCoverage(company) : sourceHistoryRows(company))
  })
})

afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
})

describe("Available source history", () => {
  it("opens all history, including 2022 and undated observations, with inspectable original values", async () => {
    mount()
    expect(await screen.findByText("Historical sale observation")).toBeTruthy()
    expect(screen.getByText("Undated source observation")).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Date range" }).textContent).toContain("All history")
    const rowsCall = request.mock.calls.map(([input]) => queryUrl(input)).find((url) => url.pathname.endsWith("rows"))!
    expect(rowsCall.searchParams.get("from")).toBeNull()
    expect(rowsCall.searchParams.get("snapshot")).toBe("scope-42-7-v1")
    fireEvent.click(screen.getAllByText("Inspect source and values")[1]!)
    expect(screen.getByText("January")).toBeTruthy()
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0)
    expect(screen.getByText(/Confirmed source values still need their business import/)).toBeTruthy()
  })

  it("navigates any year/month, applies complete custom dates, and excludes bounds for unknown dates", async () => {
    mount()
    await screen.findByText("Historical sale observation")
    chooseSelectValue(screen.getByRole("combobox", { name: "Jump to year" }), "2022")
    await waitFor(() => expect(request.mock.calls.some(([input]) => queryUrl(input).searchParams.get("from") === "2022-01-01")).toBe(true))
    chooseSelectValue(screen.getByRole("combobox", { name: "Jump to month" }), "10")
    await waitFor(() => expect(request.mock.calls.some(([input]) => queryUrl(input).searchParams.get("toExclusive") === "2022-11-01")).toBe(true))
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1940-01-01" } })
    fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2023-12-31" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply dates" }))
    await waitFor(() => expect(request.mock.calls.some(([input]) => {
      const params = queryUrl(input).searchParams
      return params.get("from") === "1940-01-01" && params.get("toExclusive") === "2024-01-01"
    })).toBe(true))
    chooseSelectValue(screen.getByRole("combobox", { name: "Date quality" }), "undated")
    await waitFor(() => {
      const url = request.mock.calls.map(([input]) => queryUrl(input)).findLast((url) => url.pathname.endsWith("rows"))!
      expect(url.searchParams.get("dateMode")).toBe("undated")
      expect(url.searchParams.has("from")).toBe(false)
      expect(url.searchParams.has("toExclusive")).toBe(false)
    })
    expect(screen.getByRole("combobox", { name: "Date range" }).hasAttribute("disabled")).toBe(true)
  })

  it("loads additional rows with the same authorized scope, filters and snapshot", async () => {
    request.mockImplementation(async (input) => {
      const url = queryUrl(input)
      if (url.pathname.endsWith("coverage")) return json(sourceHistoryCoverage())
      const fixture = sourceHistoryRows(), next = url.searchParams.has("cursor")
      return json({ ...fixture, data: [fixture.data[next ? 1 : 0]], nextCursor: next ? null : "next-row" })
    })
    mount()
    await screen.findByText("Historical sale observation")
    fireEvent.click(screen.getByRole("button", { name: "Load more rows" }))
    expect(await screen.findByText("Undated source observation")).toBeTruthy()
    expect(screen.getByText("Historical sale observation")).toBeTruthy()
    const next = request.mock.calls.map(([input]) => queryUrl(input)).find((url) => url.searchParams.get("cursor") === "next-row")!
    expect(next.searchParams.get("companyId")).toBe("7")
    expect(next.searchParams.get("snapshot")).toBe("scope-42-7-v1")
    expect(screen.queryByRole("button", { name: "Load more rows" })).toBeNull()
  })

  it("clears old-company rows immediately and waits for the new company's coverage", async () => {
    let resolveCoverage: (response: Response) => void = () => {}
    const delayedCoverage = new Promise<Response>((resolve) => { resolveCoverage = resolve })
    request.mockImplementation(async (input) => {
      const url = queryUrl(input), company = Number(url.searchParams.get("companyId"))
      if (company === 8 && url.pathname.endsWith("coverage")) return delayedCoverage
      if (url.pathname.endsWith("coverage")) return json(sourceHistoryCoverage(company))
      const fixture = sourceHistoryRows(company)
      return json({ ...fixture, data: [{ ...fixture.data[0], label: `Company ${company} source row` }] })
    })
    const view = mount()
    await screen.findByText("Company 7 source row")
    view.changeScope(8)
    expect(screen.queryByText("Company 7 source row")).toBeNull()
    expect(request.mock.calls.some(([input]) => {
      const url = queryUrl(input)
      return url.pathname.endsWith("rows") && url.searchParams.get("companyId") === "8"
    })).toBe(false)
    await act(async () => { resolveCoverage(json(sourceHistoryCoverage(8))) })
    expect(await screen.findByText("Company 8 source row")).toBeTruthy()
    expect(screen.queryByText("Company 7 source row")).toBeNull()
  })

  it("shows access failure instead of stale rows or an empty-history claim after an actor change", async () => {
    const view = mount()
    await screen.findByText("Historical sale observation")
    request.mockImplementation(async () => json({ error: "forbidden" }, 403))
    view.changeScope(7, "operator-without-access")
    expect(screen.queryByText("Historical sale observation")).toBeNull()
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByText("Source history is restricted for this session or company.")).toBeTruthy()
    expect(screen.queryByText(/No saved source history is available/)).toBeNull()
    expect(screen.queryByText("Historical sale observation")).toBeNull()
  })

  it("hides saved rows and dataset names when a current company's access revalidation fails", async () => {
    mount()
    await screen.findByText("Historical sale observation")
    request.mockImplementation(async () => json({ error: "forbidden" }, 403))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(screen.queryByText("Historical sale observation")).toBeNull())
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.queryByText("Historical sale observation")).toBeNull()
    expect(screen.queryByText("Historic shop source")).toBeNull()
    expect(screen.queryByText(/No saved source history is available/)).toBeNull()
  })

  it("rejects a changed snapshot on continuation and keeps a clear recovery action", async () => {
    request.mockImplementation(async (input) => {
      const url = queryUrl(input)
      if (url.pathname.endsWith("coverage")) return json(sourceHistoryCoverage())
      const fixture = sourceHistoryRows(), next = url.searchParams.has("cursor")
      return json({ ...fixture, snapshot: next ? "changed-snapshot" : fixture.snapshot, data: [fixture.data[next ? 1 : 0]], nextCursor: next ? null : "next-row" })
    })
    mount()
    await screen.findByText("Historical sale observation")
    fireEvent.click(screen.getByRole("button", { name: "Load more rows" }))
    expect(await screen.findByText("Source history changed while loading. Refresh to see the current rows.")).toBeTruthy()
    expect(screen.queryByText("Historical sale observation")).toBeNull()
    expect(screen.queryByText("Undated source observation")).toBeNull()
    expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false)
  })

  it("updates saved-source coverage and rows automatically from page one after a review change", async () => {
    let saved = false
    request.mockImplementation(async (input) => {
      const url = queryUrl(input)
      const coverage = sourceHistoryCoverage()
      const rows = sourceHistoryRows()
      if (!saved) {
        if (url.pathname.endsWith("coverage")) return json(coverage)
        const next = url.searchParams.has("cursor")
        return json({ ...rows, data: [rows.data[next ? 1 : 0]], nextCursor: next ? null : "old-next-row" })
      }
      const snapshot = "scope-42-7-v2"
      if (url.pathname.endsWith("coverage")) {
        const totals = { ...coverage.totals, total: 3, dated: 2, states: { needs_review: 1, confirmed: 2, excluded: 0 } }
        return json({ ...coverage, snapshot, totals, datasets: [{ ...coverage.datasets[0], ...totals }], years: [{ year: 2022, count: 2 }], months: [{ month: "2022-10", count: 2 }] })
      }
      if (url.searchParams.get("snapshot") !== snapshot || url.searchParams.has("cursor")) {
        return json({ error: "Old source snapshot cannot continue." }, 409)
      }
      return json({ ...rows, snapshot, data: [...rows.data, { ...rows.data[0], id: "103", label: "Newly saved observation", revision: 1 }] })
    })
    const { client } = mount()
    await screen.findByText("Historical sale observation")
    fireEvent.click(screen.getByRole("button", { name: "Load more rows" }))
    await screen.findByText("Undated source observation")
    const scope = { organizationId: 42, companyId: 7, actorIdentity: "operator-one" }
    client.setQueryDefaults(["available-history"], { gcTime: Infinity })
    const unrelatedKeys = [
      historyQueryKey("coverage", { ...scope, companyId: 8 }),
      historyQueryKey("coverage", { ...scope, organizationId: 43 }),
      historyQueryKey("coverage", { ...scope, actorIdentity: "operator-two" }),
    ]
    for (const key of unrelatedKeys) client.setQueryData(key, { untouched: true })
    saved = true
    request.mockClear()
    // This is the same scoped reset invoked by upload, save-for-review and review decisions.
    await act(async () => { await resetHistoryQueries(client, scope) })
    expect(await screen.findByText("Newly saved observation")).toBeTruthy()
    expect(screen.getByText("3 source rows loaded")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(request.mock.calls.some(([input]) => queryUrl(input).searchParams.has("cursor"))).toBe(false)
    for (const key of unrelatedKeys) expect(client.getQueryData(key)).toEqual({ untouched: true })
  })
})
