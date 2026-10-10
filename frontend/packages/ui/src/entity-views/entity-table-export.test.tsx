import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: vi.fn() }))

const config: EntityTableConfig = {
  mode: "table",
  searchable: true,
  rowKey: "id",
  columns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "secret", label: "Secret", sensitive: true },
  ],
}
const data = [
  { id: 1, name: "Alpha", secret: "s1" },
  { id: 2, name: "Beta", secret: "s2" },
]

let blobs: Blob[]

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

beforeEach(() => {
  blobs = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return "blob:x"
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderTable(props: { allowExport?: boolean } = {}) {
  return render(
    <RBACProvider>
      <EntityTable config={config} data={data} {...props} />
    </RBACProvider>,
  )
}

describe("EntityTable export", () => {
  it("downloads all rows without sensitive columns when explicitly enabled", async () => {
    renderTable({ allowExport: true })
    fireEvent.click(screen.getByTestId("entity-table-export"))
    expect(blobs).toHaveLength(1)
    const text = await readBlob(blobs[0]!)
    expect(text).toContain("ID,Name")
    expect(text).toContain("Alpha")
    expect(text).toContain("Beta")
    expect(text).not.toContain("s1")
  })

  it("hides the action unless export is explicitly enabled", () => {
    renderTable()
    expect(screen.queryByTestId("entity-table-export")).toBeNull()

    cleanup()
    renderTable({ allowExport: false })
    expect(screen.queryByTestId("entity-table-export")).toBeNull()
  })
})
