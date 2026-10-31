export type TaxRegistration = "unknown" | "registered" | "not-registered"
export type HistoricalDataMode =
  | "undecided"
  | "opening-balances"
  | "full-history"
export type CompanySetupStage =
  | "editing"
  | "review"
  | "submitting"
  | "saved"
  | "uncertain"

export interface CompanySetupCompany {
  id: string
  name: string
  code: string
  countryCode: string
  currencyId: string
  taxId: string
  fiscalYearEndMonth: number
  fiscalYearEndDay: number
  metadata?: string
}

export interface CompanySetupDraft {
  version: 1
  submissionId: string
  companyId: string | null
  name: string
  code: string
  countryCode: string
  currencyId: string
  unitIds: string[]
  taxRegistration: TaxRegistration
  taxId: string
  historicalMode: HistoricalDataMode
  fiscalYearEndMonth: string
  fiscalYearEndDay: string
  stage: CompanySetupStage
  savedCompanyId: string | null
}

export interface SetupOption {
  value: string
  label: string
}

/** This error is reserved for checks completed before any mutation was sent. */
export class CompanySetupAdmissionError extends Error {}

export function newCompanySetupDraft(
  submissionId: string,
  company?: CompanySetupCompany,
): CompanySetupDraft {
  const draft: CompanySetupDraft = {
    version: 1,
    submissionId,
    companyId: company?.id ?? null,
    name: company?.name ?? "",
    code: company?.code ?? "",
    countryCode: company?.countryCode ?? "",
    currencyId: company?.currencyId ?? "",
    unitIds: [],
    taxRegistration: "unknown",
    taxId: company?.taxId ?? "",
    historicalMode: "undecided",
    fiscalYearEndMonth: String(company?.fiscalYearEndMonth ?? 12),
    fiscalYearEndDay: String(company?.fiscalYearEndDay ?? 31),
    stage: "editing",
    savedCompanyId: null,
  }
  if (!company?.metadata) return draft
  try {
    const metadata: unknown = JSON.parse(company.metadata)
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("companySetup" in metadata)
    )
      return draft
    const setup = metadata.companySetup
    if (
      !setup ||
      typeof setup !== "object" ||
      !("version" in setup) ||
      setup.version !== 1 ||
      !("unitIds" in setup) ||
      !("taxRegistration" in setup) ||
      !("historicalMode" in setup)
    )
      return draft
    return (
      decodeCompanySetupDraft(
        JSON.stringify({
          ...draft,
          unitIds: setup.unitIds,
          taxRegistration: setup.taxRegistration,
          historicalMode: setup.historicalMode,
        }),
        company.id,
      ) ?? draft
    )
  } catch {
    return draft
  }
}

export function companySetupStorageKey(
  identity: string,
  organizationId: number,
  companyId: string | null,
): string {
  return `lumiere:company-setup:v1:${encodeURIComponent(identity)}:${organizationId}:${companyId ?? "new"}`
}

/** Restoring a browser plan never changes the company scope or treats a lost reply as failure. */
export function decodeCompanySetupDraft(
  raw: string | null,
  companyId: string | null,
): CompanySetupDraft | null {
  if (!raw || raw.length > 30_000) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    if (
      !("version" in value) ||
      value.version !== 1 ||
      !("companyId" in value) ||
      value.companyId !== companyId
    )
      return null
    if (
      !("submissionId" in value) ||
      typeof value.submissionId !== "string" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(value.submissionId)
    )
      return null
    const fields = [
      "name",
      "code",
      "countryCode",
      "currencyId",
      "taxId",
      "fiscalYearEndMonth",
      "fiscalYearEndDay",
    ] as const
    for (const field of fields) {
      if (!Object.hasOwn(value, field)) return null
      const text: unknown = Reflect.get(value, field)
      if (typeof text !== "string" || text.length > 250) return null
    }
    if (
      !("unitIds" in value) ||
      !Array.isArray(value.unitIds) ||
      value.unitIds.length > 100 ||
      !value.unitIds.every(
        (id) => typeof id === "string" && /^[1-9]\d*$/.test(id),
      )
    )
      return null
    if (
      !("taxRegistration" in value) ||
      typeof value.taxRegistration !== "string" ||
      !["unknown", "registered", "not-registered"].includes(
        value.taxRegistration,
      )
    )
      return null
    if (
      !("historicalMode" in value) ||
      typeof value.historicalMode !== "string" ||
      !["undecided", "opening-balances", "full-history"].includes(
        value.historicalMode,
      )
    )
      return null
    if (
      !("stage" in value) ||
      typeof value.stage !== "string" ||
      !["editing", "review", "submitting", "saved", "uncertain"].includes(
        value.stage,
      )
    )
      return null
    if (
      !("savedCompanyId" in value) ||
      (value.savedCompanyId !== null &&
        (typeof value.savedCompanyId !== "string" ||
          !/^[1-9]\d*$/.test(value.savedCompanyId)))
    )
      return null
    if (value.stage === "saved" && value.savedCompanyId === null) return null
    if (
      companyId !== null &&
      value.savedCompanyId !== null &&
      value.savedCompanyId !== companyId
    )
      return null
    const draft = value as CompanySetupDraft
    return {
      ...draft,
      stage: draft.stage === "submitting" ? "uncertain" : draft.stage,
    }
  } catch {
    return null
  }
}

