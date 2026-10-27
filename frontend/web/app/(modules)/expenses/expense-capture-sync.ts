import { OperationRequestError } from "@lumiere/api-client"
import type { CreateExpenseParams } from "@lumiere/stdb/types"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { stbTimestampFromDate } from "@lumiere/erp-shared/stb-timestamp"
import type { DocumentBlobUploadResult } from "../../../lib/document-blob-upload"
import type {
  ExpenseCaptureOutboxItem,
  ExpenseCapturePayload,
  ExpenseCaptureReceipt,
} from "../../../lib/expense-capture-outbox"

export interface CaptureEffectRow {
  name?: unknown
  currencyId?: unknown
  currency_id?: unknown
  date?: unknown
  unitAmount?: unknown
  unit_amount?: unknown
  quantity?: unknown
  description?: unknown
  taxIds?: unknown
  tax_ids?: unknown
  productId?: unknown
  product_id?: unknown
  accountId?: unknown
  account_id?: unknown
  analyticAccountId?: unknown
  analytic_account_id?: unknown
  projectId?: unknown
  project_id?: unknown
  lineKind?: unknown
  line_kind?: unknown
  mileageDistance?: unknown
  mileage_distance?: unknown
  mileageRateId?: unknown
  mileage_rate_id?: unknown
  perDiemDays?: unknown
  per_diem_days?: unknown
  perDiemRateId?: unknown
  per_diem_rate_id?: unknown
  paymentMode?: unknown
  payment_mode?: unknown
  merchantKey?: unknown
  merchant_key?: unknown
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  employeeId?: unknown
  employee_id?: unknown
  clientRequestId?: unknown
  client_request_id?: unknown
  storageKey?: unknown
  storage_key?: unknown
  contentHash?: unknown
  content_hash?: unknown
  hasReceipt?: unknown
  has_receipt?: unknown
  attachmentIds?: unknown
  attachment_ids?: unknown
}

export class CaptureReadbackError extends Error {
  constructor(
    readonly code:
      | "unavailable"
      | "ambiguous"
      | "scope"
      | "receipt-mismatch"
      | "payload-mismatch",
    message: string,
  ) {
    super(message)
    this.name = "CaptureReadbackError"
  }
}
export interface CaptureScope {
  organizationId: bigint
  companyId: bigint
  actorIdentity?: string | null
}

/** Only an exact request key with exact scope can confirm this capture. */
export function resolveCaptureEffect(
  rows: readonly CaptureEffectRow[],
  scope: CaptureScope,
  requestId: string,
): string | null {
  if (
    rows.some(
      (row) => !("clientRequestId" in row) && !("client_request_id" in row),
    )
  )
    throw new CaptureReadbackError(
      "unavailable",
      "Request-key readback is unavailable; no new command was sent",
    )
  const matches = rows.filter(
    (row) =>
      String(row.clientRequestId ?? row.client_request_id ?? "") === requestId,
  )
  if (matches.length > 1)
    throw new CaptureReadbackError(
      "ambiguous",
      "Multiple records match the capture request",
    )
  if (matches.length === 0) return null
  const row = matches[0]
  if (
    parseStrictU64(row.organizationId ?? row.organization_id) !==
      scope.organizationId ||
    parseStrictU64(row.companyId ?? row.company_id) !== scope.companyId ||
    !parseStrictU64(row.id)
  )
    throw new CaptureReadbackError(
      "scope",
      "The capture result does not match its saved scope",
    )
  return String(parseStrictU64(row.id))
}

