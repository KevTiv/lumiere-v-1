import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CustomSectionDialog } from "./custom-section-dialog"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}))

afterEach(cleanup)

describe("CustomSectionDialog", () => {
  it("submits the trimmed title and closes", () => {
    const onSubmit = vi.fn()
    const onOpenChange = vi.fn()
    render(<CustomSectionDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    const submit = screen.getByTestId("custom-section-submit") as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId("custom-section-title-input"), { target: { value: "  Pricing  " } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith("Pricing")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("does not submit a blank title", () => {
    const onSubmit = vi.fn()
    render(<CustomSectionDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId("custom-section-title-input"), { target: { value: "   " } })
    fireEvent.submit(screen.getByTestId("custom-section-title-input").closest("form")!)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("renders nothing when closed", () => {
    render(<CustomSectionDialog open={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.queryByTestId("custom-section-dialog")).toBeNull()
  })
})
