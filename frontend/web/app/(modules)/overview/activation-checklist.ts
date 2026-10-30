import { onboardingFiscalYearEnd } from "@/lib/onboarding-config"

type Id = string | number | bigint
export type ActivationTask = "contact" | "quotation" | "expense" | "accounting" | "reports"
export type ActivationCheckState = "ready" | "missing" | "unavailable" | "loading"

export interface ActivationCompany {
  id: Id
  organizationId: Id
  currencyId?: Id
  fiscalYearEndMonth?: number
  fiscalYearEndDay?: number
}

export interface ActivationContact {
  id: Id
  organizationId: Id
  companyId?: Id | null
  isCustomer?: boolean
}

export interface ActivationRead<T> {
  status: "pending" | "error" | "success"
  data?: readonly T[]
}

function exactId(value: Id | null | undefined): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return null
  if (value == null || !/^[1-9]\d*$/.test(String(value))) return null
  return String(value)
}

/** Availability checks only. The canonical forms still own workflow eligibility. */
export function activationChecklist(input: {
  organizationId: Id
  companyId: Id | null
  companies: ActivationRead<ActivationCompany>
  contacts: ActivationRead<ActivationContact>
}) {
  const organizationId = exactId(input.organizationId)
  const companyId = exactId(input.companyId)
  const company = input.companies.status === "success" && organizationId && companyId
    ? input.companies.data?.find(row => exactId(row.id) === companyId && exactId(row.organizationId) === organizationId)
    : undefined
  const companyState: ActivationCheckState = !companyId ? "missing"
    : input.companies.status === "pending" ? "loading"
      : !company ? "unavailable" : "ready"
  // Field-masked values are unavailable, not proof of incomplete setup.
  const currencyState: ActivationCheckState = companyState !== "ready" ? companyState
    : company?.currencyId === undefined ? "unavailable"
      : exactId(company.currencyId) ? "ready" : "missing"
  const fiscalState: ActivationCheckState = companyState !== "ready" ? companyState
    : company?.fiscalYearEndMonth === undefined || company.fiscalYearEndDay === undefined ? "unavailable"
      : onboardingFiscalYearEnd(company.fiscalYearEndMonth, company.fiscalYearEndDay) ? "ready" : "missing"
  const companyContacts = companyState === "ready" && input.contacts.status === "success"
    ? (input.contacts.data ?? []).filter(row => exactId(row.id) && exactId(row.organizationId) === organizationId && exactId(row.companyId) === companyId)
    : []
  const scopeUnverifiable = input.contacts.data?.some(row => exactId(row.organizationId) === organizationId && row.companyId === undefined) ?? false
  const contactState: ActivationCheckState = companyState !== "ready" ? companyState
    : input.contacts.status === "pending" ? "loading"
      : input.contacts.status === "error" || input.contacts.data === undefined ? "unavailable"
        : companyContacts.length > 0 ? "ready"
          : scopeUnverifiable ? "unavailable" : "missing"
  const customerState: ActivationCheckState = contactState !== "ready" ? contactState
    : companyContacts.some(row => row.isCustomer === true) ? "ready"
      : scopeUnverifiable || companyContacts.some(row => row.isCustomer === undefined) ? "unavailable" : "missing"
  return { companyState, currencyState, fiscalState, contactState, customerState }
}

/** Navigation suggestions narrow discovery; these checks never authorize a save. */
export function availableActivationTasks(can: (resource: string, action: "read" | "create") => boolean): ActivationTask[] {
  const tasks: ActivationTask[] = []
  if (can("contact", "read") && can("contact", "create")) tasks.push("contact")
  if (can("sale_order", "read") && can("sale_order", "create")) tasks.push("quotation")
  if (can("hr_expense", "read") && can("hr_expense", "create")) tasks.push("expense")
  if (can("account_move", "read")) tasks.push("accounting")
  if (can("financial_report", "read")) tasks.push("reports")
  return tasks
}

export function selectedActivationTask(value: string | null, available: readonly ActivationTask[]): ActivationTask | null {
  return available.find(task => task === value) ?? available[0] ?? null
}

export function activationTaskHref(task: ActivationTask): string {
  switch (task) {
    case "contact": return "/crm?tab=contacts"
    case "quotation": return "/sales?tab=orders"
    case "expense": return "/expenses?tab=expenses"
    case "accounting": return "/accounting"
    case "reports": return "/reports"
  }
}
