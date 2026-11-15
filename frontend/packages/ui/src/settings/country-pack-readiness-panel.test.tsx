import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CountryPackReadinessPanel } from "./country-pack-readiness-panel"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) =>
      typeof options === "object" && options.defaultValue
        ? options.defaultValue
        : key,
  }),
}))

afterEach(cleanup)

describe("CountryPackReadinessPanel", () => {
  it("keeps activation controls hidden when company status could not be verified", () => {
    const retry = vi.fn()
    const onEnabledChange = vi.fn()
    render(
      <CountryPackReadinessPanel
        definitions={[{
          packKey: "rw", countryCode: "RW", name: "Rwanda", region: "east_africa",
          version: "1", acceptanceStatus: "accepted", isActive: true,
        }]}
        activations={[]}
        dataState={{ status: "error", onRetry: retry }}
        onEnabledChange={onEnabledChange}
      />,
    )
    expect(screen.getByRole("alert").textContent).toContain("Records could not be loaded")
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByText("settings.organization.countryPacks.emptyCatalog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
    expect(onEnabledChange).not.toHaveBeenCalled()
  })

  it("shows review-required Rwanda as unavailable for activation", () => {
    const onEnabledChange = vi.fn()
    render(
      <CountryPackReadinessPanel
        definitions={[
          {
            packKey: "rw",
            countryCode: "RW",
            name: "Rwanda",
            region: "east_africa",
            version: "0.1.0",
            acceptanceStatus: "review_required",
            effectiveFrom: null,
            effectiveTo: null,
            isActive: true,
            metadata: JSON.stringify({
              official_sources: [
                {
                  authority: "Rwanda Revenue Authority",
                  title: "Value Added Tax (VAT), 2025",
                  url: "https://www.rra.gov.rw/vat.pdf",
                  accessed_on: "2026-10-15",
                },
              ],
              professional_confirmation_required: [
                "ebm_vsdc_certification_and_invoice_schema",
              ],
            }),
          },
        ]}
        activations={[]}
        onEnabledChange={onEnabledChange}
      />,
    )

    expect(screen.getByText("Rwanda")).toBeTruthy()
    expect(screen.getByTestId("country-pack-block-rw")).toBeTruthy()
    expect(screen.getByTestId("country-pack-evidence-rw")).toBeTruthy()
    expect(
      screen
        .getByRole("link", {
          name: "Rwanda Revenue Authority: Value Added Tax (VAT), 2025",
        })
        .getAttribute("href"),
    ).toBe("https://www.rra.gov.rw/vat.pdf")
    fireEvent.click(screen.getByRole("switch"))
    expect(onEnabledChange).not.toHaveBeenCalled()
  })
})
