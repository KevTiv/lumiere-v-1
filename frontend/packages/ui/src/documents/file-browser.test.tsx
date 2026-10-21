import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileBrowser, type FileBrowserFile, type FileBrowserFolder } from "./file-browser"

const folders: FileBrowserFolder[] = [
  { id: "5", name: "Finance", fileCount: 2, totalSize: 3072, updatedAt: 1_700_000_000_000 },
  { id: "6", name: "Legal", fileCount: 0, totalSize: 0, updatedAt: null },
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

describe("FileBrowser", () => {
  it("lists every file newest first and narrows to an opened folder", () => {
    render(<FileBrowser folders={folders} files={files} />)
    expect(shownFileIds()).toEqual(["1", "2", "3"])

    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    expect(shownFileIds()).toEqual(["1", "2"])

    fireEvent.click(screen.getByTestId("file-browser-folder-5"))
    expect(shownFileIds()).toHaveLength(3)
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
})
