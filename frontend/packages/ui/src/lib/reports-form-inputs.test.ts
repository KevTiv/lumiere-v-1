import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"
import { toCreateReportTemplateParams } from "@lumiere/erp-shared/reports-template-params"
import type { FormConfig, FormValues } from "./form-types"
import { newFinancialReportForm, newReportTemplateForm, newScheduledReportForm, recordScheduledRunForm } from "./reports-form-configs"

const i18n = createInstance()
void i18n.init({ lng: "en", resources: { en: { translation: {} } }, initImmediate: false })

const fields = (config: FormConfig) => config.sections.flatMap((section) => section.fields)
const initialValues = (config: FormConfig): FormValues => Object.fromEntries(fields(config).map((field) => [field.name, field.defaultValue]))

describe("Finance report form inputs", () => {
  it.each([newReportTemplateForm, newScheduledReportForm])("offers the accounting source and retains an explicit custom source path", (builder) => {
    const config = builder(i18n.t)
    const source = fields(config).find((field) => field.name === "reportSource")!
    const model = fields(config).find((field) => field.name === "model")!
    expect(source.type).toBe("select")
    expect(source.defaultValue).toBe("account.move")
    expect("options" in source && source.options).toEqual([
      { value: "account.move", label: "Accounting documents (invoices, bills and journal entries)" },
      { value: "__custom__", label: "Custom source (advanced)" },
    ])
    expect(model.type).toBe("text")
    expect(model.defaultValue).toBe("account.move")
    expect(model.required).toBe(true)
    expect(model.visibleWhen).toEqual({ field: "reportSource", equals: "__custom__" })
    expect(fields(config).filter((field) => field.name === "model")).toHaveLength(1)
  })

  it("keeps numeric millimetre margins unchanged at the existing template parameter boundary", () => {
    const config = newReportTemplateForm(i18n.t)
    for (const name of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
      const field = fields(config).find((candidate) => candidate.name === name)!
      expect(field.type).toBe("number")
      expect(field.label).toMatch(/\(mm\)$/)
      expect(field.validation?.min).toBe(0)
      expect("step" in field && field.step).toBe(0.5)
    }
    const params = toCreateReportTemplateParams({ ...initialValues(config), name: "Finance template" })!
    expect(params.model).toBe("account.move")
    expect([params.marginTop, params.marginBottom, params.marginLeft, params.marginRight]).toEqual([10, 10, 7, 7])
    const fractional = toCreateReportTemplateParams({ ...initialValues(config), name: "Finance template", marginTop: 12.5, marginRight: 0 })!
    expect(fractional.marginTop).toBe(12.5)
    expect(fractional.marginRight).toBe(0)
  })

  it("only offers frequencies accepted by the owning scheduled-report reducer", () => {
    const config = newScheduledReportForm(i18n.t)
    const frequency = fields(config).find((field) => field.name === "frequency")!
    expect("options" in frequency && frequency.options.map((option) => option.value)).toEqual(["Daily", "Weekly", "Monthly"])
    expect(frequency.defaultValue).toBe("Weekly")
    expect(fields(config).find((field) => field.name === "nextRun")?.type).toBe("datetime")
  })

  it("names create actions and keeps optional company selectors available for runtime options", () => {
    const template = newReportTemplateForm(i18n.t)
    const schedule = newScheduledReportForm(i18n.t)
    expect(template.submitLabel).toBe("Create template")
    expect(schedule.submitLabel).toBe("Save schedule")
    for (const config of [template, schedule]) {
      const company = fields(config).find((field) => field.name === "companyId")!
      expect(company.type).toBe("select")
      expect(company.label).toBe("Company (optional)")
      expect(company.required).not.toBe(true)
      expect("options" in company && company.options).toEqual([])
    }
  })
})


describe("Report task sections", () => {
  it("starts with report type and dates, keeps comparison and display separate, and retains defaults", () => {
    const form = newFinancialReportForm(i18n.t)
    expect(form.sections[0]?.fields.map((field) => field.name)).toEqual(["reportType", "dateFrom", "dateTo", "name"])
    expect(form.sections.find((section) => section.id === "report-comparison")?.fields.map((field) => field.name)).toEqual(["comparisonMode"])
    expect(fields(form).find((field) => field.name === "reportType")?.defaultValue).toBe("trialBalance")
    expect(fields(form).find((field) => field.name === "comparisonMode")?.defaultValue).toBe("none")
    expect(fields(form).find((field) => field.name === "targetMove")?.defaultValue).toBeUndefined()
    expect(fields(form).filter((field) => field.required).map((field) => field.name).sort()).toEqual(["currencyId", "dateFrom", "dateTo", "name", "reportType"])
    expect(form.submitLabel).toBe("Generate report")
  })

  it("keeps schedule delivery explicit and distinguishes recording a completed run", () => {
    const schedule = newScheduledReportForm(i18n.t)
    expect(schedule.sections.at(-1)?.fields.map((field) => field.name)).toEqual(["recipients", "attachmentFormat"])
    expect(fields(schedule).find((field) => field.name === "recipients")?.description).toContain("commas or new lines")
    expect(fields(schedule).filter((field) => field.required).map((field) => field.name).sort()).toEqual(["model", "name", "nextRun", "recipients", "reportSource", "reportTemplateId"])
    expect(recordScheduledRunForm(i18n.t).submitLabel).toBe("Record completed run")
  })
})