function captureField(
  row: CaptureEffectRow,
  camel: keyof CaptureEffectRow,
  snake: keyof CaptureEffectRow = camel,
): unknown {
  if (!(camel in row) && !(snake in row))
    throw new CaptureReadbackError(
      "unavailable",
      `The saved expense field ${snake} is unavailable; its result is not confirmed`,
    )
  return camel in row ? row[camel] : row[snake]
}
function captureEnum(value: unknown): unknown {
  return value && typeof value === "object" && "tag" in value
    ? value.tag
    : value
}
function captureMicros(value: unknown): bigint | undefined {
  if (!value || typeof value !== "object") return undefined
  const micros =
    "microsSinceUnixEpoch" in value
      ? value.microsSinceUnixEpoch
      : "__timestamp_micros_since_unix_epoch__" in value
        ? value.__timestamp_micros_since_unix_epoch__
        : undefined
  if (typeof micros === "bigint") return micros
  if (typeof micros === "number" && Number.isSafeInteger(micros))
    return BigInt(micros)
  if (typeof micros === "string" && /^-?\d+$/.test(micros))
    return BigInt(micros)
  return undefined
}
function captureOptionalId(
  value: unknown,
  expected: bigint | undefined,
): boolean {
  return expected === undefined
    ? value == null
    : parseStrictU64(value) === expected
}
/** Compare submitted values only; rate amounts remain derived by the server. */
function assertCapturePayload(
  row: CaptureEffectRow,
  item: ExpenseCaptureOutboxItem,
): void {
  const payload = item.payload
  if (payload.policyExceptionReason) throw new CaptureReadbackError("unavailable", "The policy exception reason cannot be confirmed from the expense projection")
  const params = capturePayloadToParams(
    payload,
    BigInt(item.companyId!),
    item.clientRequestId,
    [],
  )
  const field = (
    camel: keyof CaptureEffectRow,
    snake?: keyof CaptureEffectRow,
  ) => captureField(row, camel, snake)
  const quantity =
    payload.lineKind === "Standard"
      ? payload.quantity
      : payload.lineKind === "Mileage"
        ? payload.mileageDistance
        : payload.perDiemDays
  const amount = field("unitAmount", "unit_amount")
  const taxes = field("taxIds", "tax_ids")
  const description = field("description")
  const merchant = field("merchantKey", "merchant_key")
  if (
    parseStrictU64(field("employeeId", "employee_id")) !==
      BigInt(payload.employeeId) ||
    parseStrictU64(field("currencyId", "currency_id")) !==
      BigInt(payload.currencyId) ||
    field("name") !== payload.name ||
    captureMicros(field("date")) !==
      BigInt(new Date(payload.date).getTime()) * 1000n ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    (payload.lineKind === "Standard" && amount !== payload.unitAmount) ||
    field("quantity") !== quantity ||
    (description ?? undefined) !== params.description ||
    (merchant ?? undefined) !== params.merchantKey ||
    captureEnum(field("lineKind", "line_kind")) !== payload.lineKind ||
    captureEnum(field("paymentMode", "payment_mode")) !==
      (payload.paymentMode ?? "OutOfPocket") ||
    !Array.isArray(taxes) ||
    taxes.length !== (params.taxIds?.length ?? 0) ||
    taxes.some((tax, index) => parseStrictU64(tax) !== params.taxIds?.[index]) ||
    !captureOptionalId(field("productId", "product_id"), params.productId) ||
    !captureOptionalId(field("accountId", "account_id"), params.accountId) ||
    !captureOptionalId(
      field("analyticAccountId", "analytic_account_id"),
      params.analyticAccountId,
    ) ||
    !captureOptionalId(field("projectId", "project_id"), params.projectId) ||
    !captureOptionalId(
      field("mileageRateId", "mileage_rate_id"),
      params.mileageRateId,
    ) ||
    !captureOptionalId(
      field("perDiemRateId", "per_diem_rate_id"),
      params.perDiemRateId,
    ) ||
    (field("mileageDistance", "mileage_distance") ?? undefined) !==
      params.mileageDistance ||
    (field("perDiemDays", "per_diem_days") ?? undefined) !== params.perDiemDays
  ) {
    throw new CaptureReadbackError(
      "payload-mismatch",
      "The saved expense does not match the submitted capture values",
    )
  }
}

/** Confirm the persisted receipt relation as well as the immutable expense request key. */
export function resolveCapturedExpense(
  rows: readonly CaptureEffectRow[],
  scope: CaptureScope,
  item: ExpenseCaptureOutboxItem,
): string | null {
  const id = resolveCaptureEffect(rows, scope, item.clientRequestId)
  if (id === null) return null
  const row = rows.find(
    (candidate) =>
      String(candidate.clientRequestId ?? candidate.client_request_id ?? "") ===
      item.clientRequestId,
  )!
  if (
    (!("hasReceipt" in row) && !("has_receipt" in row)) ||
    (!("attachmentIds" in row) && !("attachment_ids" in row))
  ) {
    throw new CaptureReadbackError(
      "unavailable",
      "The saved expense receipt relation is unavailable; its result is not confirmed",
    )
  }
  const actual = row.attachmentIds ?? row.attachment_ids
  const expectedId = item.payload.hasReceipt
    ? parseStrictU64(item.receipt?.receiptId)
    : undefined
  if (
    (row.hasReceipt ?? row.has_receipt) !== item.payload.hasReceipt ||
    !Array.isArray(actual) ||
    (item.payload.hasReceipt
      ? !expectedId ||
        actual.length !== 1 ||
        parseStrictU64(actual[0]) !== expectedId
      : actual.length !== 0)
  ) {
    throw new CaptureReadbackError(
      "receipt-mismatch",
      "The saved expense does not match its captured receipt attachment",
    )
  }
  assertCapturePayload(row, item)
  return id
}

