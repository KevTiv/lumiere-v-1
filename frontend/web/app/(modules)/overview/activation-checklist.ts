import { onboardingFiscalYearEnd } from "@/lib/onboarding-config"
import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

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

function exactId(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return null
  if (!(typeof value === "string" || typeof value === "number" || typeof value === "bigint") || !/^[1-9]\d*$/.test(String(value))) return null
  return String(value)
}

const activationForms = {
  contact: { moduleId: "crm", tabId: "contacts", permission: "contact", resource: "contacts" },
  quotation: { moduleId: "sales", tabId: "orders", permission: "sale_order", resource: "sale-orders" },
  expense: { moduleId: "expenses", tabId: "expenses", permission: "hr_expense", resource: "expenses" },
} as const

export type ActivationCreateTask = keyof typeof activationForms

export function activationForm(task: ActivationTask | null) {
  const createTask = activationCreateTask(task)
  return createTask ? activationForms[createTask] : null
}

export function activationCreateTask(value: unknown): ActivationCreateTask | null {
  return value === "contact" || value === "quotation" || value === "expense" ? value : null
}

export interface ActivationReceipt {
  task: ActivationCreateTask
  recordId: string
}

export function activationReceiptKey(scope: string): string {
  return `lumiere:activation:first-outcome:v1:${scope}`
}

export function parseActivationReceipt(raw: string | null): ActivationReceipt | null {
  try {
    const value = raw ? JSON.parse(raw) : null
    const task = activationCreateTask(value?.task)
    const recordId = exactId(value?.recordId)
    return task && recordId && parseStrictU64(recordId) ? { task, recordId } : null
  } catch {
    return null
  }
}

export function matchesActivationRecord(row: unknown, receipt: ActivationReceipt, organizationId: Id, companyId: Id): boolean {
  if (!row || typeof row !== "object" || !("id" in row)) return false
  const rowOrganization = ("organizationId" in row ? row.organizationId : undefined)
    ?? ("organization_id" in row ? row.organization_id : undefined)
  const rowCompany = ("companyId" in row ? row.companyId : undefined)
    ?? ("company_id" in row ? row.company_id : undefined)
  const organization = exactId(organizationId)
  const company = exactId(companyId)
  return organization != null && company != null && exactId(row.id) === receipt.recordId
    && exactId(rowOrganization) === organization && exactId(rowCompany) === company
}

export function activationRecordHref(receipt: ActivationReceipt): string {
  if (receipt.task === "quotation") return `/sales/orders/${receipt.recordId}?tab=lines`
  const { moduleId, tabId } = activationForms[receipt.task]
  return moduleTabHref(moduleId, tabId, { id: receipt.recordId })
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
