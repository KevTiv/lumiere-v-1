import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { useRouter } from "next/navigation"
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard"
import { NavigationGuardProvider } from "./navigation-guard-provider"

afterEach(cleanup)

function Editor({ dirty = true, pending = false }: { dirty?: boolean; pending?: boolean }) {
  useUnsavedChangesGuard(dirty, pending)
  const router = useRouter()
  return <>
    <button onClick={() => router.push("/another-record")}>Push</button>
    <button onClick={() => router.replace("/another-record?tab=lines")}>Replace</button>
  </>
}

function setup(dirty = true, pending = false) {
  const router: AppRouterInstance = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }
  const view = render(<AppRouterContext.Provider value={router}>
    <NavigationGuardProvider><Editor dirty={dirty} pending={pending} /><Editor dirty={dirty} pending={pending} /></NavigationGuardProvider>
  </AppRouterContext.Provider>)
  return { router, ...view }
}

describe("shared App Router navigation guard", () => {
  it("blocks programmatic push and resumes once for all dirty editors", async () => {
    const { router } = setup()
    fireEvent.click(screen.getAllByText("Push")[0]!)
    expect(router.push).not.toHaveBeenCalled()
    expect(await screen.findAllByRole("alertdialog")).toHaveLength(1)
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(router.push).toHaveBeenCalledExactlyOnceWith("/another-record"))
  })

  it("leaves a cancelled tab replacement untouched", async () => {
    const { router } = setup()
    fireEvent.click(screen.getAllByText("Replace")[0]!)
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"))
    expect(router.replace).not.toHaveBeenCalled()
  })

  it("does not allow navigation during an in-flight save", async () => {
    const { router } = setup(false, true)
    fireEvent.click(screen.getAllByText("Push")[0]!)
    await Promise.resolve()
    expect(router.push).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("rechecks pending saves when a discard prompt is accepted", async () => {
    const router: AppRouterInstance = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }
    const tree = (pending: boolean) => <AppRouterContext.Provider value={router}>
      <NavigationGuardProvider><Editor pending={pending} /></NavigationGuardProvider>
    </AppRouterContext.Provider>
    const { rerender } = render(tree(false))
    fireEvent.click(screen.getByText("Push"))
    await screen.findByTestId("confirm-dialog-confirm")
    rerender(tree(true))
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(router.push).not.toHaveBeenCalled()
  })

  it("lets clean editors navigate without a prompt", () => {
    const { router } = setup(false)
    fireEvent.click(screen.getAllByText("Push")[0]!)
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/another-record")
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })
})
