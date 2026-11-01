import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"

const controls = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, args?: { count?: number }) => key === "settings.importReview.continue" ? `Continue import (${args?.count} confirmed)` : key }) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "actor", organizationId: 7 }) }))
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({ useOperatingCompanyId: () => 3 }))
vi.mock("@lumiere/ui/hooks/use-identity-label-map", () => ({ useIdentityLabelMap: () => new Map() }))
vi.mock("@/lib/api-fetch", () => ({ apiFetch: controls.fetch }))
vi.mock("../../../../web/lib/history-data", () => ({ resetHistoryQueries: async () => undefined }))
vi.mock("../../../../web/lib/import-review-editor", () => ({
  ImportReviewEditor: () => null,
  ReviewRequestError: class extends Error { constructor(message: string, readonly definitive: boolean) { super(message) } },
}))
vi.mock("../../../../web/lib/import-review-bulk", () => ({ ImportReviewBulk: () => null }))
import { ImportReviewPanel } from "../../../../web/lib/import-review-workspace"

afterEach(cleanup)

function mount(allowImport?: boolean, initialId = "7") {
  const onContinue = vi.fn()
  const items = [{ id: "9", state: "confirmed", revision: 1, reason: "Reviewed", reviewedBy: "actor", reviewedAt: null, values: { name: "Eggs" },
    source: { key: "row-1", label: "Eggs", source: { file: "farm.csv", row: 2, sha256: "a".repeat(64) }, issue: "Reviewed source", fields: [{ key: "name", label: "Name", kind: "text", sourceValue: "Eggs", required: true }], proposed: { name: "Eggs" } } }]
  const batches = [{ id: "7", title: "Inspection evidence", targetEntity: "source_observation", sourceFile: "farm.csv", total: 1, pending: 0, confirmed: 1, excluded: 0 },
    { id: "8", title: "Other product batch", targetEntity: "product", sourceFile: "products.csv", total: 1, pending: 0, confirmed: 1, excluded: 0 }]
  controls.fetch.mockImplementation(async (url: string) => {
    if (url === "/api/import-reviews?companyId=3") return new Response(JSON.stringify({ data: batches }))
    const batch = batches.find(value => url.startsWith(`/api/import-reviews/${value.id}?`))
    if (batch) return new Response(JSON.stringify({ ...batch, items, history: [] }))
    throw new Error(`Unexpected read ${url}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ImportReviewPanel organizationId={7} companyId={3} initialId={initialId} allowImport={allowImport} onContinue={onContinue} /></QueryClientProvider>)
  return onContinue
}

it("inspection cannot expose import continuation even after selecting a confirmed product batch", async () => {
  const onContinue = mount(false)
  await screen.findByRole("heading", { name: "Inspection evidence" })
  expect(screen.queryByRole("button", { name: /Continue import/ })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: /Other product batch/ }))
  await screen.findByRole("heading", { name: "Other product batch" })
  expect(screen.queryByRole("button", { name: /Continue import/ })).toBeNull()
  expect(screen.queryByTestId("import-review-handoff-status")).toBeNull()
  expect(onContinue).not.toHaveBeenCalled()
})

it("ordinary review retains its confirmed product import continuation by default", async () => {
  mount(undefined, "8")
  expect(await screen.findByRole("button", { name: "Continue import (1 confirmed)" })).toHaveProperty("disabled", false)
})
