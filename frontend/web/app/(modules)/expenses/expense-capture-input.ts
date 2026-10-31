import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import type { TFunction } from "i18next"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import type { DocumentBlobUploadResult } from "@/lib/document-blob-upload"
import { expenseVariantTag } from "@/lib/expense-state"

export interface ExpenseLookupRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  name?: unknown
  displayName?: unknown
  active?: unknown
  canBeExpensed?: unknown
  can_be_expensed?: unknown
  typeTaxUse?: unknown
  type_tax_use?: unknown
  currencyId?: unknown
  currency_id?: unknown
  userId?: unknown
  user_id?: unknown
  isActive?: unknown
  is_active?: unknown
  deletedAt?: unknown
  deleted_at?: unknown
}

function employeeIdentity(value: unknown): string | undefined {
  if (typeof value === "string") {
    const hex = value.replace(/^0x/i, "").toLowerCase()
    return /^[a-f0-9]{64}$/.test(hex) ? hex : undefined
  }
  if (value && typeof value === "object") {
    if ("__identity__" in value) return employeeIdentity(value.__identity__)
    if ("hex" in value) return employeeIdentity(value.hex)
  }
  return undefined
}

/** Only a unique, active employee explicitly linked to this actor is a usable default. */
export function expenseDefaultEmployee(rows: readonly ExpenseLookupRow[], organizationId: bigint, companyId: bigint, identity: string | null): string | undefined {
  const actor = employeeIdentity(identity)
  if (!actor) return undefined
  const matches = expenseCompanyLookupRows(rows, organizationId, companyId).filter((row) =>
    (row.isActive ?? row.is_active) === true
    && (row.deletedAt === null || row.deleted_at === null)
    && employeeIdentity(row.userId ?? row.user_id) === actor
    && Boolean(optionalBigIntU64(row.id)),
  )
  return matches.length === 1 ? String(matches[0].id) : undefined
}

/** Apply a proven default only to the initial form; the form owner retains later user edits. */
export function expenseEmployeeDefaultForm(config: FormConfig, employeeId: string | undefined, description: string): FormConfig {
  if (!employeeId) return config
  return { ...config, sections: config.sections.map((section) => ({ ...section, fields: section.fields.map((field) =>
    field.name === "employeeId" && field.type === "select" ? { ...field, defaultValue: employeeId, description } : field,
  ) })) }
}

/** Shared price lists have an explicit null company, never an omitted company projection. */
export function expensePricelistLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint, companyId: bigint): T[] {
  if (organizationId <= 0n || companyId <= 0n) return []
  return rows.filter((row) => String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && ("companyId" in row || "company_id" in row)
    && (row.companyId === null || row.company_id === null || String(row.companyId ?? row.company_id) === String(companyId))
    && (row.isActive ?? row.is_active) === true
    && Boolean(optionalBigIntU64(row.currencyId ?? row.currency_id)))
}

/** Validate required relations before uploading a receipt or dispatching a create command. */
export function expenseCreateContext(values: FormValues, employees: readonly ExpenseLookupRow[], pricelists: readonly ExpenseLookupRow[], organizationId: bigint, companyId: bigint, t: TFunction) {
  if (organizationId <= 0n || companyId <= 0n) {
    throw new Error(t("expenses.forms.capture.companyRequired", { defaultValue: "Select a company before saving this expense." }))
  }
  const employeeId = optionalBigIntU64(values.employeeId)
  if (!employeeId || !expenseCompanyLookupRows(employees, organizationId, companyId).some((row) => String(row.id) === String(employeeId))) {
    throw new Error(t("expenses.forms.capture.employeeUnavailable", { defaultValue: "Select an employee available in this company. Your signed-in account does not select an employee automatically." }))
  }
  const pricelistId = optionalBigIntU64(values.pricelistId)
  const pricelist = pricelists.find((row) => pricelistId && String(row.id) === String(pricelistId))
  if (!pricelist) {
    throw new Error(t("expenses.forms.capture.pricelistRequired", { defaultValue: "Select an available price list. Its currency is used for this expense." }))
  }
  const currencyId = optionalBigIntU64(pricelist.currencyId)
  if (!currencyId) {
    throw new Error(t("expenses.forms.capture.currencyRequired", { defaultValue: "The selected price list has no valid currency. Select another price list or ask an administrator to complete its setup." }))
  }
  return { employeeId, currencyId }
}

/** Company-owned lookup rows need explicit matching organization and company scope. */
export function expenseCompanyLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint, companyId: bigint): T[] {
  if (organizationId <= 0n || companyId <= 0n) return []
  return rows.filter((row) =>
    String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && String(row.companyId ?? row.company_id ?? "") === String(companyId),
  )
}

