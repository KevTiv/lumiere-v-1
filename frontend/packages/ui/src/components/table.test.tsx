import { Fragment } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./table"

afterEach(cleanup)

function sample(count: number, pagination = true, prefix = "Record") {
  return <Table pagination={pagination}>
    <TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
    <TableBody>{Array.from({ length: count }, (_, index) => <TableRow key={`${prefix}-${index}`}><TableCell>{prefix} {index + 1}</TableCell></TableRow>)}</TableBody>
    <TableFooter><TableRow><TableCell>All-record total</TableCell></TableRow></TableFooter>
  </Table>
}

describe("table pagination", () => {
  it("keeps 25 rows on one page and makes every later row reachable", () => {
    const view = render(sample(25))
    expect(screen.queryByTestId("table-pager")).toBeNull()
    view.rerender(sample(61))
    expect(screen.queryByText("Record 26")).toBeNull()
    expect(screen.getByText("1-25 of 61")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Go to next page"))
    expect(screen.getByText("Record 26")).toBeTruthy()
    expect(screen.queryByText("Record 1")).toBeNull()
    fireEvent.click(screen.getByLabelText("Page 3"))
    expect(screen.getByText("Record 61")).toBeTruthy()
    expect(screen.getByText("51-61 of 61")).toBeTruthy()
    expect(screen.getByLabelText("Go to next page").getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText("All-record total")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Go to previous page"))
    expect(screen.getByText("Record 26")).toBeTruthy()
  })

  it("resets after filtering and does not restore a stale page when rows grow again", () => {
    const view = render(sample(61))
    fireEvent.click(screen.getByLabelText("Page 3"))
    view.rerender(sample(3))
    expect(screen.getByText("Record 1")).toBeTruthy()
    view.rerender(sample(61))
    expect(screen.getByText("1-25 of 61")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Page 2"))
    view.rerender(sample(61, true, "Filtered"))
    expect(screen.getByText("Filtered 1")).toBeTruthy()
    expect(screen.getByText("1-25 of 61")).toBeTruthy()
  })

  it("pages rows inside fragments and across multiple table bodies", () => {
    render(<Table>
      {[0, 1].map((group) => <Fragment key={group}><TableBody>{Array.from({ length: 20 }, (_, index) => <Fragment key={index}><TableRow><TableCell>Group {group} row {index}</TableCell></TableRow></Fragment>)}</TableBody></Fragment>)}
    </Table>)
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(25)
    fireEvent.click(screen.getByLabelText("Page 2"))
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(15)
    expect(screen.getByText("Group 1 row 19")).toBeTruthy()
  })

  it("leaves pagination with the owner when it is explicitly disabled", () => {
    render(sample(60, false))
    expect(screen.getByText("Record 60")).toBeTruthy()
    expect(screen.queryByTestId("table-pager")).toBeNull()
  })
})
