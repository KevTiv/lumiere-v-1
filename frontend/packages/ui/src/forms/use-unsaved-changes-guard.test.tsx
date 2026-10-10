import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard"

afterEach(cleanup)

function Harness({ active = true, pending = false, onNavigate }: { active?: boolean; pending?: boolean; onNavigate: () => void }) {
  const dialog = useUnsavedChangesGuard(active, pending)
  return <>
    <a href="/other-record" onClick={(event) => { event.preventDefault(); onNavigate() }}>Other record</a>
    <a href="#details" onClick={(event) => { event.preventDefault(); onNavigate() }}>Details</a>
    <a href="/other-record" target="_blank" onClick={(event) => { event.preventDefault(); onNavigate() }}>New tab</a>
    {dialog}
  </>
}

describe("unsaved changes during link navigation", () => {
  it("blocks links and unload during a save even when the draft is clean", () => {
    const onNavigate = vi.fn()
    const { rerender } = render(<Harness active={false} pending onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.queryByTestId("confirm-dialog")).toBeNull()
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    rerender(<Harness active={false} pending={false} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it("keeps the original link blocked on Keep editing", async () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("replays the original link exactly once after Discard", async () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(1))
  })

  it("allows in-page anchors, new tabs and modified clicks", () => {
    const onNavigate = vi.fn()
    render(<Harness onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Details"))
    fireEvent.click(screen.getByText("New tab"))
    fireEvent.click(screen.getByText("Other record"), { ctrlKey: true })
    expect(onNavigate).toHaveBeenCalledTimes(3)
    expect(screen.queryByTestId("confirm-dialog")).toBeNull()
  })

  it("removes the navigation guard when the draft becomes clean", () => {
    const onNavigate = vi.fn()
    const { rerender } = render(<Harness onNavigate={onNavigate} />)
    rerender(<Harness active={false} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("confirm-dialog")).toBeNull()
  })

  it("dismisses a pending prompt when the draft is saved or closed", async () => {
    const onNavigate = vi.fn()
    const { rerender } = render(<Harness onNavigate={onNavigate} />)
    fireEvent.click(screen.getByText("Other record"))
    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy()
    rerender(<Harness active={false} onNavigate={onNavigate} />)
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull())
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