/** Offer only declared expense-capable products; the reducer enforces the remaining expense policy. */
export function expenseProductLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint): T[] {
  if (organizationId <= 0n) return []
  return rows.filter((row) =>
    String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && row.active !== false && row.active !== 0
    && (row.canBeExpensed ?? row.can_be_expensed) === true
    && String(row.displayName ?? row.name ?? "").trim() !== "",
  )
}

export function expenseTaxLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint, companyId: bigint): T[] {
  return expenseCompanyLookupRows(rows, organizationId, companyId).filter((row) =>
    (row.active === true || row.active === 1)
    && ["Purchase", "None"].includes(expenseVariantTag(row.typeTaxUse ?? row.type_tax_use))
    && String(row.name ?? "").trim() !== "",
  )
}

/** Hidden fields stay in form state; strip values that do not belong to the selected/canonical kind. */
export function expenseInputsForLineKind(values: FormValues, canonicalKind: unknown = values.lineKind): FormValues {
  const kind = expenseVariantTag(canonicalKind) || "Standard"
  return {
    ...values,
    lineKind: kind,
    mileageDistance: kind === "Mileage" ? values.mileageDistance : undefined,
    mileageRateId: kind === "Mileage" ? values.mileageRateId : undefined,
    perDiemDays: kind === "PerDiem" ? values.perDiemDays : undefined,
    perDiemRateId: kind === "PerDiem" ? values.perDiemRateId : undefined,
    ...(kind === "Mileage" || kind === "PerDiem" ? { totalAmount: undefined, unitAmount: undefined, quantity: undefined } : {}),
  }
}

/** Registration metadata comes only from a completed upload, never from manual form IDs/keys. */
export function expenseReceiptFromUpload(uploaded: DocumentBlobUploadResult, employeeId: bigint, clientRequestId: string) {
  return {
    employeeId,
    storageKey: uploaded.objectKey,
    fileName: uploaded.fileName,
    mimeType: uploaded.mimetype,
    contentHash: uploaded.checksum,
    clientRequestId,
  }
}

interface ReceiptAttempt {
  requestId: string
  uploaded?: DocumentBlobUploadResult
  receiptId?: bigint
  inFlight?: Promise<bigint>
}

export interface ExpenseReceiptScope {
  organizationId: bigint
  companyId: bigint
  employeeId: bigint
}

interface ExpenseReceiptAttemptServices {
  upload: (file: File, companyId: bigint) => Promise<DocumentBlobUploadResult>
  register: (params: ReturnType<typeof expenseReceiptFromUpload>, companyId: bigint) => Promise<bigint>
  newRequestId: () => string
}

/** A component-local retry cache; each file and exact scope keep one upload and receipt request identity. */
export function createExpenseReceiptAttemptCache() {
  const files = new WeakMap<File, Map<string, ReceiptAttempt>>()
  return async (file: File, scope: ExpenseReceiptScope, services: ExpenseReceiptAttemptServices): Promise<bigint> => {
    const key = `${scope.organizationId}:${scope.companyId}:${scope.employeeId}`
    let scopes = files.get(file)
    if (!scopes) {
      scopes = new Map()
      files.set(file, scopes)
    }
    let attempt = scopes.get(key)
    if (!attempt) {
      attempt = { requestId: services.newRequestId() }
      scopes.set(key, attempt)
    }
    if (attempt.receiptId !== undefined) return attempt.receiptId
    if (attempt.inFlight) return attempt.inFlight
    const current = attempt
    const pending = (async () => {
      current.uploaded ??= await services.upload(file, scope.companyId)
      const receiptId = await services.register(
        expenseReceiptFromUpload(current.uploaded, scope.employeeId, current.requestId),
        scope.companyId,
      )
      current.receiptId = receiptId
      return receiptId
    })()
    current.inFlight = pending
    try {
      return await pending
    } finally {
      current.inFlight = undefined
    }
  }
}

/** Keep persisted edit references visible without adding a selectable out-of-scope candidate. */
export function preserveExpenseEditSelections(config: FormConfig, unavailableLabel: (value: string) => string): FormConfig {
  const linkedFields = new Set(["productId", "projectId", "taxIds", "mileageRateId", "perDiemRateId"])
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (!linkedFields.has(field.name) || (field.type !== "select" && field.type !== "multiselect")) return field
        const values = (Array.isArray(field.defaultValue) ? field.defaultValue : [field.defaultValue])
          .filter((value) => value != null && String(value).trim() !== "").map(String)
        // UpdateExpenseParams cannot clear product_id; do not offer a no-op clear choice.
        const options = field.options.filter((option) => !(field.name === "productId" && values.length > 0 && option.value === ""))
        const missing = [...new Set(values)].filter((value) => !options.some((option) => option.value === value))
        return { ...field, options: [...options, ...missing.map((value) => ({ value, label: unavailableLabel(value), disabled: true }))] }
      }),
    })),
  }
}