export function companySetupValidation(
  draft: CompanySetupDraft,
  currencies: readonly SetupOption[],
  units: readonly SetupOption[],
): string | null {
  if (!draft.name.trim() || !draft.code.trim())
    return "Company name and code are required."
  if (!/^[A-Z]{2}$/.test(draft.countryCode))
    return "Choose a country or enter its two-letter country code."
  if (
    !/^[1-9]\d*$/.test(draft.currencyId) ||
    !currencies.some((option) => option.value === draft.currencyId)
  )
    return "Choose an available base currency."
  if (draft.unitIds.some((id) => !units.some((option) => option.value === id)))
    return "A selected unit is no longer available. Review the units before continuing."
  if (draft.taxRegistration === "registered" && !draft.taxId.trim())
    return "Enter the VAT registration number, or keep VAT registration unknown."
  const month = Number(draft.fiscalYearEndMonth)
  const day = Number(draft.fiscalYearEndDay)
  const end = new Date(Date.UTC(2001, month - 1, day))
  if (
    !/^\d{1,2}$/.test(draft.fiscalYearEndMonth) ||
    !/^\d{1,2}$/.test(draft.fiscalYearEndDay) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    end.getUTCMonth() !== month - 1 ||
    end.getUTCDate() !== day
  )
    return "Choose a valid recurring fiscal year-end."
  return null
}

export function companySetupMetadata(draft: CompanySetupDraft): string {
  return JSON.stringify({
    companySetup: {
      version: 1,
      submissionId: draft.submissionId,
      unitIds: draft.unitIds,
      taxRegistration: draft.taxRegistration,
      historicalMode: draft.historicalMode,
    },
  })
}

/** A new-company response is recovered using its submission identity, never a list difference. */
export function findSubmittedCompany(
  companies: readonly CompanySetupCompany[],
  submissionId: string,
): CompanySetupCompany | undefined {
  const matches = companies.filter((company) => {
    try {
      const value: unknown = JSON.parse(company.metadata ?? "null")
      if (!value || typeof value !== "object" || !("companySetup" in value))
        return false
      const setup = value.companySetup
      return (
        !!setup &&
        typeof setup === "object" &&
        "submissionId" in setup &&
        setup.submissionId === submissionId
      )
    } catch {
      return false
    }
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function companySetupLinks(companyId: string | null) {
  const scope = companyId ? `&companyId=${encodeURIComponent(companyId)}` : ""
  return [
    {
      title: "Accounts",
      detail:
        "Create receivable, payable, income and expense accounts with their purpose set in the creation form.",
      href: `/accounting?tab=accounts${scope}`,
    },
    {
      title: "Journals",
      detail: "Review sales and purchase journals and their linked accounts.",
      href: `/accounting?tab=account-journals${scope}`,
    },
    {
      title: "Taxes",
      detail:
        "Review tax applicability and rates. This setup does not infer rates from country or registration.",
      href: `/accounting?tab=taxes${scope}`,
    },
    {
      title: "Fiscal years and periods",
      detail:
        "Prepare the periods covering your source dates before importing accounting history.",
      href: `/accounting?tab=fiscal-years${scope}`,
    },
    {
      title: "Units and products",
      detail:
        "Review units per product. Choosing a unit here does not convert quantities or prices.",
      href: `/inventory?tab=products${scope}`,
    },
    {
      title: "Import source files",
      detail:
        "Review unresolved values before creating drafts. Only posted activity appears in operational totals.",
      href: "/settings?section=imports",
    },
  ]
}
