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
import { DocumentSelectionActionsContext } from "../../../../web/lib/document-selection-actions"

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
    const table = await screen.findByRole("grid", { name: "CSV preview" })
    expect(
      await within(table).findByRole("gridcell", { name: "Coffee" }),
    ).toBeTruthy()
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
    await screen.findByRole("gridcell", { name: "Tea" })
    expect(screen.queryByRole("gridcell", { name: "Coffee" })).toBeNull()
    expect(blobRequests()[1]?.[0]).toContain(olderUrl)
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/query/documents?"),
      ).length,
    ).toBe(2)
  })

  it("virtualizes CSV records and finds offscreen cells without interpreting formulas", async () => {
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
    await screen.findByRole("gridcell", {
      name: '=HYPERLINK("https://example.com")',
    })
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByRole("gridcell", { name: "item-59" })).toBeNull()
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in sheet" }), {
      target: { value: "item-59" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Next match" }))
    await screen.findByText("A61", { selector: "[role=status]" })
    const grid = screen.getByRole("grid")
    // JSDOM does not generate scroll events when a scroll offset is assigned.
    fireEvent.scroll(grid)
    expect(
      (await screen.findByRole("gridcell", { name: "item-59" })).getAttribute(
        "aria-selected",
      ),
    ).toBe("true")
    expect(screen.queryByRole("gridcell", { name: "item-0" })).toBeNull()
  })

  it("reparses verified CSV bytes after an encoding error", async () => {
    setupFile(new Uint8Array([78, 97, 109, 101, 10, 67, 97, 102, 233]))
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("alert")
    expect(screen.getByRole("button", { name: "Download file" })).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Encoding" }))
    fireEvent.click(await screen.findByRole("option", { name: "Windows-1252" }))
    await screen.findByRole("gridcell", { name: "Café" })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(blobRequests()).toHaveLength(1)
  })

  it("copies a keyboard range and shows the untruncated cell", async () => {
    setupFile('Name,Notes\nCoffee,"two\nlines"\n')
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("gridcell", { name: "Coffee" })
    const grid = screen.getByRole("grid")
    fireEvent.click(screen.getByRole("gridcell", { name: "Coffee" }))
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true })
    const clipboardData = { setData: vi.fn() }
    fireEvent.copy(grid, { clipboardData })
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      'Coffee\t"two\nlines"',
    )
    fireEvent.click(screen.getByRole("button", { name: "Cell details" }))
    expect(
      screen.getByLabelText("Cell details", { selector: "div" }).textContent,
    ).toContain("two\nlines")
  })

  it("extends a selection with the touch range toggle", async () => {
    render(<DocumentViewerDialog {...props} />)
    fireEvent.click(await screen.findByRole("gridcell", { name: "Name" }))
    const extend = screen.getByRole("button", { name: "Extend selection" })
    fireEvent.click(extend)
    expect(extend.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("gridcell", { name: "1200" }))
    expect(screen.getByText("A1:B2")).toBeTruthy()
    expect(
      screen
        .getByRole("gridcell", { name: "Coffee" })
        .getAttribute("aria-selected"),
    ).toBe("true")
    fireEvent.click(extend)
    fireEvent.click(screen.getByRole("gridcell", { name: "1200" }))
    expect(screen.getByText("B2")).toBeTruthy()
    expect(
      screen
        .getByRole("gridcell", { name: "Coffee" })
        .getAttribute("aria-selected"),
    ).toBe("false")
  })

  it("passes canonical CSV coordinates and parse settings to an authorized selection action", async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    render(
      <DocumentSelectionActionsContext.Provider value={action}>
        <DocumentViewerDialog {...props} />
      </DocumentSelectionActionsContext.Provider>,
    )
    fireEvent.click(await screen.findByRole("gridcell", { name: "Coffee" }))
    fireEvent.click(screen.getByRole("button", { name: "CSV options" }))
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use first row as headings" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Explain" }))
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        "explain",
        expect.objectContaining({
          organizationId: 7n,
          companyId: 3n,
          source: expect.objectContaining({ documentId: "1", versionId: "11" }),
          sheetName: "CSV",
          range: { firstRow: 2, lastRow: 2, firstColumn: 1, lastColumn: 1 },
          text: "Coffee",
          parsing: { delimiter: ",", encoding: "utf-8", headerRow: 1 },
        }),
        expect.any(AbortSignal),
      ),
    )
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
    await screen.findByRole("gridcell", { name: "Coffee" })
    const previousRequests = fixture.fetcher.mock.calls.length
    fixture.session = { ...fixture.session, activeCompanyId: 4 }
    view.rerender(<DocumentViewerDialog {...props} />)
    expect(screen.queryByRole("grid")).toBeNull()
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
    await screen.findByRole("gridcell", { name: "Tea" })
    await act(async () => {
      finish(responseFor(`${currentUrl}?sha256=ignored`))
    })
    expect(oldRequest.signal?.aborted).toBe(true)
    expect(screen.queryByRole("gridcell", { name: "Coffee" })).toBeNull()
    expect(screen.getByRole("gridcell", { name: "Tea" })).toBeTruthy()
  })

  it("allows current-file reads without requesting unauthorized version history", async () => {
    fixture.versionsAllowed = false
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("gridcell", { name: "Coffee" })
    expect(screen.queryByRole("combobox")).toBeNull()
    expect(
      fixture.fetcher.mock.calls.some(([url]) =>
        String(url).includes("document-versions"),
      ),
    ).toBe(false)
  })

  it("rechecks the exact record before downloading and clears preview after revocation", async () => {
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("gridcell", { name: "Coffee" })
    fixture.documents = []
    fireEvent.click(screen.getByRole("button", { name: "Download file" }))
    await screen.findByRole("alert")
    expect(screen.queryByRole("grid")).toBeNull()
    expect(blobRequests()).toHaveLength(1)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it("reauthorizes and pins a successful download instead of using a cached preview URL", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    render(<DocumentViewerDialog {...props} />)
    await screen.findByRole("gridcell", { name: "Coffee" })
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

  it("renders scoped XLSX ranges, keeps merged values at the scroll edge, and switches sheets", async () => {
    setupFile(
      "workbook",
      "book.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    const identity = {
      documentId: "1",
      versionId: "11",
      checksum: fixture.documents[0]!.checksum,
    }
    const maxRows = 1_048_576
    const merge = { rowStart: 0, rowCount: 170, columnStart: 0, columnCount: 2 }
    fixture.fetcher.mockImplementation(async (url: string) => {
      if (!url.startsWith("/api/documents/spreadsheet/"))
        return responseFor(url)
      const { pathname, searchParams } = new URL(url, "https://viewer.test")
      if (!pathname.endsWith("/range"))
        return Response.json({
          ...identity,
          format: "xlsx",
          dateSystem: "1900",
          sheets: [
            {
              id: "0",
              name: "Summary",
              visibility: "visible",
              rowCount: maxRows,
              columnCount: 3,
              merges: [merge],
            },
            {
              id: "1",
              name: "Archive",
              visibility: "hidden",
              rowCount: 1,
              columnCount: 1,
            },
          ],
        })
      const sheetId = searchParams.get("sheetId")
      const rowStart = Number(searchParams.get("rowStart"))
      const rowCount = Number(searchParams.get("rowCount"))
      const columnStart = Number(searchParams.get("columnStart"))
      const columnCount = Number(searchParams.get("columnCount"))
      const value = sheetId === "0" ? "Merged summary" : "Previous harvest"
      return Response.json({
        ...identity,
        sheetId,
        rowStart,
        rowCount,
        columnStart,
        columnCount,
        cells:
          rowStart === 0
            ? [{ row: 0, column: 0, kind: "text", value, displayValue: value }]
            : rowStart + rowCount === maxRows
              ? [
                  {
                    row: maxRows - 1,
                    column: 2,
                    kind: "text",
                    value: "Final record",
                    displayValue: "Final record",
                  },
                ]
              : [],
        merges: sheetId === "0" && rowStart < 170 ? [merge] : [],
      })
    })
    render(<DocumentViewerDialog {...props} />)
    const cell = await screen.findByRole("gridcell", { name: "Merged summary" })
    expect(cell.getAttribute("aria-colspan")).toBe("2")
    const grid = screen.getByRole("grid", { name: "Spreadsheet preview" })
    const trackScale = (maxRows * 28 + 30 - 400) / (8_000_000 - 400)
    grid.scrollTop = (140 * 28) / trackScale
    fireEvent.scroll(grid)
    await waitFor(() =>
      expect(
        fixture.fetcher.mock.calls.some(([url]) =>
          String(url).includes("rowStart=0&rowCount=1"),
        ),
      ).toBe(true),
    )
    expect(
      await screen.findByRole("gridcell", { name: "Merged summary" }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("rowheader", { name: "1", exact: true }),
    ).toBeNull()
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true })
    fireEvent.scroll(grid)
    expect(
      await screen.findByRole("gridcell", { name: "Final record" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("combobox", { name: "Sheet" }))
    fireEvent.click(
      await screen.findByRole("option", { name: "Archive (hidden)" }),
    )
    await screen.findByRole("gridcell", { name: "Previous harvest" })
    expect(
      screen.queryByRole("gridcell", { name: "Merged summary" }),
    ).toBeNull()
    expect(blobRequests()).toHaveLength(0)
  })

  it("keeps authorized original download available when workbook parsing fails", async () => {
    setupFile(
      "workbook",
      "book.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    fixture.fetcher.mockImplementation(async (url: string) =>
      url.startsWith("/api/documents/spreadsheet/")
        ? new Response("unreadable", { status: 422 })
        : responseFor(url),
    )
    render(<DocumentViewerDialog {...props} />)
    await screen.findByText("The workbook could not be read as a spreadsheet.")
    expect(blobRequests()).toHaveLength(0)
    expect(screen.queryByRole("grid")).toBeNull()
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
    await screen.findByRole("grid")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
