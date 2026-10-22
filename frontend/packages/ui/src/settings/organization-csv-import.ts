export type OrgMasterCsvKind =
  | "country"
  | "currency"
  | "currencyRate"
  | "company"
  | "role"
  | "aiAgent"

const TABLE_BY_KIND: Record<OrgMasterCsvKind, string> = {
  country: "country",
  currency: "currency",
  currencyRate: "currency_rate",
  company: "company",
  role: "role",
  aiAgent: "ai_agent",
}
export function organizationCsvImportTable(kind: OrgMasterCsvKind): string {
  return TABLE_BY_KIND[kind]
}

export function trackedImportCompanyId(
  activeCompanyId: number | null | undefined,
  activeCompanyReady: boolean | undefined,
): number {
  return activeCompanyReady && activeCompanyId != null && activeCompanyId > 0
    ? activeCompanyId
    : 0
}
