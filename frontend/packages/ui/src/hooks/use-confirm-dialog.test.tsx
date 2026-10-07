import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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
  it("resolves true on confirm", async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByText("go"))
    expect(await screen.findByText("Delete this?")).toBeTruthy()
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
