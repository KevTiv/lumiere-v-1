import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import { documentsEntityConfigs } from "./documents-entity-configs"
import { hrEntityConfigs, leaveAllocationsTableConfig } from "./hr-entity-configs"
import { buildEntityTableCsv, exportableColumns } from "./entity-table-export"
import { entityTableConfigFromView } from "./entity-view-types"

const t = ((key: string) => key) as TFunction

describe("sensitive list export policies", () => {
  it.each([
    "leave-requests-table", "contracts-table", "payslips-table", "attendance-table",
    "performance-reviews-table", "benefit-enrollments-table",
  ])("disables generic CSV for %s", (id) => {
    expect(entityTableConfigFromView(hrEntityConfigs(t)[id]!.view).allowExport).toBe(false)
  })

  it("also protects dynamically configured individual leave balances", () => {
    expect(entityTableConfigFromView(leaveAllocationsTableConfig(t).view).allowExport).toBe(false)
  })

  it.each([
    "documents-table", "knowledge-articles-table", "document-ai-insights-table",
    "documents-recycle-bin-table",
  ])("disables generic CSV for content-bearing %s", (id) => {
    expect(entityTableConfigFromView(documentsEntityConfigs(t)[id]!.view).allowExport).toBe(false)
  })

  it("keeps employee operational columns exportable without personal identifiers or contact data", () => {
    const table = entityTableConfigFromView(hrEntityConfigs(t)["employees-table"]!.view)
    expect(table.allowExport).toBe(true)
    const csv = buildEntityTableCsv(table.columns, [{
      employeeNumber: "EMP-SECRET", name: "Private Person", workEmail: "private@example.test",
      jobTitle: "Engineer", departmentId: 4, employmentType: "FullTime", isActive: true,
      statutoryId: "RAW-STATUTORY-ID", bankAccount: "RAW-BANK-ACCOUNT",
    }])
    expect(csv).toContain("Engineer")
    for (const value of ["EMP-SECRET", "Private Person", "private@example.test", "RAW-STATUTORY-ID", "RAW-BANK-ACCOUNT"]) {
      expect(csv).not.toContain(value)
    }
  })

  it("keeps folder structure metadata exportable without names or paths", () => {
    const table = entityTableConfigFromView(documentsEntityConfigs(t)["document-folders-table"]!.view)
    expect(table.allowExport).toBe(true)
    expect(exportableColumns(table.columns).map(({ key }) => key)).toEqual([
      "documentCount", "isFavorite", "isHidden", "createDate",
    ])
    const csv = buildEntityTableCsv(table.columns, [{ name: "Patient records", parentPath: "/private", documentCount: 3 }])
    expect(csv).not.toContain("Patient records")
    expect(csv).not.toContain("/private")
    expect(csv).toContain("3")
  })

  it("excludes salary values even when contract/payroll columns are reused", () => {
    const configs = hrEntityConfigs(t)
    for (const id of ["contracts-table", "payslips-table"]) {
      const table = entityTableConfigFromView(configs[id]!.view)
      const csv = buildEntityTableCsv(table.columns, [{ name: "Period", wage: 93841, basicWage: 83742, grossWage: 73643, netWage: 63544 }])
      for (const value of ["93841", "83742", "73643", "63544"]) expect(csv).not.toContain(value)
    }
  })

  it("keeps goals metadata exportable without employee identifiers or free-text goals", () => {
    const table = entityTableConfigFromView(hrEntityConfigs(t)["performance-goals-table"]!.view)
    expect(table.allowExport).toBe(true)
    expect(exportableColumns(table.columns).map(({ key }) => key)).toEqual(["cycleId", "state", "weight"])
  })

  it.each([
    "departments-table", "job-positions-table", "leave-types-table",
    "payroll-structures-table", "salary-rules-table", "onboarding-templates-table",
    "performance-cycles-table", "benefit-plans-table",
  ])("keeps reference list %s exportable", (id) => {
    const table = entityTableConfigFromView(hrEntityConfigs(t)[id]!.view)
    expect(table.allowExport).toBe(true)
    expect(exportableColumns(table.columns).length).toBeGreaterThan(0)
  })

  it.each([
    "knowledge-categories-table", "document-processing-jobs-table",
    "document-templates-table", "mail-templates-table",
  ])("keeps document setup/status list %s exportable", (id) => {
    const table = entityTableConfigFromView(documentsEntityConfigs(t)[id]!.view)
    expect(table.allowExport).toBe(true)
    expect(exportableColumns(table.columns).length).toBeGreaterThan(0)
  })

  it("keeps every other HR and document list closed to generic CSV by default", () => {
    const reviewed = new Set([
      "employees-table", "performance-goals-table", "departments-table", "job-positions-table",
      "leave-types-table", "payroll-structures-table", "salary-rules-table", "onboarding-templates-table",
      "performance-cycles-table", "benefit-plans-table", "document-folders-table", "knowledge-categories-table",
      "document-processing-jobs-table", "document-templates-table", "mail-templates-table",
    ])
    const configs = { ...hrEntityConfigs(t), ...documentsEntityConfigs(t) }
    for (const [id, config] of Object.entries(configs)) {
      if (config.view.mode !== "table" && config.view.mode !== "table-or-board") continue
      const allowExport = entityTableConfigFromView(config.view).allowExport
      expect({ id, allowExport: allowExport === true }).toEqual({ id, allowExport: reviewed.has(id) })
    }
  })
})
