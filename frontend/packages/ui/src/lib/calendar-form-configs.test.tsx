import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { TFunction } from "i18next"
import { newCalendarEventForm } from "./calendar-form-configs"
import { ModularForm } from "../forms/modular-form"

const translate = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
const t = translate as TFunction
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))
beforeAll(() => {
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
})
afterEach(cleanup)

describe("calendar task entry", () => {
  it("retains create wording when prefilled from a selected date", () => {
    const config = newCalendarEventForm(t, { start: "2026-10-28T09:00", stop: "2026-10-28T10:00" }, "create")
    expect(config.id).toBe("new-calendar-event")
    expect(config.submitLabel).toBe("Create event")
  })

  it("changes all-day entry to date controls and submits without hidden timed requirements", async () => {
    const submit = vi.fn()
    const config = newCalendarEventForm(t, { name: "Company day", start: "2026-10-28T09:00", stop: "2026-10-28T10:00" }, "create")
    render(<ModularForm config={config} onSubmit={submit} draft={false} />)
    expect(screen.queryByTestId("form-field-allDayStart")).toBeNull()
    fireEvent.click(screen.getByRole("checkbox", { name: "calendar.forms.newEvent.fields.allday" }))
    expect(screen.queryByTestId("form-field-start")).toBeNull()
    expect(screen.getByTestId("form-field-allDayStart")).toBeTruthy()
    expect(screen.getByTestId("form-field-allDayEnd")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Create event" }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0]).toMatchObject({ allday: true, allDayStart: "2026-10-28", allDayEnd: "2026-10-28" })
  })

  it("shows an inclusive last day for existing half-open all-day ranges and retains original boundaries", () => {
    const fields = newCalendarEventForm(t, { start: "2026-10-28T00:00", stop: "2026-10-30T00:00", allday: true }).sections.flatMap((section) => section.fields)
    expect(fields.find((field) => field.name === "allDayEnd")?.defaultValue).toBe("2026-10-29")
    expect(fields.find((field) => field.name === "originalAllDayStop")?.defaultValue).toBe("2026-10-30T00:00")
  })
})
