import { describe, expect, it } from "vitest"
import { toCreateAccountReconciliationWidgetParams, toUpdateAccountReconciliationWidgetParams } from "@lumiere/erp-shared/accounting-create-params"
import { editReconciliationWidgetForm, newReconciliationWidgetForm } from "./accounting-form-configs"
import { reconciliationAccountChoices, reconciliationMoveLineChoices, reconciliationPartnerChoices, reconciliationSelectionIssue } from "./reconciliation-widget-choices"
import type { TFunction } from "i18next"

const scope = { organizationId: "1", companyId: "10" }
const accounts = [
  { id: 20n, organizationId: 1n, companyId: 10n, code: "1200", name: "Receivables" },
  { id: 21n, organizationId: 1n, companyId: 10n, code: "1300", name: "Other account" },
]
const partners = [{ id: 30n, organizationId: 1n, companyId: 10n, name: "Customer" }]
const lines = [
  { id: 40n, organizationId: 1n, companyId: 10n, accountId: 20n, partnerId: 30n, name: "Invoice A" },
  { id: 41n, organizationId: 1n, companyId: 10n, accountId: 20n, partnerId: 31n, name: "Invoice B" },
  { id: 42n, organizationId: 1n, companyId: 10n, accountId: 21n, partnerId: 30n, name: "Other account item" },
  { id: 43n, organizationId: 1n, companyId: 11n, accountId: 20n, partnerId: 30n, name: "Other company" },
  { id: 44n, organizationId: 2n, companyId: 10n, accountId: 20n, partnerId: 30n, name: "Other organization" },
]
const context = { ...scope, ready: true, accounts, partners, lines }
const selection = { accountId: "20", partnerId: "30", moveLineIds: ["40"], mode: "bank" }

describe("reconciliation record choices", () => {
  it("offers only unique active current-company accounts", () => {
    const choices = reconciliationAccountChoices([
      ...accounts,
      { ...accounts[0], id: 22n, companyId: 11n },
      { ...accounts[0], id: 23n, organizationId: 2n },
      { ...accounts[0], id: 24n, deprecated: true },
      { ...accounts[0], id: 25n }, { ...accounts[0], id: 25n },
    ], scope)
    expect(choices.map((option) => option.value)).toEqual(["20", "21"])
    expect(choices[0].label).toBe("1200 — Receivables")
  })

  it("offers active organization-wide and current-company partners only", () => {
    const choices = reconciliationPartnerChoices([
      ...partners,
      { ...partners[0], id: 31n, companyId: null },
      { ...partners[0], id: 32n, companyId: 11n },
      { ...partners[0], id: 33n, organizationId: 2n },
      { ...partners[0], id: 34n, isActive: false },
    ], scope)
    expect(choices.map((option) => option.value)).toEqual(["30", "31"])
  })

  it("filters journal items by exact account, partner, organization and company", () => {
    expect(reconciliationMoveLineChoices(lines, scope, selection).map((line) => line.id)).toEqual([40n])
    expect(reconciliationMoveLineChoices(lines, scope, { ...selection, partnerId: "" }).map((line) => line.id)).toEqual([40n, 41n])
    expect(reconciliationMoveLineChoices(lines, scope, { ...selection, accountId: "" })).toEqual([])
    expect(reconciliationMoveLineChoices([...lines, lines[0]], scope, selection)).toEqual([])
  })

  it("blocks stale selections rather than silently replacing or removing them", () => {
    expect(reconciliationSelectionIssue(selection, context)).toBeNull()
    expect(reconciliationSelectionIssue({ ...selection, accountId: "21" }, context)).toBe("staleLines")
    expect(reconciliationSelectionIssue({ ...selection, partnerId: "31" }, { ...context, partners: [...partners, { ...partners[0], id: 31n }] })).toBe("staleLines")
    expect(reconciliationSelectionIssue(selection, { ...context, lines: [] })).toBe("staleLines")
    expect(reconciliationSelectionIssue(selection, { ...context, ready: false })).toBe("loading")
  })

  it("blocks invalid, duplicate and unknown record IDs", () => {
    expect(reconciliationSelectionIssue({ ...selection, accountId: "99" }, context)).toBe("account")
    expect(reconciliationSelectionIssue({ ...selection, partnerId: "99" }, context)).toBe("partner")
    for (const moveLineIds of [[], ["40", "40"], "40,41", [40], ["-1"], ["18446744073709551616"], ["4,0"]]) {
      expect(reconciliationSelectionIssue({ ...selection, moveLineIds }, context)).toBe("lines")
    }
  })

  it("uses evidenced mode presets and preserves only the exact existing legacy mode", () => {
    expect(reconciliationSelectionIssue({ ...selection, mode: "manual" }, context)).toBeNull()
    expect(reconciliationSelectionIssue({ ...selection, mode: "invented" }, context)).toBe("mode")
    expect(reconciliationSelectionIssue({ ...selection, mode: "legacy" }, { ...context, existingMode: "legacy" })).toBeNull()
    expect(reconciliationSelectionIssue({ ...selection, mode: "other" }, { ...context, existingMode: "legacy" })).toBe("mode")
  })

  it("allows an explicit empty item set only on the verified edit path", () => {
    const empty = { ...selection, moveLineIds: [], mode: "manual", toCheck: true }
    expect(reconciliationSelectionIssue(empty, context)).toBe("lines")
    expect(reconciliationSelectionIssue(empty, { ...context, allowEmpty: true })).toBeNull()
    expect(toUpdateAccountReconciliationWidgetParams(empty)).toMatchObject({ move_line_ids: [], mode: "manual", to_check: true })
    for (const moveLineIds of ["", [40], ["40", "40"], ["43"]]) {
      expect(reconciliationSelectionIssue({ ...empty, moveLineIds }, { ...context, allowEmpty: true })).not.toBeNull()
    }
  })

  it("preserves record arrays and leaves unsafe numeric wire IDs rejected by the existing encoder", () => {
    const values = { ...selection, moveLineIds: ["9007199254740993", "40"], toCheck: true }
    const created = toCreateAccountReconciliationWidgetParams(values)
    expect(created?.moveLineIds).toEqual([9007199254740993n, 40n])
    expect(created?.accountId).toBe(20n)
    expect(created?.partnerId).toBe(30n)
    expect(() => toUpdateAccountReconciliationWidgetParams(values)).toThrow(/exceeds Number.MAX_SAFE_INTEGER/)
    const updated = toUpdateAccountReconciliationWidgetParams({ ...values, moveLineIds: ["40", "41"], partnerId: "" })
    expect(updated?.move_line_ids).toEqual([40, 41])
    expect(updated?.partner_id).toBeNull()
    expect(updated?.mode).toBe("bank")
  })
})