export function resolveCapturedReceipt(
  rows: readonly CaptureEffectRow[],
  scope: CaptureScope,
  employeeId: string,
  receipt: ExpenseCaptureReceipt,
): string | null {
  const id = resolveCaptureEffect(rows, scope, receipt.clientRequestId)
  if (id === null) return null
  const row = rows.find(
    (candidate) =>
      String(candidate.clientRequestId ?? candidate.client_request_id ?? "") ===
      receipt.clientRequestId,
  )!
  if (
    !receipt.uploaded ||
    parseStrictU64(row.employeeId ?? row.employee_id) !==
      parseStrictU64(employeeId) ||
    String(row.storageKey ?? row.storage_key ?? "") !==
      receipt.uploaded.objectKey ||
    String(row.contentHash ?? row.content_hash ?? "") !==
      receipt.uploaded.checksum
  )
    throw new CaptureReadbackError(
      "receipt-mismatch",
      "The receipt result does not match the saved upload",
    )
  return id
}

export function captureFileMatches(
  file: File,
  receipt: ExpenseCaptureReceipt,
): boolean {
  return (
    file.size === receipt.fileSize &&
    file.name === receipt.fileName &&
    file.type === receipt.mimeType &&
    file.lastModified === receipt.lastModified
  )
}

export function capturePayloadToParams(
  payload: ExpenseCapturePayload,
  companyId: bigint,
  requestId: string,
  attachmentIds: bigint[],
): Partial<CreateExpenseParams> {
  return {
    companyId,
    employeeId: BigInt(payload.employeeId),
    name: payload.name,
    date: stbTimestampFromDate(new Date(payload.date)),
    currencyId: BigInt(payload.currencyId),
    unitAmount: payload.lineKind === "Standard" ? payload.unitAmount : 0,
    quantity: payload.lineKind === "Standard" ? payload.quantity : 1,
    description: payload.description,
    taxIds: (payload.taxIds ?? []).map(BigInt),
    productId: payload.productId ? BigInt(payload.productId) : undefined,
    accountId: payload.accountId ? BigInt(payload.accountId) : undefined,
    analyticAccountId: payload.analyticAccountId ? BigInt(payload.analyticAccountId) : undefined,
    policyExceptionReason: payload.policyExceptionReason,
    attachmentIds,
    projectId: payload.projectId ? BigInt(payload.projectId) : undefined,
    lineKind: { tag: payload.lineKind },
    mileageDistance:
      payload.lineKind === "Mileage" ? payload.mileageDistance : undefined,
    mileageRateId:
      payload.lineKind === "Mileage" && payload.mileageRateId
        ? BigInt(payload.mileageRateId)
        : undefined,
    perDiemDays:
      payload.lineKind === "PerDiem" ? payload.perDiemDays : undefined,
    perDiemRateId:
      payload.lineKind === "PerDiem" && payload.perDiemRateId
        ? BigInt(payload.perDiemRateId)
        : undefined,
    clientRequestId: requestId,
    paymentMode: { tag: payload.paymentMode ?? "OutOfPocket" },
    merchantKey: payload.merchantKey,
  }
}
export interface CaptureSyncServices {
  /** Local admission runs before write-start checkpoints; denial is known unsent. */
  assertWriteAllowed?: () => void
  readExpenses: () => Promise<readonly CaptureEffectRow[]>
  readReceipts: () => Promise<readonly CaptureEffectRow[]>
  upload: (file: File, companyId: bigint) => Promise<DocumentBlobUploadResult>
  register: (params: {
    companyId: bigint
    employeeId: bigint
    storageKey: string
    clientRequestId: string
    fileName: string
    mimeType: string
    contentHash: string
  }) => Promise<bigint>
  create: (params: Partial<CreateExpenseParams>) => Promise<unknown>
  save: (item: ExpenseCaptureOutboxItem) => void
}

