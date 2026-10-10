import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k, i18n: { language: "en" } }),
}))
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }))

import { NotificationBell } from "./notification-bell"
import { DashboardHeader, HeaderTrailingProvider } from "./dashboard-header"

afterEach(cleanup)

const items = [
  { id: "2", title: "New comment", dateMs: 2000, model: "lead", resId: "3" },
  { id: "1", title: "Older", dateMs: 1000, model: "lead", resId: "3" },
]

describe("NotificationBell", () => {
  it("shows the count and lists items linking to the message page", () => {
    render(<NotificationBell notifications={items} viewAllHref="/messages" itemHref={(n) => `/messages/${n.id}`} />)
    expect(screen.getByTestId("notification-bell-count").textContent).toBe("2")
    fireEvent.click(screen.getByTestId("notification-bell"))
    expect(screen.getByTestId("notification-bell-item-2").getAttribute("href")).toBe("/messages/2")
    expect(screen.getByTestId("notification-bell-view-all").getAttribute("href")).toBe("/messages")
  })

  it("hides the badge when empty", () => {
    render(<NotificationBell notifications={[]} viewAllHref="/messages" itemHref={() => "/"} />)
    expect(screen.queryByTestId("notification-bell-count")).toBeNull()
  })
})

describe("DashboardHeader trailing slot", () => {
  it("renders the provided trailing node and nothing without one", () => {
    const { rerender } = render(<DashboardHeader title="T" />)
    expect(screen.queryByTestId("slot")).toBeNull()
    rerender(
      <HeaderTrailingProvider value={<span data-testid="slot" />}>
        <DashboardHeader title="T" />
      </HeaderTrailingProvider>,
    )
    expect(screen.getByTestId("slot")).toBeTruthy()
  })
})