describe("reconciliation create and edit forms", () => {
  const t = ((key: string) => key) as TFunction
  it("uses searchable relations, a record array field and listed modes in both paths", () => {
    for (const config of [newReconciliationWidgetForm(t), editReconciliationWidgetForm(t, {
      widgetId: "50", accountId: "20", partnerId: "30", mode: "manual", moveLineIds: ["40"], toCheck: false,
    })]) {
      const fields = config.sections.flatMap((section) => section.fields)
      expect(fields.find((field) => field.name === "accountId")).toMatchObject({ type: "select", searchable: true })
      expect(fields.find((field) => field.name === "partnerId")).toMatchObject({ type: "select", searchable: true })
      expect(fields.find((field) => field.name === "moveLineIds")).toMatchObject({ type: "custom", defaultValue: expect.any(Array) })
      expect(fields.find((field) => field.name === "mode")).toMatchObject({ type: "select", options: [{ value: "bank", label: expect.any(String) }, { value: "manual", label: expect.any(String) }] })
    }
  })

  it("requires items on create but preserves empty-widget edits and clearing", () => {
    const createField = newReconciliationWidgetForm(t).sections.flatMap((section) => section.fields).find((field) => field.name === "moveLineIds")!
    const editField = editReconciliationWidgetForm(t, { widgetId: "50", accountId: "20", partnerId: "30", mode: "manual", moveLineIds: [], toCheck: false })
      .sections.flatMap((section) => section.fields).find((field) => field.name === "moveLineIds")!
    expect(createField.required).toBe(true)
    expect(createField.validation?.custom?.([])).toBeTruthy()
    expect(editField.required).not.toBe(true)
    expect(editField.validation?.custom?.([])).toBeNull()
    expect(editField.validation?.custom?.(["40", "40"])).toBeTruthy()
  })
})
