import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { SaleOrderLineGrid, type LineGridProduct, type SaleOrderLineGridProps } from "./sale-order-line-grid"

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

afterEach(cleanup)

const products: LineGridProduct[] = [
  { id: "10", label: "Desk", uomId: "1", listPrice: 120 },
  { id: "11", label: "Chair", uomId: "1" },
  { id: "12", label: "Service", uomId: undefined },
]

const lines = [
  { id: 2, sequence: 20, productId: 11, name: "Chair", productUomQty: 4, priceUnit: 25, discount: 0, priceSubtotal: 100, priceTax: 20 },
  { id: 1, sequence: 10, productId: 10, name: "Desk", productUomQty: 1, priceUnit: 100, discount: 0, priceSubtotal: 100, priceTax: 20 },
]

function setup(overrides: Partial<SaleOrderLineGridProps> = {}) {
  const props = {
    lines,
    products,
    editable: true,
    onUpdateLine: vi.fn(async () => {}),
    onCreateLine: vi.fn(async () => {}),
    onDeleteLine: vi.fn(async () => {}),
    ...overrides,
  }
  render(<SaleOrderLineGrid {...props} />)
  return props
}

const text = (id: string) => screen.getByTestId(`sale-order-lines-${id}`).textContent

describe("SaleOrderLineGrid", () => {
  it("lists lines in the order they were entered, with their totals", () => {
    setup()

    const rows = screen.getAllByTestId(/^sale-order-lines-row-/)
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "sale-order-lines-row-1",
      "sale-order-lines-row-2",
    ])
    expect(text("untaxed")).toBe("200.00")
    expect(text("tax")).toBe("40.00")
    expect(text("total")).toBe("240.00")
  })

  it("saves an edited quantity and reports which line and field", async () => {
    const { onUpdateLine } = setup()

    fireEvent.change(screen.getByTestId("sale-order-lines-qty-2"), { target: { value: "6" } })
    fireEvent.blur(screen.getByTestId("sale-order-lines-qty-2"))

    await waitFor(() => expect(onUpdateLine).toHaveBeenCalledWith("2", { quantity: 6 }))
  })

  it("moves the totals as you type, before anything is saved", () => {
    setup()

    fireEvent.change(screen.getByTestId("sale-order-lines-qty-2"), { target: { value: "6" } })

    expect(text("subtotal-2")).toBe("150.00")
    expect(text("untaxed")).toBe("250.00")
    expect(text("tax")).toBe("50.00")
    expect(text("total")).toBe("300.00")
    expect(screen.getByText("Total (estimated until saved)")).toBeTruthy()
  })

  it("drops the estimate again when the edit is abandoned", () => {
    setup()
    const qty = screen.getByTestId("sale-order-lines-qty-2")
    qty.focus()

    fireEvent.change(qty, { target: { value: "6" } })
    fireEvent.keyDown(qty, { key: "Escape" })

    expect(text("total")).toBe("240.00")
    expect(screen.queryByText("Total (estimated until saved)")).toBeNull()
  })

  it("shows a rejected save on the line it belongs to and keeps the saved value", async () => {
    setup({ onUpdateLine: vi.fn(async () => Promise.reject(new Error("Order is locked"))) })

    fireEvent.change(screen.getByTestId("sale-order-lines-price-1"), { target: { value: "90" } })
    fireEvent.blur(screen.getByTestId("sale-order-lines-price-1"))

    expect((await screen.findByTestId("sale-order-lines-error-1")).textContent).toBe("Order is locked")
    await waitFor(() => expect((screen.getByTestId("sale-order-lines-price-1") as HTMLInputElement).value).toBe("100"))
    expect(text("untaxed")).toBe("200.00")
  })

  it("is read-only, with no add row or remove buttons, when the order cannot be changed", () => {
    setup({ editable: false })

    expect((screen.getByTestId("sale-order-lines-qty-1") as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByTestId("sale-order-lines-add")).toBeNull()
    expect(screen.queryByTestId("sale-order-lines-delete-1")).toBeNull()
  })

  it("removes a line only after confirmation", async () => {
    const { onDeleteLine } = setup()

    fireEvent.click(screen.getByTestId("sale-order-lines-delete-1"))
    expect(onDeleteLine).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }))
    await waitFor(() => expect(onDeleteLine).toHaveBeenCalledWith("1"))
  })

  it("keeps a line when removal is declined", async () => {
    const { onDeleteLine } = setup()

    fireEvent.click(screen.getByTestId("sale-order-lines-delete-1"))
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }))

    expect(onDeleteLine).not.toHaveBeenCalled()
  })

  it("says there are no lines yet", () => {
    setup({ lines: [] })

    expect(screen.getByText("No lines yet")).toBeTruthy()
    expect(text("total")).toBe("0.00")
  })
})

