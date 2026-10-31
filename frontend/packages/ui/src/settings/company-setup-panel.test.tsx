import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CompanySetupPanel } from "../../../../web/lib/company-setup-panel"
import {
  companySetupStorageKey,
  newCompanySetupDraft,
  type CompanySetupDraft,
} from "../../../../web/lib/company-setup-model"

const company = {
  id: "7",
  name: "Mugisha Farm",
  code: "FARM",
  countryCode: "RW",
  currencyId: "4",
  taxId: "",
  fiscalYearEndMonth: 12,
  fiscalYearEndDay: 31,
}
const draft = () => newCompanySetupDraft("test-submission-0001", company)
const storageKey = companySetupStorageKey("owner-a", 1, "7")
const currencies = [{ value: "4", label: "RWF — Rwandan Franc" }]
const units = [
  { value: "8", label: "Kilograms (kg)" },
  { value: "9", label: "Units" },
]
const props = () => ({
  initialDraft: draft(),
  storageKey,
  currencies,
  units,
  canSave: true,
  onSave: vi.fn(async (_draft: CompanySetupDraft) => "7"),
  onRecover: vi.fn(async (_draft: CompanySetupDraft) => "7"),
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe("guided company setup", () => {
  it("requires a review before applying existing company details and keeps unknown choices explicit", async () => {
    const input = props()
    render(<CompanySetupPanel {...input} />)
    fireEvent.change(screen.getByLabelText("VAT registration"), {
      target: { value: "registered" },
    })
    fireEvent.change(screen.getByLabelText("Tax / VAT registration number"), {
      target: { value: "TIN-FARM" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Kilograms (kg)" }))
    fireEvent.change(screen.getByLabelText("Historical data"), {
      target: { value: "full-history" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
    expect(input.onSave).not.toHaveBeenCalled()
    expect(
      screen.getByText(/VAT status, units and historical-data choices remain/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Review accounts" })
        .getAttribute("href"),
    ).toBe("/accounting?tab=accounts&companyId=7")
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm company details" }),
    )
    await waitFor(() => expect(input.onSave).toHaveBeenCalledOnce())
    expect(input.onSave.mock.calls[0]?.[0]).toMatchObject({
      currencyId: "4",
      unitIds: ["8"],
      historicalMode: "full-history",
      taxRegistration: "registered",
      taxId: "TIN-FARM",
    })
    await screen.findByText(/Company details saved/)
  })

  it("restores a reviewed plan after remount without marking linked settings completed", () => {
    const input = props()
    const first = render(<CompanySetupPanel {...input} />)
    fireEvent.change(screen.getByLabelText("Historical data"), {
      target: { value: "opening-balances" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
    first.unmount()
    render(
      <CompanySetupPanel
        {...input}
        initialDraft={newCompanySetupDraft("new-render-submission", company)}
      />,
    )
    expect(
      screen.getByText("Opening balances and outstanding documents"),
    ).toBeTruthy()
    expect(screen.getByText("VAT registration still unknown")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Confirm company details" }),
    ).toBeTruthy()
    expect(input.onSave).not.toHaveBeenCalled()
  })

  it("retains an uncertain submission through refresh and recovers without another save", async () => {
    const input = {
      ...props(),
      onSave: vi.fn(async () => {
        throw new Error("Connection interrupted")
      }),
    }
    const first = render(<CompanySetupPanel {...input} />)
    fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm company details" }),
    )
    await screen.findByRole("button", { name: "Check saved company" })
    first.unmount()
    render(<CompanySetupPanel {...input} />)
    expect(
      screen.queryByRole("button", { name: "Confirm company details" }),
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Check saved company" }))
    await screen.findByText(/Company details saved/)
    expect(input.onSave).toHaveBeenCalledOnce()
    expect(input.onRecover).toHaveBeenCalledOnce()
  })

  it("does not restore another actor's plan and keeps save gated by permission", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...draft(), taxId: "PRIVATE-TIN", stage: "review" }),
    )
    const input = {
      ...props(),
      storageKey: companySetupStorageKey("owner-b", 1, "7"),
      canSave: false,
    }
    render(<CompanySetupPanel {...input} />)
    expect(
      (
        screen.getByLabelText(
          "Tax / VAT registration number",
        ) as HTMLInputElement
      ).value,
    ).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm company details",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(input.onSave).not.toHaveBeenCalled()
  })

  it.each(["save", "recover"] as const)(
    "ignores a late %s result after permission changes and preserves a newer retained plan",
    async (operation) => {
      const pending = deferred<string>()
      const input = {
        ...props(),
        ...(operation === "save"
          ? { onSave: vi.fn(() => pending.promise) }
          : { onRecover: vi.fn(() => pending.promise) }),
      }
      if (operation === "recover")
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...draft(), stage: "uncertain" }),
        )
      const view = render(<CompanySetupPanel {...input} />)
      if (operation === "save") {
        fireEvent.click(
          screen.getByRole("button", { name: "Review linked setup" }),
        )
        fireEvent.click(
          screen.getByRole("button", { name: "Confirm company details" }),
        )
      } else
        fireEvent.click(
          screen.getByRole("button", { name: "Check saved company" }),
        )
      view.rerender(<CompanySetupPanel {...input} canSave={false} />)
      view.rerender(<CompanySetupPanel {...input} />)
      const newer = JSON.stringify({
        ...draft(),
        taxId: "NEWER-REVIEW",
        stage: "review",
      })
      localStorage.setItem(storageKey, newer)
      await act(async () => {
        pending.resolve("7")
        await pending.promise
      })
      expect(localStorage.getItem(storageKey)).toBe(newer)
      expect(screen.queryByText(/Company details saved/)).toBeNull()
      expect(
        screen.getByRole("button", { name: "Check saved company" }),
      ).toBeTruthy()
    },
  )

  it("does not overwrite the retained plan after the panel unmounts during a save", async () => {
    const pending = deferred<string>()
    const input = { ...props(), onSave: vi.fn(() => pending.promise) }
    const view = render(<CompanySetupPanel {...input} />)
    fireEvent.click(screen.getByRole("button", { name: "Review linked setup" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm company details" }),
    )
    view.unmount()
    const retained = localStorage.getItem(storageKey)
    await act(async () => {
      pending.resolve("7")
      await pending.promise
    })
    expect(localStorage.getItem(storageKey)).toBe(retained)
  })
})
