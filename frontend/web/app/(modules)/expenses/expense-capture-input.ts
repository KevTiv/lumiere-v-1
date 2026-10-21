import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
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
  typeTaxUse?: unknown
  type_tax_use?: unknown
}

/** Company-owned lookup rows need explicit matching organization and company scope. */
export function expenseCompanyLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint, companyId: bigint): T[] {
  if (organizationId <= 0n || companyId <= 0n) return []
  return rows.filter((row) =>
    String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && String(row.companyId ?? row.company_id ?? "") === String(companyId),
  )
}

/** Products are organization-owned. Eligibility remains the expense reducer's decision. */
export function expenseProductLookupRows<T extends ExpenseLookupRow>(rows: readonly T[], organizationId: bigint): T[] {
  if (organizationId <= 0n) return []
  return rows.filter((row) =>
    String(row.organizationId ?? row.organization_id ?? "") === String(organizationId)
    && row.active !== false && row.active !== 0
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
