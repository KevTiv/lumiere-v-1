import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useConfirmDialog } from "./use-confirm-dialog"

afterEach(cleanup)

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirmDialog()
  return (
    <>
      <button onClick={async () => onResult(await confirm({ description: "Delete this?" }))}>go</button>
      {dialog}
    </>
  )
}

describe("useConfirmDialog", () => {
  it("cancels an earlier request even when two requests arrive before a render", async () => {
    const { result } = renderHook(() => useConfirmDialog())
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = result.current.confirm({ description: "First" })
      second = result.current.confirm({ description: "Second" })
    })
    await expect(first).resolves.toBe(false)
    const view = render(<>{result.current.dialog}</>)
    expect(screen.queryByText("First")).toBeNull()
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await expect(second).resolves.toBe(true)
    view.unmount()
  })

  it("resolves a pending request as cancelled on unmount", async () => {
    const { result, unmount } = renderHook(() => useConfirmDialog())
    let answer!: Promise<boolean>
    act(() => { answer = result.current.confirm({ description: "Pending" }) })
    unmount()
    await expect(answer).resolves.toBe(false)
  })

  it("resolves true on confirm", async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByText("go"))
    expect(await screen.findByText("Delete this?")).toBeTruthy()
    expect(screen.getByRole("alertdialog").getAttribute("aria-labelledby")).toBeTruthy()
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })

  it("resolves false on cancel", async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByText("go"))
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })
})
