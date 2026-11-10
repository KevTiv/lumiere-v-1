import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"

afterEach(cleanup)

it("starts a wide record review at its title and restores focus to the opener", async () => {
  const post = vi.fn()
  render(
    <Dialog>
      <DialogTrigger>Review ledger entry</DialogTrigger>
      <DialogContent size="review" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ledger entry</DialogTitle>
          <button type="button" onClick={post}>
            Post
          </button>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )

  const trigger = screen.getByRole("button", { name: "Review ledger entry" })
  trigger.focus()
  fireEvent.click(trigger)
  const heading = screen.getByRole("heading", { name: "Ledger entry" })
  await waitFor(() => expect(document.activeElement).toBe(heading))
  expect(screen.getByRole("dialog").style.maxWidth).toContain("72rem")
  expect(post).not.toHaveBeenCalled()

  fireEvent.keyDown(heading, { key: "Escape" })
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})
