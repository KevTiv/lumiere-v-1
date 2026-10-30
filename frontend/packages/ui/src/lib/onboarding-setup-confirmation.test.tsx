import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { SetupConfirmation } from "../../../../web/app/(auth)/onboarding/setup-confirmation"

const label = "I have checked the base currency, company timezone and fiscal year-end."

beforeAll(() => {
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
})
afterEach(cleanup)

function Setup() {
  const [checked, setChecked] = useState(false)
  return <SetupConfirmation checked={checked} onCheckedChange={setChecked} label={label} />
}

describe("onboarding setup confirmation", () => {
  it("exposes one visible checkbox with the complete confirmation text as its name", () => {
    render(<Setup />)
    const checkbox = screen.getByRole("checkbox", { name: label, exact: true })
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    expect(checkbox.tagName).toBe("BUTTON")
    expect(checkbox.getAttribute("type")).toBe("button")
    expect(checkbox.getAttribute("aria-checked")).toBe("false")
    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)
    fireEvent.click(checkbox)
    expect(checkbox.getAttribute("aria-checked")).toBe("true")
  })

  it("clicking the visible label changes the same confirmation control exactly once", () => {
    render(<Setup />)
    const checkbox = screen.getByRole("checkbox", { name: label, exact: true })
    fireEvent.click(screen.getByText(label))
    expect(checkbox.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByText(label))
    expect(checkbox.getAttribute("aria-checked")).toBe("false")
  })
})
