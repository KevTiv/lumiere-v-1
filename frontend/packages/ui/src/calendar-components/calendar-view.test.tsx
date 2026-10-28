import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CalendarView } from "./calendar-view"
import type { CalendarEvent } from "../lib/calendar-types"
import { renderToString } from "react-dom/server"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key, i18n: { language: "en" } }) }))
afterEach(cleanup)
const date = new Date(2026, 9, 28)
const event: CalendarEvent = { id: "7", title: "Supplier review", startTime: new Date(2026, 9, 28, 9), endTime: new Date(2026, 9, 28, 10), type: "meeting", status: "cancelled", allDay: true, attendees: [], createdBy: "", visibility: "private" }
function props() {
  return { events: [event], viewMode: "agenda" as const, currentDate: date, selectedDate: null, searchTerm: "", selectedEventId: null, onViewModeChange: vi.fn(), onPrevMonth: vi.fn(), onNextMonth: vi.fn(), onToday: vi.fn(), onSelectDate: vi.fn(), onSearchChange: vi.fn(), onSelectEvent: vi.fn() }
}

describe("calendar working views", () => {
  it("renders a deterministic server fallback before browser-local dates and timezone", () => {
    const html = renderToString(<CalendarView {...props()} />)
    expect(html).toContain('data-testid="calendar-workspace-loading"')
    expect(html).not.toContain("Supplier review")
    expect(html).not.toContain("Times shown")
  })
  it("shows date-grouped all-day and cancelled events with an explicit selected-item action", () => {
    const input = props()
    render(<CalendarView {...input} />)
    expect(screen.getByText("All day")).toBeTruthy()
    expect(screen.getByText("Cancelled")).toBeTruthy()
    fireEvent.click(screen.getByTestId("calendar-agenda-event-7"))
    expect(input.onSelectEvent).toHaveBeenCalledWith("7")
    expect(screen.queryByRole("button", { name: "calendar.view.newEvent" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Day", exact: true }))
    expect(input.onViewModeChange).toHaveBeenCalledWith("day")
  })

  it("keeps month date and event controls independent and ignores missing selected rows", () => {
    const input = props()
    const { container } = render(<CalendarView {...input} viewMode="month" selectedEventId="unavailable" />)
    expect(container.querySelector("button button")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Wednesday, October 28" }))
    expect(input.onSelectDate).toHaveBeenCalledTimes(1)
    expect(input.onSelectEvent).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Supplier review" }))
    expect(input.onSelectEvent).toHaveBeenCalledWith("7")
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
