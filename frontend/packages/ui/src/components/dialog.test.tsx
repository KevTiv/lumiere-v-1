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
  DialogBody,
  DialogContent,
  DialogFooter,
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
    </Dialog>,
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

it("bounds a structured dialog while preserving state-dependent props and action order", async () => {
  const save = vi.fn()
  render(
    <Dialog>
      <DialogTrigger>Edit address</DialogTrigger>
      <DialogContent
        size="form"
        layout="bounded"
        className={({ open }) => (open ? "bg-card" : undefined)}
        style={({ open }) =>
          open
            ? { minWidth: "100rem", maxHeight: "50rem", paddingTop: "2rem" }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>Address</DialogTitle>
        </DialogHeader>
        <DialogBody tabIndex={0}>Address details</DialogBody>
        <DialogFooter showCloseButton>
          <button type="button" onClick={save}>
            Save address
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  )

  const trigger = screen.getByRole("button", { name: "Edit address" })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole("dialog", { name: "Address" })
  const title = screen.getByRole("heading", { name: "Address" })
  await waitFor(() => expect(document.activeElement).toBe(title))
  expect(dialog.dataset.layout).toBe("bounded")
  expect(dialog.dataset.reserveClose).toBe("bounded")
  expect(dialog.classList.contains("bg-card")).toBe(true)
  expect(dialog.style.maxWidth).toContain("40rem")
  expect(dialog.style.maxHeight).toBe("calc(100dvh - 2rem)")
  expect(Number.parseFloat(dialog.style.minWidth)).toBe(0)
  expect(dialog.style.paddingTop).toBe("2rem")
  const body = screen.getByText("Address details")
  expect(body.dataset.slot).toBe("dialog-body")
  expect(body.tabIndex).toBe(0)
  const action = screen.getByRole("button", { name: "Save address" })
  expect(action.parentElement?.dataset.slot).toBe("dialog-footer")
  expect(action.parentElement?.firstElementChild).toBe(action)

  fireEvent.click(action)
  expect(save).toHaveBeenCalledOnce()
  fireEvent.keyDown(action, { key: "Escape" })
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})
