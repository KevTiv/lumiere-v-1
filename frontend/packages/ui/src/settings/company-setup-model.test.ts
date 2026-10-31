import { describe, expect, it } from "vitest"
import {
  companySetupMetadata,
  companySetupStorageKey,
  companySetupValidation,
  decodeCompanySetupDraft,
  findSubmittedCompany,
  newCompanySetupDraft,
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
const draft = newCompanySetupDraft("test-submission-0001", company)
const currencies = [{ value: "4", label: "RWF" }]

describe("company setup persistence and admission", () => {
  it("allows uncertainty without inferring taxes or units", () => {
    expect(companySetupValidation(draft, currencies, [])).toBeNull()
    expect(draft).toMatchObject({
      taxRegistration: "unknown",
      historicalMode: "undecided",
      unitIds: [],
    })
    expect(
      companySetupValidation(
        { ...draft, taxRegistration: "registered" },
        currencies,
        [],
      ),
    ).toContain("registration number")
  })
  it("rejects unavailable currency and unit choices and invalid fiscal dates", () => {
    expect(companySetupValidation(draft, [], [])).toContain("base currency")
    expect(
      companySetupValidation({ ...draft, unitIds: ["8"] }, currencies, []),
    ).toContain("unit")
    expect(
      companySetupValidation(
        { ...draft, fiscalYearEndMonth: "2", fiscalYearEndDay: "30" },
        currencies,
        [],
      ),
    ).toContain("fiscal")
  })
  it("restores only the expected company and treats an interrupted submission as uncertain", () => {
    const raw = JSON.stringify({ ...draft, stage: "submitting" })
    expect(decodeCompanySetupDraft(raw, "7")?.stage).toBe("uncertain")
    expect(decodeCompanySetupDraft(raw, "8")).toBeNull()
    expect(
      decodeCompanySetupDraft(
        JSON.stringify({ ...draft, unitIds: [false] }),
        "7",
      ),
    ).toBeNull()
    expect(
      decodeCompanySetupDraft(
        JSON.stringify({ ...draft, stage: ["editing"] }),
        "7",
      ),
    ).toBeNull()
    expect(
      decodeCompanySetupDraft(
        JSON.stringify({ ...draft, savedCompanyId: "8" }),
        "7",
      ),
    ).toBeNull()
    expect(decodeCompanySetupDraft("{}", "7")).toBeNull()
    expect(companySetupStorageKey("actor-a", 1, "7")).not.toBe(
      companySetupStorageKey("actor-b", 1, "7"),
    )
    expect(companySetupStorageKey("actor-a", 1, "7")).not.toBe(
      companySetupStorageKey("actor-a", 2, "7"),
    )
  })
  it("recovers the exact submission instead of guessing the latest new company", () => {
    const unrelated = { ...company, id: "9", metadata: "{}" }
    const saved = { ...company, metadata: companySetupMetadata(draft) }
    expect(
      findSubmittedCompany([unrelated, saved], draft.submissionId)?.id,
    ).toBe("7")
    expect(
      findSubmittedCompany([unrelated, saved], "another-submission-id"),
    ).toBeUndefined()
    expect(
      findSubmittedCompany([saved, { ...saved, id: "10" }], draft.submissionId),
    ).toBeUndefined()
  })
  it("prefills saved setup preferences when reopening the created company", () => {
    const metadata = companySetupMetadata({
      ...draft,
      unitIds: ["8"],
      taxRegistration: "registered",
      historicalMode: "full-history",
    })
    const reopened = newCompanySetupDraft("reopened-submission-0002", {
      ...company,
      metadata,
    })
    expect(reopened).toMatchObject({
      companyId: "7",
      unitIds: ["8"],
      taxRegistration: "registered",
      historicalMode: "full-history",
      stage: "editing",
    })
    expect(reopened.submissionId).toBe("reopened-submission-0002")
    expect(
      newCompanySetupDraft("reopened-submission-0002", {
        ...company,
        metadata: "malformed",
      }).unitIds,
    ).toEqual([])
  })
})
