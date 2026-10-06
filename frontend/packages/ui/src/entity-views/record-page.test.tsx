import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RecordPage, type RecordPageProps } from "./record-page"
import { StatusBar } from "./status-bar"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

const steps = [
  { id: "draft", label: "Quotation" },
  { id: "sent", label: "Sent" },
  { id: "sale", label: "Sales order" },
]

describe("StatusBar", () => {
  it("marks earlier stages done, the current one current, later ones upcoming", () => {
    render(<StatusBar steps={steps} current="sent" />)

    expect(screen.getByTestId("status-bar-step-draft").dataset.state).toBe("done")
    expect(screen.getByTestId("status-bar-step-sent").dataset.state).toBe("current")
    expect(screen.getByTestId("status-bar-step-sent").getAttribute("aria-current")).toBe("step")
    expect(screen.getByTestId("status-bar-step-sale").dataset.state).toBe("upcoming")
  })

  it("leaves every stage upcoming for a state outside the flow", () => {
    render(<StatusBar steps={steps} current="unknown" />)

    for (const step of steps) {
      expect(screen.getByTestId(`status-bar-step-${step.id}`).dataset.state).toBe("upcoming")
    }
  })

  it("shows a terminal state after muted stages instead of a current stage", () => {
    render(<StatusBar steps={steps} current="sent" terminal={{ label: "Cancelled" }} />)

    expect(screen.getByTestId("status-bar-terminal").textContent).toBe("Cancelled")
    for (const step of steps) {
      expect(screen.getByTestId(`status-bar-step-${step.id}`).dataset.state).toBe("upcoming")
    }
  })
})

function renderPage(overrides: Partial<RecordPageProps> = {}) {
  const onTabChange = vi.fn()
  render(
    <RecordPage
      testIdPrefix="order"
      breadcrumbs={[{ label: "Sales", href: "/sales" }, { label: "Orders", href: "/sales?tab=orders" }, { label: "SO-7" }]}
      title="SO-7"
      subtitle="Acme"
      actions={<button type="button">Confirm</button>}
      activeTab="overview"
      onTabChange={onTabChange}
      tabs={[
        { id: "overview", label: "Overview", content: <p>Overview body</p> },
        { id: "lines", label: "Lines", content: <p>Lines body</p> },
      ]}
      {...overrides}
    />,
  )
  return { onTabChange }
}

describe("RecordPage", () => {
  it("shows linked ancestors and the record itself as the current crumb", () => {
    renderPage()

    expect(screen.getByRole("link", { name: "Sales" }).getAttribute("href")).toBe("/sales")
    expect(screen.getByRole("link", { name: "Orders" }).getAttribute("href")).toBe("/sales?tab=orders")
    expect(screen.getByText("SO-7", { selector: '[aria-current="page"]' })).toBeTruthy()
    expect(screen.getByTestId("order-title").textContent).toBe("SO-7")
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()
  })

  it("renders the active tab and reports tab changes", () => {
    const { onTabChange } = renderPage()

    expect(screen.getByText("Overview body")).toBeTruthy()
    fireEvent.click(screen.getByTestId("order-tab-lines"))
    expect(onTabChange).toHaveBeenCalledWith("lines")
  })

  it("links to the previous and next record and shows the position", () => {
    renderPage({
      navigation: {
        position: 2,
        total: 3,
        previous: { href: "/sales/orders/8", label: "SO-8" },
        next: { href: "/sales/orders/6", label: "SO-6" },
      },
    })

    expect(screen.getByText("2 / 3")).toBeTruthy()
    expect(screen.getByTestId("order-previous").getAttribute("href")).toBe("/sales/orders/8")
    expect(screen.getByTestId("order-next").getAttribute("href")).toBe("/sales/orders/6")
  })

  it("disables the arrow at either end of the list", () => {
    renderPage({ navigation: { position: 1, total: 3, next: { href: "/sales/orders/6", label: "SO-6" } } })

    expect((screen.getByTestId("order-previous") as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId("order-next").getAttribute("href")).toBe("/sales/orders/6")
  })

  it("hides navigation for a list of one", () => {
    renderPage({ navigation: { position: 1, total: 1 } })

    expect(screen.queryByTestId("order-navigation")).toBeNull()
  })
})
