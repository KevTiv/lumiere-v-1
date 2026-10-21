import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeProvider, useTheme } from "./theme-provider"

function Preferences() {
  const { density, setDensity } = useTheme()
  return <button onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>{density}</button>
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("workspace density", () => {
  it("restores compact tables after reopening the application", () => {
    window.localStorage.setItem("lumiere-density", "compact")
    const { unmount } = render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe("compact")
    fireEvent.click(screen.getByRole("button", { name: "compact" }))
    expect(window.localStorage.getItem("lumiere-density")).toBe("comfortable")
    unmount()
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe("comfortable")
  })

  it("keeps a usable default and lets users change density when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe("comfortable")
    fireEvent.click(screen.getByRole("button", { name: "comfortable" }))
    expect(document.documentElement.dataset.density).toBe("compact")
  })

  it("ignores unsupported persisted density values", () => {
    window.localStorage.setItem("lumiere-density", "invalid")
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe("comfortable")
  })
})
