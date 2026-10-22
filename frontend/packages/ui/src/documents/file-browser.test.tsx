import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileBrowser, type FileBrowserFile, type FileBrowserFolder } from "./file-browser"

const folders: FileBrowserFolder[] = [
  { id: "5", name: "Finance", parentId: null, fileCount: 2, totalSize: 3072, updatedAt: 1_700_000_000_000 },
  { id: "6", name: "Legal", parentId: null, fileCount: 0, totalSize: 0, updatedAt: null },
]

const files: FileBrowserFile[] = [
  { id: "1", name: "Budget", fileName: "budget.xlsx", mimetype: "", size: 2048, folderId: "5", updatedAt: 3, modifiedBy: "Grace" },
  { id: "2", name: "Scan", fileName: "scan.pdf", mimetype: "application/pdf", size: 1024, folderId: "5", updatedAt: 2, modifiedBy: "Ada" },
  { id: "3", name: "Notes", fileName: "notes.txt", mimetype: "text/plain", size: 10, folderId: null, updatedAt: 1, modifiedBy: "Ada" },
]

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const shownFileIds = () =>
  screen.queryAllByTestId(/^file-browser-(file|row)-\d+$/).map((el) => el.dataset.testid!.split("-").pop())

const shownFolderIds = () =>
  screen.queryAllByTestId(/^file-browser-folder-\d+$/).map((el) => el.dataset.testid!.split("-").pop())

const nestedFolders: FileBrowserFolder[] = [
  ...folders,
  { id: "7", parentId: "5", name: "Invoices", fileCount: 1, totalSize: 500, updatedAt: null },
  { id: "8", parentId: "7", name: "Archive", fileCount: 0, totalSize: 0, updatedAt: null },
]

