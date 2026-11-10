import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { DataImportWorkspace } from "../../../../web/lib/data-import-workspace"
import { apiFetch } from "../../../../web/lib/api-fetch"

const { session } = vi.hoisted(() => ({
  session: {
    identity: "operator-one",
    organizationId: 42,
    activeCompanyReady: true,
  },
}))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => session }))
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({
  useOperatingCompanyId: () => 7,
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
vi.mock("../../../../web/lib/api-fetch", () => ({ apiFetch: vi.fn() }))
vi.mock("../../../../web/lib/guided-import-wizard", () => ({
  GuidedImportWizard: () => <p>Guided workflow</p>,
}))
vi.mock("../../../../web/lib/import-review-workspace", () => ({
  ImportReviewWorkspace: () => <p>Legacy source decisions</p>,
}))
vi.mock("../../../../web/lib/saved-import-workspace", () => ({
  SavedImportWorkspace: () => <p>Saved import workflow</p>,
}))

afterEach(() => {
  cleanup()
  session.organizationId = 42
  vi.mocked(apiFetch).mockReset()
  window.localStorage.clear()
  window.history.replaceState(null, "", "/")
})

function mount(urlSearch?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const workspace = (search?: string) => (
    <QueryClientProvider client={client}>
      <DataImportWorkspace
        organizationId={42}
        urlSearch={search}
        sourceHistory={<h2>Source datasets</h2>}
      />
    </QueryClientProvider>
  )
  const view = render(workspace(urlSearch))
  return (search: string) => view.rerender(workspace(search))
}

it("puts import shortcuts and permission feedback above history without treating denied data as empty", async () => {
  vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 403 }))
  mount()
  const alert = await screen.findByRole("alert")
  expect(alert.textContent).toContain(
    "File imports require an unrestricted company administrator",
  )
  expect(screen.queryByText(/No saved file tasks yet/)).toBeNull()
  expect(
    (
      screen.getByRole("button", {
        name: "Upload source files",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true)
  const datasets = screen.getByRole("heading", { name: "Source datasets" })
  for (const action of [
    "Start import",
    "Continue saved import",
    "Review source history",
  ]) {
    const link = screen.getByRole("link", { name: action })
    expect(
      link.compareDocumentPosition(datasets) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(document.querySelector(link.getAttribute("href")!)).toBeTruthy()
  }
})

it("does not load source data for an unrelated organization", () => {
  session.organizationId = 43
  mount()
  expect(
    screen.getByText(
      /Select an operating company to start or review an import/,
    ),
  ).toBeTruthy()
  expect(screen.queryByRole("heading", { name: "Source datasets" })).toBeNull()
  expect(apiFetch).not.toHaveBeenCalled()
})

it("opens a saved task link when navigating within the existing Settings section", async () => {
  vi.mocked(apiFetch).mockImplementation(async () =>
    Response.json({ tasks: [] }),
  )
  const navigate = mount("section=imports")
  await screen.findByText(/No saved file tasks yet/)
  navigate(
    `section=imports&importTask=${"a".repeat(32)}&importCompany=7&importView=results`,
  )
  expect(await screen.findByText("Saved import workflow")).toBeTruthy()
  expect(screen.queryByRole("link", { name: "Start import" })).toBeNull()
  navigate(
    `section=imports&importTask=${"a".repeat(32)}&importCompany=8&importView=results`,
  )
  expect(await screen.findByRole("link", { name: "Start import" })).toBeTruthy()
  expect(screen.queryByText("Saved import workflow")).toBeNull()
})
