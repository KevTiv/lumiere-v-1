import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { EntryTableViewer } from "./entry-table-viewer"
import type { EntryTableConfig } from "../lib/entry-table-types"

afterEach(cleanup)

it("pages entry records at 25 and resets after searching or removing rows", () => {
  const config: EntryTableConfig = {
    id: "entries", title: "Entries", onRowClick: "none",
    columns: [{ id: "name", key: "name", label: "Name", type: "text" }],
    features: { search: true }, actions: {},
  }
  const rows = Array.from({ length: 61 }, (_, index) => ({ id: index + 1, name: `Entry ${index + 1}` }))
  const view = render(<EntryTableViewer config={config} data={rows} />)
  expect(screen.getByText("1-25 of 61")).toBeTruthy()
  expect(screen.queryByText("Entry 26")).toBeNull()
  fireEvent.click(screen.getByLabelText("Go to last page"))
  expect(screen.getByText("Entry 61")).toBeTruthy()
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Entry 6" } })
  expect(screen.getByText("Entry 6")).toBeTruthy()
  expect(screen.getByText("Entry 61")).toBeTruthy()
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } })
  fireEvent.click(screen.getByLabelText("Go to last page"))
  view.rerender(<EntryTableViewer config={config} data={rows.slice(0, 26)} />)
  expect(screen.getByText("26-26 of 26")).toBeTruthy()
  fireEvent.click(screen.getByLabelText("Go to previous page"))
  expect(screen.getByText("Entry 1")).toBeTruthy()
})
