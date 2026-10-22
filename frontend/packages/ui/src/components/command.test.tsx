import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { CommandDialog } from "./command"

afterEach(cleanup)

it("keeps the command palette name and description inside the active modal", async () => {
  render(<CommandDialog open title="Command Palette" description="Search Finance records"><p>Search controls</p></CommandDialog>)
  const dialog = await screen.findByRole("dialog", { name: "Command Palette", exact: true })
  expect(within(dialog).getByRole("heading", { name: "Command Palette" })).toBeTruthy()
  const descriptionId = dialog.getAttribute("aria-describedby")
  expect(descriptionId).toBeTruthy()
  const description = document.getElementById(descriptionId!)
  expect(dialog.contains(description)).toBe(true)
  expect(description?.textContent).toBe("Search Finance records")
})
