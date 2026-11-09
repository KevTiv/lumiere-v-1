import { act, cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "../../../query-hooks/node_modules/@tanstack/react-query"
import {
  useDeletedDocuments,
  useDocumentFolders,
  useDocuments,
  useDocumentVersions,
} from "../../../query-hooks/src/hooks/documents"
import { useDeletedDocumentFolders } from "../../../query-hooks/src/hooks/document-locations"
import { moduleCollection } from "../lib/module-data-state"

const transport = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("../../../query-hooks/src/http", () => ({
  apiFetch: async (path: string) => Response.json({ data: await transport.read(path) }),
  fetchQueryList: transport.read,
  rqBigIntKey: String,
}))

const resources = [
  "documents",
  "documents-deleted",
  "document-folders",
  "document-folders-deleted",
  "document-versions",
] as const

function Workspace() {
  const reads = [
    { resource: resources[0], ...moduleCollection(useDocuments(7n)) },
    { resource: resources[1], ...moduleCollection(useDeletedDocuments(7n)) },
    { resource: resources[2], ...moduleCollection(useDocumentFolders(7n)) },
    {
      resource: resources[3],
      ...moduleCollection(useDeletedDocumentFolders(7n, 3n, true)),
    },
    { resource: resources[4], ...moduleCollection(useDocumentVersions(7n)) },
  ]
  return (
    <main>
      {reads.map(({ resource, rows, state }) => (
        <section key={resource} aria-label={resource}>
          {state.status === "error" || state.status === "denied" ? (
            <p role="alert">Refresh unavailable</p>
          ) : null}
          <ul>
            {rows.map((row) => (
              <li key={String(row.id)}>{String(row.name)}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}

let client: QueryClient

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
    await vi.advanceTimersByTimeAsync(0)
  })
}

function mountWorkspace() {
  render(
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>,
  )
}

function expectVisibleRows(count: number) {
  for (const resource of resources) {
    expect(
      within(screen.getByRole("region", { name: resource })).queryAllByRole(
        "listitem",
      ),
    ).toHaveLength(count)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  focusManager.setFocused(true)
  transport.read.mockReset()
  transport.read.mockResolvedValue([
    { id: "41", organizationId: "7", name: "Previously permitted row" },
  ])
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  client.clear()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

describe("document HTTP refresh in a mounted workspace", () => {
  it("removes rows revoked by ancestor access on every document surface after 15 seconds", async () => {
    mountWorkspace()
    await advance(0)
    expectVisibleRows(1)
    expect(transport.read).toHaveBeenCalledTimes(5)

    // The authoritative tree no longer projects the previously visible row.
    transport.read.mockResolvedValue([])
    await advance(14_999)
    expectVisibleRows(1)
    expect(transport.read).toHaveBeenCalledTimes(5)
    await advance(2)
    expect(transport.read).toHaveBeenCalledTimes(10)
    expectVisibleRows(0)
  })

  it("pauses background polling and replaces retained rows immediately on return", async () => {
    mountWorkspace()
    await advance(0)
    expectVisibleRows(1)
    act(() => focusManager.setFocused(false))
    transport.read.mockResolvedValue([])
    await advance(45_000)
    expect(transport.read).toHaveBeenCalledTimes(5)

    act(() => focusManager.setFocused(true))
    await advance(0)
    expect(transport.read).toHaveBeenCalledTimes(10)
    expectVisibleRows(0)
  })

  it("rechecks a still-fresh cache on focus and hides it when resource access is denied", async () => {
    mountWorkspace()
    await advance(0)
    expectVisibleRows(1)
    act(() => focusManager.setFocused(false))
    transport.read.mockRejectedValue(
      Object.assign(new Error("Document read permission denied"), {
        status: 403,
      }),
    )
    await advance(1_000)
    act(() => focusManager.setFocused(true))
    await advance(0)
    expect(transport.read).toHaveBeenCalledTimes(10)
    expectVisibleRows(0)
    expect(screen.getAllByRole("alert")).toHaveLength(5)
  })
})
