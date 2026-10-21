import { describe, expect, it } from "vitest"

import type {
  CompanyCountryPackRow,
  CountryPackDefinitionRow,
} from "@lumiere/query-hooks/hooks/organization-company"

import {
  countryPackComplianceEvidence,
  countryPackReadiness,
  countryPackTimestamp,
} from "./country-pack-readiness"

function definition(
  overrides: Partial<CountryPackDefinitionRow> = {},
): CountryPackDefinitionRow {
  return {
    packKey: "rw",
    countryCode: "RW",
    name: "Rwanda",
    region: "east_africa",
    version: "0.1.0",
    acceptanceStatus: "review_required",
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    metadata: null,
    ...overrides,
  }
}

function activation(
  overrides: Partial<CompanyCountryPackRow> = {},
): CompanyCountryPackRow {
  return {
    id: 1,
    companyId: 2,
    packKey: "rw",
    pinnedPackVersion: "0.1.0",
    enabled: false,
    ...overrides,
  }
}

describe("countryPackReadiness", () => {
  it("blocks a Rwanda pack while its rules require review", () => {
    const [row] = countryPackReadiness(
      [definition()],
      [],
      new Date("2026-10-15T00:00:00Z"),
    )

    expect(row).toMatchObject({
      packKey: "rw",
      acceptanceStatus: "review_required",
      canActivate: false,
      activationBlock: "review_required",
      enabled: false,
    })
  })

  it("allows an accepted pack only inside its effective window", () => {
    const accepted = definition({
      acceptanceStatus: "accepted",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2027-01-01T00:00:00Z",
    })

    expect(
      countryPackReadiness([accepted], [], new Date("2026-06-01T00:00:00Z"))[0]
        ?.canActivate,
    ).toBe(true)
    expect(
      countryPackReadiness([accepted], [], new Date("2027-01-01T00:00:00Z"))[0]
        ?.activationBlock,
    ).toBe("expired")
  })

  it("fails closed when a company pin differs from the catalog version", () => {
    const [row] = countryPackReadiness(
      [definition({ acceptanceStatus: "accepted", version: "2.0.0" })],
      [activation({ pinnedPackVersion: "1.0.0" })],
    )

    expect(row).toMatchObject({
      pinnedPackVersion: "1.0.0",
      pinMatchesCatalog: false,
      canActivate: false,
      activationBlock: "version_mismatch",
    })
  })

  it("surfaces official evidence and unresolved review items from pack metadata", () => {
    const [row] = countryPackReadiness(
      [
        definition({
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
        }),
      ],
      [],
    )

    expect(row?.complianceEvidence).toEqual({
      officialSources: [
        {
          authority: "Rwanda Revenue Authority",
          title: "Value Added Tax (VAT), 2025",
          url: "https://www.rra.gov.rw/vat.pdf",
          accessedOn: "2026-10-15",
        },
      ],
      confirmationRequired: ["ebm_vsdc_certification_and_invoice_schema"],
      lastReviewedOn: "2026-10-15",
    })
  })
})

describe("countryPackComplianceEvidence", () => {
  it("ignores malformed metadata and unsafe source URLs", () => {
    expect(countryPackComplianceEvidence("not json")).toEqual({
      officialSources: [],
      confirmationRequired: [],
      lastReviewedOn: null,
    })
    expect(
      countryPackComplianceEvidence(
        JSON.stringify({
          official_sources: [
            {
              authority: "Unknown",
              title: "Unsafe",
              url: "javascript:alert(1)",
              accessed_on: "2026-10-15",
            },
          ],
        }),
      ).officialSources,
    ).toEqual([])
  })
})

describe("countryPackTimestamp", () => {
  it("parses SpacetimeDB option-wrapped microseconds", () => {
    expect(
      countryPackTimestamp({
        some: { __timestamp_micros_since_unix_epoch__: 1_767_225_600_000_000 },
      })?.toISOString(),
    ).toBe("2026-01-01T00:00:00.000Z")
    expect(countryPackTimestamp({ none: [] })).toBeNull()
  })
})
