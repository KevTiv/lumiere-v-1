import { createHash, webcrypto } from "node:crypto"
import { useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { DocumentViewerDialog } from "../../../../web/components/document-viewer-dialog"

type DocumentRow = {
  id: string
  organizationId: number
  companyId: number
  name: string
  fileName: string
  fileSize: number
  mimetype: string
  checksum: string
  url: string
  isDeleted: boolean
  currentVersionId: number
  versionCount: number
}
type VersionRow = Omit<
  DocumentRow,
  "companyId" | "isDeleted" | "currentVersionId" | "versionCount"
> & { documentId: number; versionNumber: number; isCurrent: boolean }
const fixture = vi.hoisted(() => ({
  session: {
    identity: "actor-one",
    connected: true,
    organizationId: 7,
    activeCompanyId: 3,
    activeCompanyReady: true,
    companyIds: [3, 4],
  },
  currentUser: { id: "actor-one" },
  permissionsReady: true,
  allowed: true,
  versionsAllowed: true,
  documents: [] as DocumentRow[],
  versions: [] as VersionRow[],
  files: new Map<string, { bytes: Uint8Array; mime: string }>(),
  fetcher: vi.fn(),
  permission: vi.fn(),
}))

vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => fixture.session,
}))
vi.mock("@lumiere/ui/lib/rbac-context", () => ({
  useRBAC: () => ({
    currentUser: fixture.currentUser,
    permissionsReady: fixture.permissionsReady,
    checkPermission: fixture.permission,
  }),
}))
vi.mock("../../../../web/lib/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => fixture.fetcher(...args),
}))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { defaultValue?: string; [key: string]: unknown },
    ) =>
      (options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => String(options?.[name] ?? name),
      ),
  }),
}))

const props = { organizationId: 7n, documentId: "1", onOpenChange: vi.fn() }
const currentUrl = "/api/documents/blobs/object/7/default/current"
const olderUrl = "/api/documents/blobs/object/7/default/older"

function file(
  body: string | Uint8Array,
  name = "records.csv",
  mime = "text/csv",
) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  return {
    bytes,
    fileName: name,
    fileSize: bytes.byteLength,
    mimetype: mime,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  }
}

function setupFile(body: string | Uint8Array, name?: string, mime?: string) {
  const current = file(body, name, mime)
  fixture.documents = [
    {
      ...current,
      id: "1",
      organizationId: 7,
      companyId: 3,
      name: "Farm records",
      url: currentUrl,
      isDeleted: false,
      currentVersionId: 11,
      versionCount: 2,
    },
  ]
  fixture.versions = [
    {
      ...current,
      id: "11",
      documentId: 1,
      organizationId: 7,
      name: "Current file",
      versionNumber: 2,
      isCurrent: true,
      url: currentUrl,
    },
  ]
  fixture.files.set(currentUrl, {
    bytes: current.bytes,
    mime: current.mimetype,
  })
}

function responseFor(url: string): Response {
  if (url.startsWith("/api/query/documents?"))
    return Response.json({ data: fixture.documents })
  if (url.startsWith("/api/query/document-versions?"))
    return Response.json({ data: fixture.versions })
  const stored = fixture.files.get(url.split("?")[0]!)
  return stored
    ? new Response(new Uint8Array(stored.bytes), {
        headers: { "content-type": stored.mime },
      })
    : new Response("missing", { status: 404 })
}

const blobRequests = () =>
  fixture.fetcher.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/documents/blobs/object/"),
  )

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined")
    Object.defineProperty(globalThis, "PointerEvent", {
      value: MouseEvent,
      configurable: true,
    })
})

