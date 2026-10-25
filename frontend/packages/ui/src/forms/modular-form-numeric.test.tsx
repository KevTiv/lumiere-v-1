import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

afterEach(cleanup)

const config: FormConfig = {
  id: "numeric", title: "Numeric",
  sections: [{ id: "main", fields: [
    { id: "expectedRevenue", name: "expectedRevenue", label: "Expected revenue", type: "money", currency: "eur" },
    { id: "probability", name: "probability", label: "Probability", type: "percent" },
    { id: "productQty", name: "productQty", label: "Quantity", type: "quantity", unit: "kg", defaultValue: 2 },
  ] }],
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }))
}

// The first render loads the whole form module graph, which is slow on a busy machine.
describe("ModularForm numeric fields", { timeout: 20_000 }, () => {
  it("renders text inputs with adornments and submits empty values as blank", async () => {
    const onSubmit = vi.fn()
    render(<ModularForm config={config} onSubmit={onSubmit} />)
    const money = screen.getByTestId("form-field-expectedRevenue") as HTMLInputElement
    expect(money.type).toBe("text")
    expect(money.inputMode).toBe("decimal")
    expect(money.getAttribute("aria-invalid")).toBe("false")
    expect(screen.getByText("EUR")).toBeTruthy()
    expect(screen.getByText("%")).toBeTruthy()
    expect(screen.getByText("kg")).toBeTruthy()
    expect((screen.getByTestId("form-field-productQty") as HTMLInputElement).value).toBe("2")
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ expectedRevenue: "", probability: "", productQty: 2 }))
  })

  it("parses locale money input, stores a number and shows it grouped after blur", async () => {
    const onSubmit = vi.fn()
    render(<ModularForm config={config} onSubmit={onSubmit} />)
    const money = screen.getByTestId("form-field-expectedRevenue") as HTMLInputElement
    fireEvent.focus(money)
    fireEvent.change(money, { target: { value: "1 234,5" } })
    fireEvent.blur(money)
    expect(money.value).toBe("1,234.50")
    fireEvent.focus(money)
    expect(money.value).toBe("1234.5")
    fireEvent.blur(money)
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ expectedRevenue: 1234.5, probability: "", productQty: 2 }))
  })

  it("rejects text that is not a number", async () => {
    const onSubmit = vi.fn()
    render(<ModularForm config={config} onSubmit={onSubmit} />)
    const money = screen.getByTestId("form-field-expectedRevenue") as HTMLInputElement
    fireEvent.change(money, { target: { value: "12abc" } })
    submit()
    await waitFor(() => expect(screen.getByText("common.validation.invalidNumber")).toBeTruthy())
    expect(money.getAttribute("aria-invalid")).toBe("true")
    expect(money.getAttribute("aria-describedby")).toBe("expectedRevenue-error")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("bounds percent to 0–100 by default and quantity to non-negative", async () => {
    const onSubmit = vi.fn()
    render(<ModularForm config={config} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId("form-field-probability"), { target: { value: "120" } })
    fireEvent.change(screen.getByTestId("form-field-productQty"), { target: { value: "-1" } })
    submit()
    await waitFor(() => expect(screen.getByText("common.validation.max")).toBeTruthy())
    expect(screen.getByText("common.validation.min")).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId("form-field-probability"), { target: { value: "37,5" } })
    fireEvent.change(screen.getByTestId("form-field-productQty"), { target: { value: "3" } })
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ expectedRevenue: "", probability: 37.5, productQty: 3 }))
  })

  it("accepts prefilled machine strings unchanged and shows them formatted", async () => {
    const onSubmit = vi.fn()
    const prefilled: FormConfig = { ...config, sections: [{ id: "main", fields: [
      { id: "priceUnit", name: "priceUnit", label: "Price", type: "money", defaultValue: "1234.5" as unknown as number },
    ] }] }
    render(<ModularForm config={prefilled} onSubmit={onSubmit} />)
    expect((screen.getByTestId("form-field-priceUnit") as HTMLInputElement).value).toBe("1,234.50")
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ priceUnit: "1234.5" }))
  })

  it("lets validation override the default percent range", async () => {
    const onSubmit = vi.fn()
    const wide: FormConfig = { ...config, sections: [{ id: "main", fields: [
      { id: "markup", name: "markup", label: "Markup", type: "percent", validation: { max: 500 } },
    ] }] }
    render(<ModularForm config={wide} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId("form-field-markup"), { target: { value: "250" } })
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ markup: 250 }))
  })
})
