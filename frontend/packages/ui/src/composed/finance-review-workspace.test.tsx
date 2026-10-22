import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { FinanceReviewWorkspace } from "./finance-review-workspace"
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }) }))
afterEach(cleanup)
function Editor() {
  const [value, setValue] = useState("")
  return <><input aria-label="Description" value={value} onChange={(event) => setValue(event.target.value)} /><input type="file" aria-label="Receipt file" /></>
}
describe("Finance review workspace", () => {
  it("keeps one editor and selected file mounted through view changes", () => {
    render(<FinanceReviewWorkspace editor={<Editor />} preview={<p>Source preview</p>} />)
    const input = screen.getByLabelText("Description") as HTMLInputElement
    const upload = screen.getByLabelText("Receipt file") as HTMLInputElement
    const file = new File(["receipt"], "receipt.png", { type: "image/png" })
    fireEvent.change(input, { target: { value: "Reviewed bill" } })
    fireEvent.change(upload, { target: { files: [file] } })
    for (const label of ["Document preview", "Edit document", "Side by side"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }))
      expect(document.querySelector('input[aria-label="Description"]')).toBe(input)
      expect(input.value).toBe("Reviewed bill")
      expect(upload.files?.[0]).toBe(file)
    }
    expect(screen.getAllByLabelText("Description")).toHaveLength(1)
    expect(screen.getByText("Source preview")).toBeTruthy()
  })
})