beforeEach(() => {
  vi.clearAllMocks()
  fixture.session = {
    identity: "actor-one",
    connected: true,
    organizationId: 7,
    activeCompanyId: 3,
    activeCompanyReady: true,
    companyIds: [3, 4],
  }
  fixture.currentUser = { id: "actor-one" }
  fixture.permissionsReady = true
  fixture.allowed = true
  fixture.versionsAllowed = true
  fixture.files.clear()
  fixture.permission.mockImplementation((resource: string) => ({
    allowed:
      fixture.allowed &&
      (resource !== "document_version" || fixture.versionsAllowed),
  }))
  fixture.fetcher.mockImplementation(async (url: string) => responseFor(url))
  setupFile("Name,Amount\nCoffee,1200\n")
  const older = file("Name,Amount\nTea,300\n", "older.csv")
  fixture.versions.push({
    ...older,
    id: "10",
    documentId: 1,
    organizationId: 7,
    name: "Older file",
    versionNumber: 1,
    isCurrent: false,
    url: olderUrl,
  })
  fixture.files.set(olderUrl, { bytes: older.bytes, mime: older.mimetype })
  vi.stubGlobal("crypto", webcrypto)
  let objectUrlNumber = 0
  URL.createObjectURL = vi
    .fn()
    .mockImplementation(() => `blob:document-${++objectUrlNumber}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("shared saved-file viewer", () => {
  it("shows exact CSV content with version selection and fresh authorized reads", async () => {
    render(<DocumentViewerDialog {...props} />)
    const table = await screen.findByRole("table", { name: "CSV preview" })
    expect(within(table).getByRole("cell", { name: "Coffee" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "File version" })).toBeTruthy()
    expect(blobRequests()[0]?.[0]).toBe(
      `${currentUrl}?sha256=${fixture.documents[0]!.checksum}`,
    )
    expect(blobRequests()[0]?.[1]).toEqual(
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        redirect: "error",
      }),
    )
    fireEvent.click(screen.getByRole("combobox", { name: "File version" }))
    fireEvent.click(await screen.findByRole("option", { name: "Version 1" }))
    await screen.findByRole("cell", { name: "Tea" })
    expect(screen.queryByRole("cell", { name: "Coffee" })).toBeNull()
    expect(blobRequests()[1]?.[0]).toContain(olderUrl)
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/query/documents?"),
      ).length,
    ).toBe(2)
  })

  it("paginates CSV records and treats formula-like cells as inert text", async () => {
    // Quoting is part of the original file and is displayed as a cell value.
    setupFile(
      "Report\n" +
        Array.from(
          { length: 60 },
          (_, index) =>
            `item-${index},${index === 0 ? '"=HYPERLINK(""https://example.com"")"' : index}`,
        ).join("\n"),
    )
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("cell", {
      name: '=HYPERLINK("https://example.com")',
    })
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("cell", { name: "item-59" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("cell", { name: "item-59" })).toBeTruthy()
    expect(screen.getByText("Rows 51–61 of 61")).toBeTruthy()
  })

  it("switches inspected worksheets and displays cells as literal text", async () => {
    setupFile(
      "workbook bytes",
      "ledger.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    const source = fixture.documents[0]!
    fixture.fetcher.mockImplementation(async (url: string) =>
      url.includes("preview=true")
        ? Response.json({
            sourceSha256: source.checksum,
            sourceSize: source.fileSize,
            preview: {
              kind: "xlsx",
              sheets: [
                {
                  name: "Ledger",
                  columns: 1,
                  rows: [["Rent"]],
                  truncated: false,
                },
                {
                  name: "Notes",
                  columns: 1,
                  rows: [["<script>"]],
                  truncated: true,
                },
              ],
            },
          })
        : responseFor(url),
    )
    render(<DocumentViewerDialog {...props} />)
    const ledger = await screen.findByRole("table", { name: "Ledger" })
    expect(within(ledger).getByRole("cell", { name: "Rent" })).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Worksheet" }))
    fireEvent.click(await screen.findByRole("option", { name: "Notes" }))
    const notes = await screen.findByRole("table", { name: "Notes" })
    expect(within(notes).getByRole("cell", { name: "<script>" })).toBeTruthy()
    expect(notes.querySelector("script")).toBeNull()
    expect(screen.getByText(/worksheet preview is limited/)).toBeTruthy()
    expect(blobRequests()).toHaveLength(1)
    expect(blobRequests()[0]?.[0]).toBe(
      `${currentUrl}?sha256=${source.checksum}&preview=true&documentId=1&companyId=3`,
    )
  })

  it("renders inspected Word paragraphs and tables without active markup", async () => {
    setupFile(
      "word bytes",
      "records.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    const source = fixture.documents[0]!
    fixture.fetcher.mockImplementation(async (url: string) =>
      url.includes("preview=true")
        ? Response.json({
            sourceSha256: source.checksum,
            sourceSize: source.fileSize,
            preview: {
              kind: "docx",
              truncated: false,
              blocks: [
                { kind: "paragraph", text: "<img src=x onerror=alert(1)>" },
                { kind: "table", rows: [["Rent", "1200"]] },
              ],
            },
          })
        : responseFor(url),
    )
    const { container } = render(<DocumentViewerDialog {...props} />)
    await screen.findByText("<img src=x onerror=alert(1)>")
    const table = screen.getByRole("table")
    expect(within(table).getByRole("cell", { name: "1200" })).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("displays Markdown as plain text without creating HTML or clickable links", async () => {
    setupFile(
      "<script>window.secret=1</script>\n[remote](https://example.com)",
      "notes.md",
      "text/markdown",
    )
    render(<DocumentViewerDialog {...props} />)
    await screen.findByText(/<script>window.secret=1<\/script>/)
    expect(
      document.querySelector("[data-testid=document-viewer] script"),
    ).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("cleans up image URLs on permission loss and does not keep cached content visible", async () => {
    setupFile(new Uint8Array([1, 2, 3]), "image.png", "image/png")
    const view = render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("img", { name: "image.png" })
    const url = screen.getByRole("img").getAttribute("src")
    fixture.allowed = false
    view.rerender(<DocumentViewerDialog {...props} />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain(
      "You do not have access",
    )
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it("renders PDFs through the native typed viewer and provides a fallback", async () => {
    setupFile("%PDF-1.7\n%%EOF", "receipt.pdf", "application/pdf")
    const view = render(<DocumentViewerDialog {...props} />)
    const preview = await screen.findByTestId("document-viewer-pdf")
    expect(preview.getAttribute("type")).toBe("application/pdf")
    expect(preview.getAttribute("data")).toMatch(/^blob:document-/)
    expect(preview.textContent).toContain("Your browser cannot show this PDF")
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      preview.getAttribute("data"),
    )
  })

  it("drops current content immediately on company change without reopening it in the new scope", async () => {
    const view = render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("cell", { name: "Coffee" })
    const previousRequests = fixture.fetcher.mock.calls.length
    fixture.session = { ...fixture.session, activeCompanyId: 4 }
    view.rerender(<DocumentViewerDialog {...props} />)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain(
      "Your workspace changed",
    )
    expect(fixture.fetcher.mock.calls.length).toBe(previousRequests)
  })

  it("discards a delayed response after another exact version is selected", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("pending request not started")
    }
    const oldRequest: { signal?: AbortSignal | null } = {}
    fixture.fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (url.startsWith(`${currentUrl}?`)) {
        oldRequest.signal = init.signal
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      }
      return Promise.resolve(responseFor(url))
    })
    const view = render(<DocumentViewerDialog {...props} />)
    await waitFor(() => expect(oldRequest.signal).toBeDefined())
    view.rerender(<DocumentViewerDialog {...props} versionId="10" />)
    await screen.findByRole("cell", { name: "Tea" })
    await act(async () => {
      finish(responseFor(`${currentUrl}?sha256=ignored`))
    })
    expect(oldRequest.signal?.aborted).toBe(true)
    expect(screen.queryByRole("cell", { name: "Coffee" })).toBeNull()
    expect(screen.getByRole("cell", { name: "Tea" })).toBeTruthy()
  })

  it("allows current-file reads without requesting unauthorized version history", async () => {
    fixture.versionsAllowed = false
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("cell", { name: "Coffee" })
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(
      fixture.fetcher.mock.calls.some(([url]) =>
        String(url).includes("document-versions"),
      ),
    ).toBe(false)
  })

  it("rechecks the exact record before downloading and clears preview after revocation", async () => {
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("cell", { name: "Coffee" })
    fixture.documents = []
    fireEvent.click(screen.getByRole("button", { name: "Download file" }))
    await screen.findByRole("alert")
    expect(screen.queryByRole("table")).toBeNull()
    expect(blobRequests()).toHaveLength(1)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("reauthorizes and pins a successful download instead of using a cached preview URL", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("cell", { name: "Coffee" })
    fireEvent.click(screen.getByRole("button", { name: "Download file" }))
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(blobRequests()).toHaveLength(2)
    expect(blobRequests()[1]?.[0]).toBe(blobRequests()[0]?.[0])
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/query/documents?"),
      ).length,
    ).toBe(2)
  })

  it("does not render unsupported documents or fetch their bytes automatically", async () => {
    setupFile("legacy workbook", "book.xls", "application/vnd.ms-excel")
    render(<DocumentViewerDialog {...props} />)
    await screen.findByText(/A preview is not available for this format yet/)
    expect(blobRequests()).toHaveLength(0)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button", { name: "Download file" })).toBeTruthy()
  })

  it("keeps a failed permission read distinct from a missing attachment", async () => {
    fixture.fetcher.mockResolvedValue(new Response("denied", { status: 403 }))
    render(<DocumentViewerDialog {...props} />)
    await screen.findByText("You do not have access to this file.")
    expect(blobRequests()).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Download file" })).toBeNull()
  })

  it("restores keyboard focus to the opening control on close", async () => {
    function Host() {
      const [selected, setSelected] = useState<string | null>(null)
      return (
        <>
          <button onClick={() => setSelected("1")}>Open attachment</button>
          <DocumentViewerDialog
            {...props}
            documentId={selected}
            onOpenChange={(open) => {
              if (!open) setSelected(null)
            }}
          />
        </>
      )
    }
    render(<Host />)
    const trigger = screen.getByRole("button", { name: "Open attachment" })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole("table")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
