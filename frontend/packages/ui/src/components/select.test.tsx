import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select"
import { installSelectDomShims } from "./select-test-utils"

beforeAll(installSelectDomShims)
afterEach(cleanup)

function Harness({
  count = 15,
  onChange = vi.fn(),
}: {
  count?: number
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState("2")
  return (
    <form>
      <Select
        name="partner"
        value={value}
        onValueChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      >
        <SelectTrigger aria-label="Partner">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Partners</SelectLabel>
            {Array.from({ length: count }, (_, i) => (
              <SelectItem key={i} value={String(i)} disabled={i === 14}>
                Partner {i}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </form>
  )
}
const open = () =>
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Partner" }), { key: "Enter" })

describe("shared Select search", () => {
  it("keeps 14 options simple and adds search at 15, including grouped options", () => {
    const { unmount } = render(<Harness count={14} />)
    open()
    expect(screen.queryByRole("searchbox")).toBeNull()
    unmount()
    render(<Harness />)
    open()
    expect(screen.getByRole("searchbox")).toBeTruthy()
    expect(screen.getAllByRole("option")).toHaveLength(15)
  })
  it("filters labels without erasing the selected label or form value, then selects by keyboard", async () => {
    const change = vi.fn()
    render(<Harness onChange={change} />)
    const trigger = screen.getByRole("combobox", { name: "Partner" })
    open()
    const search = screen.getByRole("searchbox")
    fireEvent.change(search, { target: { value: "partner 13" } })
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    expect(trigger.textContent).toContain("Partner 2")
    expect(new FormData(document.querySelector("form")!).get("partner")).toBe("2")
    fireEvent.keyDown(search, { key: "Enter" })
    expect(change).toHaveBeenLastCalledWith("13")
    open()
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("")
  })
  it("restores the complete list when updated options no longer need search", () => {
    const { rerender } = render(<Harness />)
    open()
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Partner 13" } })
    expect(screen.getAllByRole("option")).toHaveLength(1)
    rerender(<Harness count={14} />)
    expect(screen.queryByRole("searchbox")).toBeNull()
    expect(screen.getAllByRole("option")).toHaveLength(14)
  })
  it("does not choose disabled or unmatched options and makes no change for no matches", async () => {
    const change = vi.fn()
    render(<Harness onChange={change} />)
    open()
    const search = screen.getByRole("searchbox")
    fireEvent.change(search, { target: { value: "partner 14" } })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(search, { target: { value: "not a partner" } })
    await screen.findByRole("status")
    expect(screen.queryByRole("option")).toBeNull()
    fireEvent.keyDown(search, { key: "Enter" })
    expect(change).not.toHaveBeenCalled()
  })
})
