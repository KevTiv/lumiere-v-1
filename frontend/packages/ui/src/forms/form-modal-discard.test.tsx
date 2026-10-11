import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { FormConfig } from "../lib/form-types"
import { FormModal } from "./form-modal"

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  if (typeof globalThis.PointerEvent === "undefined") {
    Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
  }
})

vi.mock("../components/select", () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}))

afterEach(cleanup)

const config: FormConfig = {
  id: "new-note",
  title: "New note",
  submitLabel: "Save",
  sections: [
    { id: "main", fields: [{ id: "title", name: "title", label: "Title", type: "text", defaultValue: "Draft" }] },
  ],
}

function setup(onSubmit: (values: Record<string, unknown>) => void = () => {}) {
  const onOpenChange = vi.fn()
  const addSpy = vi.spyOn(window, "addEventListener")
  render(<FormModal open onOpenChange={onOpenChange} config={config} onSubmit={onSubmit} showSubmitSuccessToast={false} />)
  const unloadRegistrations = () => addSpy.mock.calls.filter(([type]) => type === "beforeunload").length
  return { onOpenChange, unloadRegistrations }
}

const edit = (value: string) =>
  fireEvent.change(screen.getByTestId("form-field-title"), { target: { value } })
const cancel = () => fireEvent.click(screen.getByRole("button", { name: /cancel/i }))

describe("FormModal unsaved-changes guard", () => {
  it("closes straight away when nothing was edited", () => {
    const { onOpenChange, unloadRegistrations } = setup()
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
    expect(unloadRegistrations()).toBe(0)
  })

  it("asks before closing a dirty form and keeps it open on Keep editing", async () => {
    const { onOpenChange } = setup()
    edit("Changed")
    cancel()
    expect(await screen.findByTestId("discard-changes-dialog")).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("discard-changes-keep"))
    await waitFor(() => expect(screen.queryByTestId("discard-changes-dialog")).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByTestId("form-field-title") as HTMLInputElement).value).toBe("Changed")
  })

  it("closes after the user confirms Discard", async () => {
    const { onOpenChange } = setup()
    edit("Changed")
    cancel()
    fireEvent.click(await screen.findByTestId("discard-changes-confirm"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("treats editing back to the original value as pristine", () => {
    const { onOpenChange } = setup()
    edit("Changed")
    edit("Draft")
    cancel()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("closes after a successful submit without asking", async () => {
    const onSubmit = vi.fn()
    const { onOpenChange } = setup(onSubmit)
    edit("Changed")
    fireEvent.click(screen.getByTestId("form-submit-new-note"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSubmit).toHaveBeenCalled()
    expect(screen.queryByTestId("discard-changes-dialog")).toBeNull()
  })

  it("registers beforeunload only while dirty and removes it when clean", async () => {
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "beforeunload").length
    const before = count(add)
    render(<FormModal open onOpenChange={() => {}} config={config} onSubmit={() => {}} showSubmitSuccessToast={false} />)
    expect(count(add)).toBe(before)

    edit("Changed")
    await waitFor(() => expect(count(add)).toBe(before + 1))
    const handler = add.mock.calls.filter(([type]) => type === "beforeunload").at(-1)![1] as EventListener
    const event = new Event("beforeunload", { cancelable: true })
    handler(event)
    expect(event.defaultPrevented).toBe(true)

    edit("Draft")
    await waitFor(() => expect(count(remove)).toBeGreaterThan(0))
  })
})
