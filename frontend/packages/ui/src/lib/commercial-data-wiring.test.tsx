import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { ContactConsentPanel } from "@/app/(modules)/crm/contact-consent-panel"
import { ForecastSnapshotReadback } from "@/app/(modules)/crm/forecast-snapshot-readback"
import { ContactRelationshipsPanel } from "@/app/(modules)/crm/contact-relationships-panel"
import { SegmentRulesPanel } from "@/app/(modules)/crm/segment-rules-panel"
import { OrderSummaryNotices } from "@/app/(modules)/sales/order-summary-notices"

const { fetchRows, retryConsent, updateParent, writeRules } = vi.hoisted(() => ({
  fetchRows: vi.fn(),
  retryConsent: vi.fn(),
  updateParent: vi.fn(async () => undefined),
  writeRules: vi.fn(async () => undefined),
}))

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      typeof options === "string" ? options : options?.defaultValue ?? key,
    i18n: { resolvedLanguage: "en-US" },
  }),
}))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({ checkPermission: () => ({ allowed: true }) }),
}))
vi.mock("@lumiere/stdb/read-models", () => ({
  contactPrimaryLabel: (row: { name: string }) => row.name,
}))
vi.mock("@lumiere/query-hooks/http", () => ({ fetchQueryList: fetchRows }))
vi.mock("@lumiere/query-hooks/hooks/auth", () => ({
  useRecordPrivacyConsent: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

const segmentRules = [{ id: 67, segmentId: 3, sequence: 0, field: "City", op: "Eq", valueText: "Kigali" }]

vi.mock("@lumiere/query-hooks/hooks/crm", () => {
  const query = (data: unknown[] = []) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
  const mutation = { isPending: false, mutateAsync: vi.fn() }
  return {
    useContactRelationships: () => query(),
    usePrivacyConsents: () => ({ ...query(), isError: true, error: { status: 503 }, refetch: retryConsent }),
    useCreateContactRelationship: () => mutation,
    useEndContactRelationship: () => mutation,
    useUpdateContactParent: () => ({ ...mutation, mutateAsync: updateParent }),
    useContactSegments: () => query([{ id: 3, isDynamic: true, name: "Rwanda customers", memberCount: 8 }]),
    useContactSegmentRules: () => query(segmentRules),
    useContactTags: () => query(),
    useEvaluateDynamicSegment: () => mutation,
    useSetContactSegmentRules: () => ({ ...mutation, mutateAsync: writeRules }),
  }
})

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn()
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= vi.fn()
  HTMLElement.prototype.releasePointerCapture ??= vi.fn()
})
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it("opens a contact's saved parent without enabling an untouched save", async () => {
  fetchRows.mockResolvedValue([
    { id: 5, name: "Child", parentId: 6 },
    { id: 6, name: "Saved parent", parentId: null },
  ])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ContactRelationshipsPanel organizationId={2} companyId={4n} contactId={5n} />
    </QueryClientProvider>,
  )
  await screen.findByText("Current parent: Saved parent")
  const trigger = screen.getByTestId("contact-parent-select")
  const save = screen.getByTestId<HTMLButtonElement>("contact-parent-save")
  expect(trigger.textContent).toBe("Saved parent")
  expect(save.disabled).toBe(true)
  fireEvent.click(save)
  expect(updateParent).not.toHaveBeenCalled()

  fireEvent.keyDown(trigger, { key: "ArrowDown" })
  fireEvent.click(await screen.findByRole("option", { name: "None" }))
  expect(save.disabled).toBe(false)
  fireEvent.click(save)
  await waitFor(() => expect(updateParent).toHaveBeenCalledOnce())
  expect(updateParent).toHaveBeenCalledWith({ companyId: 4n, contactId: 5n, parentId: null })
})

it("requires a preview and an explicit save before replacing saved segment rules", async () => {
  fetchRows.mockResolvedValue(segmentRules)
  render(<SegmentRulesPanel organizationId={2} />)
  fireEvent.keyDown(screen.getByLabelText("Dynamic segment"), { key: "ArrowDown" })
  fireEvent.click(await screen.findByRole("option", { name: "Rwanda customers" }))

  expect(writeRules).not.toHaveBeenCalled()
  expect(screen.queryByRole("button", { name: "Apply AU customer rules" })).toBeNull()
  const value = await screen.findByDisplayValue("Kigali")
  const review = screen.getByRole<HTMLButtonElement>("button", { name: "Review changes" })
  expect(review.disabled).toBe(true)
  fireEvent.change(value, { target: { value: "Huye" } })
  fireEvent.click(review)
  expect(screen.getByText("City · Equals · Huye")).toBeTruthy()
  expect(writeRules).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole("button", { name: "Save replacement rules" }))
  await waitFor(() => expect(writeRules).toHaveBeenCalledOnce())
  expect(writeRules).toHaveBeenCalledWith({
    segmentId: 3n,
    params: {
      replaceAll: true,
      rules: [{ field: { tag: "City" }, op: { tag: "Eq" }, valueText: "Huye", valueId: undefined }],
      metadata: undefined,
    },
  })
})

it("keeps Sales source notices independent and retries only the failed read", () => {
  const retryInvoice = vi.fn()
  render(<OrderSummaryNotices
    lines={{ status: "ready" }}
    transfers={{ status: "denied" }}
    invoices={{ status: "partial", onRetry: retryInvoice }}
  />)
  expect(screen.getByRole("region", { name: "sales.salesOrders.columns.deliverySummary" })).toBeTruthy()
  expect(screen.queryByRole("region", { name: "sales.orderLines.title" })).toBeNull()
  const invoice = screen.getByRole("region", { name: "sales.salesOrders.columns.invoiceSummary" })
  fireEvent.click(within(invoice).getByRole("button", { name: "Retry" }))
  expect(retryInvoice).toHaveBeenCalledOnce()
})

it("does not show a consent-history empty state for a failed read", () => {
  render(<ContactConsentPanel organizationId={2} contactId={5n} />)
  expect(screen.queryByText("No consent recorded")).toBeNull()
  const error = screen.getByRole("alert")
  fireEvent.click(within(error).getByRole("button", { name: "Retry" }))
  expect(retryConsent).toHaveBeenCalledOnce()
})

it("shows a saved forecast only for the selected company and keeps denied reads explicit", () => {
  const snapshot = {
    id: 12n,
    companyId: 4n,
    createdAt: "2026-11-15T12:00:00Z",
    periodStart: "2026-11-01T12:00:00Z",
    periodEnd: "2026-12-01T12:00:00Z",
    openCount: 3,
    weightedPipeline: 499.25,
  } as unknown as Parameters<typeof ForecastSnapshotReadback>[0]["rows"][number]
  const { rerender } = render(<ForecastSnapshotReadback companyId={4n} rows={[snapshot]} state={{ status: "ready" }} saving={false} />)
  expect(screen.getByText("499.25")).toBeTruthy()
  expect(screen.getByText(/Nov 1, 2026/)).toBeTruthy()

  rerender(<ForecastSnapshotReadback companyId={7n} rows={[snapshot]} state={{ status: "ready" }} saving={false} />)
  expect(screen.queryByText("499.25")).toBeNull()
  expect(screen.getByText("No forecast snapshots for this company.")).toBeTruthy()

  rerender(<ForecastSnapshotReadback companyId={4n} rows={[snapshot]} state={{ status: "denied" }} saving={false} />)
  expect(screen.queryByText("499.25")).toBeNull()
  expect(screen.queryByText("No forecast snapshots for this company.")).toBeNull()
  expect(screen.getByRole("status").textContent).toContain("You do not have access")
})