describe("SaleOrderLineGrid add row", () => {
  const pick = async (name: RegExp) => {
    fireEvent.click(screen.getByTestId("sale-order-lines-add-product"))
    fireEvent.click(await screen.findByRole("option", { name }))
  }

  it("cannot add until a product is picked", () => {
    setup()

    const add = screen.getByTestId("sale-order-lines-add-submit") as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(add.title).toBe("Pick a product")
  })

  it("adds a line with the product's unit and quantity, taking the price from the pricelist when left empty", async () => {
    const { onCreateLine } = setup()

    await pick(/Desk/)
    fireEvent.change(screen.getByTestId("sale-order-lines-add-qty"), { target: { value: "3" } })
    fireEvent.click(screen.getByTestId("sale-order-lines-add-submit"))

    await waitFor(() =>
      expect(onCreateLine).toHaveBeenCalledWith({
        productId: "10",
        uomId: "1",
        quantity: 3,
        priceUnit: undefined,
        discount: 0,
      }),
    )
  })

  it("hints the product's list price and sends a price the user typed", async () => {
    const { onCreateLine } = setup()

    await pick(/Desk/)
    const price = screen.getByTestId("sale-order-lines-add-price") as HTMLInputElement
    expect(price.placeholder).toBe("List 120.00")
    fireEvent.change(price, { target: { value: "99.5" } })
    fireEvent.change(screen.getByTestId("sale-order-lines-add-discount"), { target: { value: "10" } })
    fireEvent.click(screen.getByTestId("sale-order-lines-add-submit"))

    await waitFor(() =>
      expect(onCreateLine).toHaveBeenCalledWith(expect.objectContaining({ priceUnit: 99.5, discount: 10 })),
    )
  })

  it("clears the row after a line is added", async () => {
    setup()
    await pick(/Chair/)
    fireEvent.click(screen.getByTestId("sale-order-lines-add-submit"))

    await waitFor(() => expect(screen.getByTestId("sale-order-lines-add-product").textContent).toContain("Add a product"))
  })

  it("refuses a product that has no unit of measure", async () => {
    setup()

    await pick(/Service/)

    const add = screen.getByTestId("sale-order-lines-add-submit") as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(add.title).toBe("This product has no unit of measure")
  })

  it("refuses a quantity of zero or a discount over 100", async () => {
    setup()
    await pick(/Desk/)
    const add = screen.getByTestId("sale-order-lines-add-submit") as HTMLButtonElement

    fireEvent.change(screen.getByTestId("sale-order-lines-add-qty"), { target: { value: "0" } })
    expect(add.title).toBe("Quantity must be above zero")

    fireEvent.change(screen.getByTestId("sale-order-lines-add-qty"), { target: { value: "1" } })
    fireEvent.change(screen.getByTestId("sale-order-lines-add-discount"), { target: { value: "150" } })
    expect(add.title).toBe("Discount is a percentage from 0 to 100")
  })

  it("shows why adding failed and keeps what was entered", async () => {
    setup({ onCreateLine: vi.fn(async () => Promise.reject(new Error("Order is locked"))) })
    await pick(/Desk/)

    fireEvent.click(screen.getByTestId("sale-order-lines-add-submit"))

    expect((await screen.findByTestId("sale-order-lines-add-error")).textContent).toBe("Order is locked")
    expect(screen.getByTestId("sale-order-lines-add-product").textContent).toContain("Desk")
  })
})

describe("within a page", () => {
  it("scopes its test ids to the prefix it is given", () => {
    setup({ testIdPrefix: "quote-lines" })

    expect(within(screen.getByTestId("quote-lines")).getAllByTestId(/^quote-lines-row-/)).toHaveLength(2)
  })
})
