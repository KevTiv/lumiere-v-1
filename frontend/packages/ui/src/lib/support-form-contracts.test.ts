import { describe, expect, it } from "vitest"
import type { TFunction } from "i18next"
import { newDocumentForm } from "./documents-form-configs"
import { newMailMessageForm } from "./messages-form-configs"
import { newCalendarEventForm } from "./calendar-form-configs"
import { addOrgMemberForm, addUserToOrganizationForm } from "./settings-platform-form-configs"
const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction

describe("Support form payload contracts", () => {
  it("keeps upload requirements and every linked record wire value while filing stays optional", () => {
    const config = newDocumentForm(t)
    const fields = config.sections.flatMap((section) => section.fields)
    expect(fields.filter((field) => field.required).map((field) => field.name)).toEqual(["name", "file"])
    const model = fields.find((field) => field.name === "resModel")
    expect(model?.type).toBe("select")
    if (model?.type !== "select") throw new Error("Record type picker is missing")
    expect(model.options.map((option) => option.value)).toEqual(["", "sale_order", "purchase_order", "account_move", "hr_expense", "contact"])
    expect(config.sections.find((section) => section.id === "doc-filing")?.fields.some((field) => field.required)).toBe(false)
    expect(new Set(fields.map((field) => field.name)).size).toBe(fields.length)
  })
  it("keeps message type values and requires the record number used by the existing command", () => {
    const fields = newMailMessageForm(t).sections.flatMap((section) => section.fields)
    expect(fields[0]?.name).toBe("body")
    expect(fields.find((field) => field.name === "resId")?.required).toBe(true)
    const type = fields.find((field) => field.name === "messageType")
    if (type?.type !== "select") throw new Error("Message type picker is missing")
    expect(type.options.map((option) => option.value)).toEqual(["comment", "email", "notification"])
    expect(type.defaultValue).toBeUndefined()
  })
  it("uses the existing searchable record picker by default and keeps an explicit exact custom reference path", () => {
    const options = [{ value: "account_move:9007199254740993", label: "Invoice · INV-001 · Acme" }]
    const fields = newMailMessageForm(t, options).sections.flatMap((section) => section.fields)
    const mode = fields.find((field) => field.name === "recordLinkMode")
    const record = fields.find((field) => field.name === "recordReference")
    expect(mode?.defaultValue).toBe("record")
    if (record?.type !== "select") throw new Error("Named record picker is missing")
    expect(record.searchable).toBe(true)
    expect(record.options).toEqual(options)
    expect(record.visibleWhen).toEqual({ field: "recordLinkMode", equals: "record" })
    const customId = fields.find((field) => field.name === "resId")
    expect(customId?.type).toBe("text")
    expect(customId?.inputMode).toBe("numeric")
    expect(customId?.visibleWhen).toEqual({ field: "recordLinkMode", equals: "custom" })
    expect(fields.find((field) => field.name === "model")?.visibleWhen).toEqual({ field: "recordLinkMode", equals: "custom" })
    expect(fields.find((field) => field.name === "parentId")?.type).toBe("select")
  })
  it("keeps calendar privacy defaults and the exact supplied edit values", () => {
    const defaults = { name: "Review", start: "2026-10-06T10:00", stop: "2026-10-06T10:00", allday: true, privacy: "confidential" }
    const created = newCalendarEventForm(t).sections.flatMap((section) => section.fields)
    const edited = newCalendarEventForm(t, defaults).sections.flatMap((section) => section.fields)
    expect(created.find((field) => field.name === "privacy")?.defaultValue).toBe("public")
    for (const [name, expected] of Object.entries(defaults)) expect(edited.find((field) => field.name === name)?.defaultValue).toBe(expected)
  })
  it("labels job titles without changing membership payload names or role values", () => {
    const options = [{ value: "role-17", label: "Finance reviewer" }]
    for (const config of [addOrgMemberForm(t, options), addUserToOrganizationForm(t, options)]) {
      const fields = config.sections.flatMap((section) => section.fields)
      expect(fields.find((field) => field.name === "jobTitle")?.label).toBe("Job title")
      expect(fields.find((field) => field.name === "isActive")?.defaultValue).toBe(true)
      const role = fields.find((field) => field.name === "roleName" || field.name === "roleId")
      if (role?.type !== "select") throw new Error("Membership role picker is missing")
      expect(role.options).toEqual(options)
    }
  })
})
