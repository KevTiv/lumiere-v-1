import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"

const { suggest } = vi.hoisted(() => ({ suggest: vi.fn() }))

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: suggest, isPending: false }),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const config: FormConfig = {
  id: "vehicle-ai-assist",
  title: "Add vehicle",
  sections: [{ id: "details", fields: [{ id: "name", name: "name", label: "Vehicle name", type: "text" }] }],
}

describe("Form AI assistance", () => {
  it("keeps prompt text separate and applies suggestions only after explicit review", async () => {
    suggest.mockResolvedValue({ suggestions: { name: { value: "Delivery truck", confidence: 0.9 } }, validation_notes: [], sources: [] })
    const save = vi.fn()
    render(<ModularForm config={config} draft={false} onSubmit={save} aiAssist={{ companyId: 7, entityType: "fleet_vehicle" }} />)
    fireEvent.change(screen.getByLabelText("Vehicle name"), { target: { value: "My draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Fill with AI" }))
    const prompt = screen.getByRole("textbox", { name: "Notes for form suggestions" })
    expect(prompt.tagName).toBe("TEXTAREA")
    expect(screen.queryByRole("toolbar", { name: "Text formatting" })).toBeNull()
    fireEvent.change(prompt, { target: { value: "Delivery truck\nPlate AA 123" } })
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true })
    expect(save).not.toHaveBeenCalled()
    expect(suggest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
    await waitFor(() => expect(suggest).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 7, entityType: "fleet_vehicle", rawText: "Delivery truck\nPlate AA 123",
    })))
    expect((screen.getByLabelText("Vehicle name") as HTMLInputElement).value).toBe("My draft")
    const apply = screen.getByRole("button", { name: "Apply suggestions" })
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(apply)
    expect((screen.getByLabelText("Vehicle name") as HTMLInputElement).value).toBe("Delivery truck")
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Hide AI" }))
    fireEvent.click(screen.getByRole("button", { name: "Fill with AI" }))
    expect((screen.getByRole("textbox", { name: "Notes for form suggestions" }) as HTMLTextAreaElement).value).toBe("Delivery truck\nPlate AA 123")
  })
})