describe("FileBrowser", () => {
  it("lists every file newest first and narrows to an opened folder", () => {
    render(<FileBrowser folders={folders} files={files} />)
    expect(shownFileIds()).toEqual(["1", "2", "3"])

    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    expect(shownFileIds()).toEqual(["1", "2"])

    fireEvent.click(screen.getByTestId("file-browser-root"))
    expect(shownFileIds()).toHaveLength(3)
  })

  it("navigates child folders and visible ancestors while preserving the all-files view", () => {
    const nestedFiles = [
      ...files,
      { ...files[0]!, id: "4", name: "Invoice", fileName: "invoice.pdf", folderId: "7", updatedAt: 4 },
    ]
    render(<FileBrowser folders={nestedFolders} files={nestedFiles} />)
    expect(shownFolderIds()).toEqual(["5", "6"])
    expect(shownFileIds()).toEqual(["4", "1", "2", "3"])

    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    expect(shownFolderIds()).toEqual(["7"])
    expect(shownFileIds()).toEqual(["1", "2"])
    fireEvent.click(screen.getByTestId("file-browser-folder-7"))
    expect(shownFolderIds()).toEqual(["8"])
    expect(shownFileIds()).toEqual(["4"])
    fireEvent.click(screen.getByTestId("file-browser-folder-8"))
    expect(shownFileIds()).toEqual([])

    const breadcrumb = within(screen.getByRole("navigation"))
    expect(breadcrumb.getByText("Archive").getAttribute("aria-current")).toBe("page")
    expect(breadcrumb.getByRole("button", { name: "Invoices" })).toBeTruthy()
    fireEvent.click(breadcrumb.getByRole("button", { name: "Finance" }))
    expect(shownFolderIds()).toEqual(["7"])
    fireEvent.click(screen.getByTestId("file-browser-root"))
    expect(shownFileIds()).toEqual(["4", "1", "2", "3"])
  })

  it("starts a visible branch at root when its ancestor is absent without displaying the missing ID", () => {
    const visibleBranch = nestedFolders.slice(2).map((folder) => folder.id === "7" ? { ...folder, parentId: "9001" } : folder)
    render(<FileBrowser folders={visibleBranch} files={[]} />)
    expect(shownFolderIds()).toEqual(["7"])
    fireEvent.click(screen.getByTestId("file-browser-folder-7"))
    expect(shownFolderIds()).toEqual(["8"])
    fireEvent.click(screen.getByTestId("file-browser-folder-8"))
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "Invoices" })).toBeTruthy()
    expect(screen.getByTestId("file-browser").innerHTML).not.toContain("9001")
    expect(screen.queryByText("Finance")).toBeNull()
  })

  it("keeps folders reachable when their ancestry contains a cycle", () => {
    const cyclicFolders = [
      { ...nestedFolders[0]!, parentId: "6" },
      { ...nestedFolders[1]!, parentId: "5" },
      nestedFolders[2]!,
      { ...nestedFolders[3]!, parentId: "8" },
    ]
    render(<FileBrowser folders={cyclicFolders} files={files} />)
    expect(shownFolderIds()).toEqual(["5", "6", "8"])
    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    expect(shownFolderIds()).toEqual(["7"])
    fireEvent.click(screen.getByTestId("file-browser-folder-7"))
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "Finance" })).toBeTruthy()
    expect(within(screen.getByRole("navigation")).queryByText("Legal")).toBeNull()
  })

  it("returns to current visible files when an open folder disappears", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined)
    const view = render(<FileBrowser folders={folders} files={files} onUpload={onUpload} />)
    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    view.rerender(<FileBrowser folders={[folders[1]!]} files={[files[2]!]} onUpload={onUpload} />)
    expect(shownFileIds()).toEqual(["3"])
    expect(screen.queryByText("Finance")).toBeNull()
    const picked = new File(["x"], "note.txt", { type: "text/plain" })
    fireEvent.change(screen.getByTestId("file-browser-input"), { target: { files: [picked] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith([picked], null))
  })

  it("creates a folder inside the current visible parent", () => {
    const onCreateFolder = vi.fn()
    render(<FileBrowser folders={nestedFolders} files={files} onCreateFolder={onCreateFolder} />)
    fireEvent.click(screen.getByTestId("file-browser-new-folder"))
    expect(onCreateFolder).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    fireEvent.click(screen.getByTestId("file-browser-folder-7"))
    fireEvent.click(screen.getByTestId("file-browser-new-folder"))
    expect(onCreateFolder).toHaveBeenLastCalledWith("7")
  })

  it("switches to the list layout and remembers it", () => {
    const { unmount } = render(<FileBrowser folders={folders} files={files} storageKey="test-layout" />)
    fireEvent.click(screen.getByTestId("file-browser-layout-list"))
    expect(screen.getByTestId("file-browser-list")).toBeTruthy()
    expect(screen.getByText("Grace")).toBeTruthy()
    unmount()

    render(<FileBrowser folders={folders} files={files} storageKey="test-layout" />)
    expect(screen.getByTestId("file-browser-list")).toBeTruthy()
  })

  it("uploads picked files into the open folder and reports a failure", async () => {
    const onUpload = vi.fn().mockRejectedValueOnce(new Error("quota exceeded"))
    render(<FileBrowser folders={folders} files={files} onUpload={onUpload} />)
    fireEvent.click(screen.getByTestId("file-browser-folder-6"))

    const picked = new File(["x"], "contract.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByTestId("file-browser-input"), { target: { files: [picked] } })

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith([picked], "6"))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "quota exceeded")
  })

  it("hides upload and new-folder buttons without handlers", () => {
    render(<FileBrowser folders={[]} files={[]} />)
    expect(screen.queryByTestId("file-browser-upload")).toBeNull()
    expect(screen.queryByTestId("file-browser-new-folder")).toBeNull()
  })

  it("removes mutation controls and drop handling when permissions revoke the callbacks", () => {
    const onUpload = vi.fn()
    const onCreateFolder = vi.fn()
    const view = render(<FileBrowser folders={folders} files={files} onUpload={onUpload} onCreateFolder={onCreateFolder} />)
    expect(screen.getByTestId("file-browser-upload")).toBeTruthy()
    expect(screen.getByTestId("file-browser-new-folder")).toBeTruthy()
    view.rerender(<FileBrowser folders={folders} files={files} />)
    expect(screen.queryByTestId("file-browser-upload")).toBeNull()
    expect(screen.queryByTestId("file-browser-input")).toBeNull()
    expect(screen.queryByTestId("file-browser-new-folder")).toBeNull()
    fireEvent.drop(screen.getByTestId("file-browser").querySelector('[aria-labelledby="file-browser-files"]')!, {
      dataTransfer: { files: [new File(["x"], "note.txt", { type: "text/plain" })] },
    })
    expect(onUpload).not.toHaveBeenCalled()
    expect(onCreateFolder).not.toHaveBeenCalled()
    expect(shownFileIds()).toEqual(["1", "2", "3"])
  })
})
