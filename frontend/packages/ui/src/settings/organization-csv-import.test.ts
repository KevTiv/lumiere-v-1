import { expect, test } from "vitest"
import {
  organizationCsvImportTable,
  trackedImportCompanyId,
  type OrgMasterCsvKind,
} from "./organization-csv-import"

test("maps every organization CSV dialog to its server-owned entity", () => {
  const expected: Record<OrgMasterCsvKind, string> = {
    country: "country",
    currency: "currency",
    currencyRate: "currency_rate",
    company: "company",
    role: "role",
    aiAgent: "ai_agent",
  }

  for (const [kind, table] of Object.entries(expected)) {
    expect(organizationCsvImportTable(kind as OrgMasterCsvKind)).toBe(table)
  }
})
test("fails closed until the active operating company is ready", () => {
  expect(trackedImportCompanyId(42, true)).toBe(42)
  expect(trackedImportCompanyId(42, false)).toBe(0)
  expect(trackedImportCompanyId(null, true)).toBe(0)
  expect(trackedImportCompanyId(0, true)).toBe(0)
})
