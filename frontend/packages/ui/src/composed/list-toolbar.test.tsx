import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Input } from "../components/input"
import { ListToolbar, ListToolbarField, ListToolbarFields, ListToolbarSettings, ListToolbarSettingsTrigger } from "./list-toolbar"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }) }))
afterEach(cleanup)

describe("shared list toolbar", () => {
  it("keeps primary filters labelled and preserves settings drafts while hiding the settings surface", () => {
    render(<ListToolbar>
      <ListToolbarFields>
        <ListToolbarField label="Search"><Input defaultValue="Invoice" /></ListToolbarField>
        <ListToolbarSettingsTrigger />
      </ListToolbarFields>
      <ListToolbarSettings><ListToolbarField label="View name"><Input defaultValue="Draft review" /></ListToolbarField></ListToolbarSettings>
    </ListToolbar>)
    expect(screen.getByRole("textbox", { name: "Search" }).getAttribute("value")).toBe("Invoice")
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull()
    const trigger = screen.getByRole("button", { name: "View settings" })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(trigger)
    expect(screen.getByRole("region", { name: "View settings" })).toBeTruthy()
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Unsubmitted name" } })
    fireEvent.click(trigger)
    expect(screen.queryByRole("textbox", { name: "View name" })).toBeNull()
    fireEvent.click(trigger)
    expect((screen.getByRole("textbox", { name: "View name" }) as HTMLInputElement).value).toBe("Unsubmitted name")
  })
})
