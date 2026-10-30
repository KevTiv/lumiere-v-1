import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"
import { newContactForm, newLeadForm, newOpportunityForm } from "./crm-form-configs"
import { newSubscriptionForm, newSubscriptionPlanForm } from "./subscriptions-form-configs"
import type { FormConfig } from "./form-types"

const i18n = createInstance()
void i18n.init({ lng: "en", resources: { en: { translation: {} } }, initImmediate: false })
const fields = (config: FormConfig) => config.sections.flatMap((section) => section.fields)

describe("CRM task forms", () => {
  it("declares the custom-create limit before entry on every base CRM create form", () => {
    for (const form of [newLeadForm(i18n.t), newOpportunityForm(i18n.t), newContactForm(i18n.t)]) {
      expect(form.customFieldCreateUnavailableMessage).toContain("Creation is disabled before any record is created")
      expect(form.customFieldCreateUnavailableMessage).toContain("administrator")
    }
  })
  it("starts enquiries as new and keeps contact constraints while separating optional notes", () => {
    const form = newLeadForm(i18n.t)
    expect(form.sections[0]?.fields.map((field) => field.name)).toEqual(["contactName", "partnerName", "emailFrom", "phone"])
    expect(fields(form).find((field) => field.name === "contactName")?.required).toBe(true)
    expect(fields(form).find((field) => field.name === "state")?.defaultValue).toBe("new")
    expect(form.sections.at(-1)?.collapsible).toBe(true)
    expect(form.sections.at(-1)?.fields.map((field) => field.name)).toEqual(["description"])
  })

  it("keeps one required stage and its exact IDs, and explains absent setup", () => {
    const options = [{ value: "9007199254740993", label: "Qualified" }]
    const form = newOpportunityForm(i18n.t, options)
    const stage = fields(form).find((field) => field.name === "stageId")!
    expect(stage.required).toBe(true)
    expect("options" in stage && stage.options).toEqual(options)
    expect(fields(form).filter((field) => field.name === "stageId")).toHaveLength(1)
    expect(form.sections[0]?.fields.map((field) => field.name)).toEqual(["name", "stageId"])
    const absent = fields(newOpportunityForm(i18n.t)).find((field) => field.name === "stageId")!
    expect(absent.label).toBe("crm.forms.newOpportunity.fields.stage")
    expect(absent.description).toContain("Pipeline setup")
    expect("options" in absent && absent.options[0]?.disabled).toBe(true)
  })

  it("keeps contact identity before communication and address without changing required fields", () => {
    const form = newContactForm(i18n.t)
    expect(form.sections.map((section) => section.fields.map((field) => field.name))).toEqual([
      ["name", "isCompany"], ["email", "phone"], ["city", "zip"], ["description", "color"],
    ])
    expect(fields(form).filter((field) => field.required).map((field) => field.name)).toEqual(["name"])
  })
})

describe("Subscription task forms", () => {
  it("keeps required order/plan/start inputs and makes server-owned creation fields read-only", () => {
    const form = newSubscriptionForm(i18n.t)
    expect(form.sections[0]?.fields.map((field) => field.name)).toEqual(["saleOrderId", "planId"])
    expect(fields(form).filter((field) => field.required).map((field) => field.name)).toEqual(["saleOrderId", "planId", "dateStart"])
    for (const [name, value, label] of [["state", "draft", "Draft"], ["health", "healthy", "Healthy"]]) {
      const field = fields(form).find((candidate) => candidate.name === name)!
      expect(field.disabled).toBe(true)
      expect(field.defaultValue).toBe(value)
      expect("options" in field && field.options).toEqual([{ value, label }])
    }
    expect(form.submitLabel).toBe("Create draft subscription")
    expect(form.sections.at(-1)?.description).toContain("drafts with healthy status")
  })

  it("puts a plan name before configuration while retaining required pricing and accounting inputs", () => {
    const form = newSubscriptionPlanForm(i18n.t)
    expect(form.sections[0]?.fields.map((field) => field.name)).toEqual(["name", "code"])
    expect(fields(form).filter((field) => field.required).map((field) => field.name).sort()).toEqual(["journalId", "name", "pricelistId", "productId"])
    expect(fields(form).find((field) => field.name === "pricelistId")?.description).toContain("plan currency")
    expect(fields(form).find((field) => field.name === "trialDuration")?.description).toContain("days")
    expect(new Set(fields(form).map((field) => field.id)).size).toBe(fields(form).length)
  })
})
