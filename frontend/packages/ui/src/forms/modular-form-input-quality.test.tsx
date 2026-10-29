import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FormConfig, FormField } from "../lib/form-types"
import { ModularForm } from "./modular-form"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

function config(...fields: FormField[]): FormConfig {
  return { id: "quality", title: "Quality", sections: [{ id: "main", fields }] }
}

const notes: FormField = { id: "notes", name: "notes", label: "Notes", type: "textarea", format: "plain" }

describe("ModularForm input quality", () => {
  it("keeps optional section entries while collapsed and opens the section when validation fails", async () => {
    const submit = vi.fn()
    const optional: FormConfig = { id: "optional", title: "Optional", sections: [{
      id: "details", title: "More details", collapsible: true,
      fields: [{ id: "email", name: "email", label: "Email", type: "email" }],
    }] }
    const { container } = render(<ModularForm config={optional} onSubmit={submit} />)
    const section = container.querySelector("details")!
    expect(section.open).toBe(false)
    fireEvent.click(screen.getByText("More details"))
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "wrong" } })
    fireEvent.click(screen.getByText("More details"))
    expect(section.open).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(section.open).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText("Email"))
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("wrong")
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ email: "jane@example.com" }))
  })
  it("submits with Cmd or Ctrl+Enter from a field", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(notes)} onSubmit={submit} />)
    const field = screen.getByLabelText("Notes")
    fireEvent.change(field, { target: { value: "Call back Monday" } })
    fireEvent.keyDown(field, { key: "Enter" })
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: "Enter", metaKey: true })
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ notes: "Call back Monday" }))
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true })
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
  })

  it("rejects a mistyped email or web address the user entered", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(
      { id: "email", name: "email", label: "Email", type: "email" },
      { id: "website", name: "website", label: "Website", type: "url" },
    )} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane.example.com" } })
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "not a site" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "common.validation.invalidEmail",
      "common.validation.invalidUrl",
    ])
    expect(submit).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jane@example.com" } })
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ email: "jane@example.com", website: "example.com" }))
  })

  it("focuses the first invalid field after each failed submit without clearing entries", () => {
    const submit = vi.fn()
    render(<ModularForm scrollable config={config(
      { id: "name", name: "name", label: "Name", type: "text", required: true },
      { id: "email", name: "email", label: "Email", type: "email", required: true },
      notes,
    )} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep this note" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(document.activeElement).toBe(screen.getByLabelText(/Name/))
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Alex" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    expect(document.activeElement).toBe(screen.getByLabelText(/Email/))
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Keep this note")
    expect(submit).not.toHaveBeenCalled()
  })

  it("does not block an edit over an existing stored value it would reject", async () => {
    const submit = vi.fn()
    render(<ModularForm config={config(
      { id: "email", name: "email", label: "Email", type: "email", defaultValue: "legacy-import" },
      notes,
    )} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Updated" } })
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ email: "legacy-import", notes: "Updated" }))
  })
})
