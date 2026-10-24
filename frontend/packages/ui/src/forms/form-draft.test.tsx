import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { FormConfig } from "../lib/form-types"
import { FORM_DRAFT_DEBOUNCE_MS, FORM_DRAFT_TTL_MS, formDraftStorageKey, type DraftValues } from "./form-draft"
import { FormModal } from "./form-modal"
import { ModularForm } from "./modular-form"

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

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

const config: FormConfig = {
  id: "lead-notes",
  title: "Lead notes",
  submitLabel: "Save",
  showReset: true,
  sections: [
    {
      id: "main",
      fields: [
        { id: "title", name: "title", label: "Title", type: "text", defaultValue: "Initial" },
        { id: "description", name: "description", label: "Description", type: "textarea" },
        { id: "password", name: "password", label: "Password", type: "password" },
        { id: "apiToken", name: "apiToken", label: "API token", type: "text" },
      ],
    },
  ],
}

const key = (draftKey?: string) => formDraftStorageKey(config.id, draftKey, null, undefined)
const stored = (draftKey?: string) => {
  const raw = localStorage.getItem(key(draftKey))
  return raw ? (JSON.parse(raw) as { savedAt: number; values: DraftValues }) : null
}
const field = (name: string) => screen.getByTestId(`form-field-${name}`) as HTMLInputElement
const edit = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
const settle = () => act(() => { vi.advanceTimersByTime(FORM_DRAFT_DEBOUNCE_MS + 10) })

describe("ModularForm drafts", () => {
  it("debounce-saves dirty values and leaves out secrets", () => {
    render(<ModularForm config={config} onSubmit={() => {}} />)
    edit("description", "Long notes")
    edit("password", "hunter2")
    edit("apiToken", "tok_123")
    act(() => { vi.advanceTimersByTime(FORM_DRAFT_DEBOUNCE_MS - 100) })
    expect(stored()).toBeNull()
    settle()
    expect(stored()?.values).toEqual({ title: "Initial", description: "Long notes" })
  })

  it("restores a draft with a banner and reverts it on Discard draft", () => {
    const first = render(<ModularForm config={config} onSubmit={() => {}} />)
    edit("description", "Long notes")
    settle()
    first.unmount()

    render(<ModularForm config={config} onSubmit={() => {}} />)
    expect(field("description").value).toBe("Long notes")
    expect(screen.getByTestId("form-draft-banner-lead-notes").textContent).toMatch(/Restored unsaved changes from/)

    fireEvent.click(screen.getByTestId("form-draft-discard-lead-notes"))
    expect(field("description").value).toBe("")
    expect(screen.queryByTestId("form-draft-banner-lead-notes")).toBeNull()
    settle()
    expect(stored()).toBeNull()
  })

  it("keeps drafts of different records apart", () => {
    const first = render(<ModularForm config={config} draftKey="7" onSubmit={() => {}} />)
    edit("description", "Notes for 7")
    settle()
    first.unmount()

    render(<ModularForm config={config} draftKey="8" onSubmit={() => {}} />)
    expect(field("description").value).toBe("")
    expect(stored("7")?.values.description).toBe("Notes for 7")
  })

  it("does not apply a draft when the record changed since it was taken", () => {
    const first = render(<ModularForm config={config} onSubmit={() => {}} />)
    edit("description", "Old notes")
    settle()
    first.unmount()

    const changed: FormConfig = {
      ...config,
      sections: [{ ...config.sections[0]!, fields: config.sections[0]!.fields.map((f) =>
        f.name === "title" ? { ...f, defaultValue: "Renamed on server" } : f) }],
    }
    render(<ModularForm config={changed} onSubmit={() => {}} />)
    expect(field("description").value).toBe("")
    expect(stored()).toBeNull()
  })

  it("clears the draft after a successful submit", async () => {
    const onSubmit = vi.fn()
    render(<ModularForm config={config} onSubmit={onSubmit} />)
    edit("description", "Saved notes")
    settle()
    expect(stored()).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId("form-submit-lead-notes")) })
    expect(onSubmit).toHaveBeenCalled()
    expect(stored()).toBeNull()
  })

  it("clears the draft on reset", () => {
    render(<ModularForm config={config} onSubmit={() => {}} />)
    edit("description", "More notes")
    settle()
    expect(stored()).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /reset/i }))
    settle()
    expect(stored()).toBeNull()
  })

  it("ignores and removes drafts older than seven days", () => {
    localStorage.setItem(key(), JSON.stringify({
      savedAt: Date.now() - FORM_DRAFT_TTL_MS - 1000,
      base: "[]",
      values: { description: "Stale" },
    }))
    render(<ModularForm config={config} onSubmit={() => {}} />)
    expect(field("description").value).toBe("")
    expect(localStorage.getItem(key())).toBeNull()
  })

  it("never stores or restores when draft is disabled", () => {
    const first = render(<ModularForm config={config} draft={false} onSubmit={() => {}} />)
    edit("description", "Private")
    settle()
    expect(stored()).toBeNull()
    first.unmount()

    const seeded = render(<ModularForm config={config} onSubmit={() => {}} />)
    edit("description", "Seeded")
    settle()
    seeded.unmount()
    render(<ModularForm config={config} draft={false} onSubmit={() => {}} />)
    expect(field("description").value).toBe("")
  })

  it("keeps working when storage is unavailable", () => {
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    try {
      render(<ModularForm config={config} onSubmit={() => {}} />)
      edit("description", "Still editable")
      settle()
      expect(field("description").value).toBe("Still editable")
    } finally {
      spy.mockRestore()
    }
  })

  it("is cleared by FormModal's explicit discard", () => {
    const onOpenChange = vi.fn()
    render(<FormModal open onOpenChange={onOpenChange} config={config} onSubmit={() => {}} showSubmitSuccessToast={false} />)
    edit("description", "Throw away")
    settle()
    expect(stored()).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    fireEvent.click(screen.getByTestId("discard-changes-confirm"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(stored()).toBeNull()
  })
})

describe("formDraftStorageKey", () => {
  it("scopes drafts by user, organization, form and record", () => {
    expect(formDraftStorageKey("f", 3, "abc", 9)).toBe("lumiere:form-draft:v1:abc:9:f:3")
    expect(formDraftStorageKey("f", undefined, null, undefined)).toBe("lumiere:form-draft:v1:anon:none:f:new")
  })
})