/** Calls the existing operations once; each remote effect keeps its durable request identity. */
export async function syncExpenseCapture(
  item: ExpenseCaptureOutboxItem,
  scope: CaptureScope,
  file: File | undefined,
  services: CaptureSyncServices,
): Promise<ExpenseCaptureOutboxItem> {
  if (
    !item.companyId ||
    parseStrictU64(item.companyId) !== scope.companyId ||
    scope.organizationId <= 0n ||
    scope.companyId <= 0n
  )
    throw new CaptureReadbackError(
      "scope",
      "Select the company saved with this queued capture",
    )
  if (item.formOrigin && (item.formOrigin.actorIdentity !== scope.actorIdentity
    || item.formOrigin.organizationId !== String(scope.organizationId))) {
    throw new CaptureReadbackError("scope", "Switch back to the signed-in identity saved with this expense request")
  }
  let current = item
  const save = (next: ExpenseCaptureOutboxItem) => {
    services.save(next)
    current = next
  }
  const confirmed = (expenseId: string) => {
    save({ ...current, expenseId, syncState: "synced", lastError: undefined })
    return current
  }
  const existing = resolveCapturedExpense(
    await services.readExpenses(),
    scope,
    current,
  )
  if (existing) return confirmed(existing)
  if (current.syncState === "submitting" || current.syncState === "unknown") {
    save({
      ...current,
      syncState: "unknown",
      lastError:
        "The expense outcome is not confirmed. Check again before any further action.",
    })
    return current
  }
  let submissionCheckpointSaved = false
  try {
    let attachmentIds: bigint[] = []
    if (current.payload.hasReceipt) {
      let receipt = current.receipt
      if (!receipt)
        throw new Error(
          "This queued capture has no receipt file. Discard it and capture it again with an attachment.",
        )
      if (!receipt.uploaded) {
        if (!file || !captureFileMatches(file, receipt))
          throw new Error(
            "Reattach the original receipt file to continue. File bytes are not stored across reloads.",
          )
        services.assertWriteAllowed?.()
        receipt = { ...receipt, state: "uploading", lastError: undefined }
        save({ ...current, receipt })
        const upload = await services.upload(file, scope.companyId)
        if (!upload.objectKey || !upload.checksum)
          throw new Error("The upload did not return a verified file identity")
        receipt = {
          ...receipt,
          uploaded: {
            objectKey: upload.objectKey,
            checksum: upload.checksum,
            fileName: upload.fileName,
            mimetype: upload.mimetype,
            fileSize: String(upload.fileSize),
          },
        }
        save({ ...current, receipt })
      }
      let receiptId = resolveCapturedReceipt(
        await services.readReceipts(),
        scope,
        current.payload.employeeId,
        receipt,
      )
      if (!receiptId) {
        const upload = receipt.uploaded!
        let registrationError: unknown
        try {
          services.assertWriteAllowed?.()
          await services.register({
            companyId: scope.companyId,
            employeeId: BigInt(current.payload.employeeId),
            storageKey: upload.objectKey,
            clientRequestId: receipt.clientRequestId,
            fileName: upload.fileName,
            mimeType: upload.mimetype,
            contentHash: upload.checksum,
          })
        } catch (error) {
          registrationError = error
        }
        receiptId = resolveCapturedReceipt(
          await services.readReceipts(),
          scope,
          current.payload.employeeId,
          receipt,
        )
        if (!receiptId)
          throw (
            registrationError ??
            new Error(
              "Receipt registration is not confirmed. Retry will check the same request identity.",
            )
          )
      }
      receipt = {
        ...receipt,
        receiptId,
        state: "attached",
        lastError: undefined,
      }
      save({ ...current, receipt })
      attachmentIds = [BigInt(receiptId)]
    }
    services.assertWriteAllowed?.()
    save({ ...current, syncState: "submitting", lastError: undefined })
    submissionCheckpointSaved = true
    let dispatchError: unknown
    try {
      await services.create(
        capturePayloadToParams(
          current.payload,
          scope.companyId,
          current.clientRequestId,
          attachmentIds,
        ),
      )
    } catch (error) {
      dispatchError = error
    }
    if (
      dispatchError instanceof OperationRequestError &&
      dispatchError.retry !== "reconcile"
    ) {
      save({
        ...current,
        syncState: "rejected",
        lastError: dispatchError.message,
      })
      return current
    }
    const result = resolveCapturedExpense(
      await services.readExpenses(),
      scope,
      current,
    )
    if (result) return confirmed(result)
    save({
      ...current,
      syncState: "unknown",
      lastError:
        dispatchError instanceof Error
          ? dispatchError.message
          : "The expense command was accepted, but its saved result is not confirmed.",
    })
    return current
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture failed"
    save({
      ...current,
      syncState: submissionCheckpointSaved ? "unknown" : "error",
      lastError: message,
      receipt:
        current.receipt && current.receipt.state !== "attached"
          ? { ...current.receipt, state: "failed", lastError: message }
          : current.receipt,
    })
    throw error
  }
}
