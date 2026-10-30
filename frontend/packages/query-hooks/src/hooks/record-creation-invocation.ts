import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { WorkflowError, type RowValueMap } from "@lumiere/erp-workflows"
import type { InvocationScope, ReceiptStorage } from "./purchasing-receipt-invocation"

export type ConfigurableCreationModel = "crm_lead" | "opportunity" | "contact" | "sale_order"
export interface PendingRecordCreation {
  version: 1
  organizationId: string
  companyId: string
  actorHex: string
  model: ConfigurableCreationModel
  operationKey: string
  payloadJson: string
  requestJson: string
  phase: "prepared" | "uncertain" | "rejected"
}

const validKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const modelValid = (value: unknown): value is ConfigurableCreationModel => ["crm_lead", "opportunity", "contact", "sale_order"].includes(String(value))

/** Reserved protocol data is derived by the create owner, never accepted from a form field. */
export function withRecordCreationEnvelope(metadata: unknown, companyId: bigint, operationKey: string): string {
  if (metadata != null && typeof metadata === "object" && Object.hasOwn(metadata, "some")) metadata = (metadata as { some: unknown }).some
  if (metadata != null && typeof metadata === "object" && Object.hasOwn(metadata, "none")) metadata = undefined
  let object: object = {}
  if (metadata != null && metadata !== "") {
    if (typeof metadata !== "string") throw new WorkflowError("validation", "Creation metadata must be JSON text")
    const parsed: unknown = JSON.parse(metadata)
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new WorkflowError("validation", "Creation metadata must be an object")
    if (Object.hasOwn(parsed, "__lumiere_create_v1")) throw new WorkflowError("validation", "Creation retry identity cannot be supplied by form metadata")
    object = parsed
  }
  if (companyId <= 0n || !validKey(operationKey)) throw new WorkflowError("validation", "A valid creation identity and company are required")
  return JSON.stringify({ ...object, __lumiere_create_v1: { operation_key: operationKey, company_id: companyId.toString() } })
}

export function recordCreationStorageKey(scope: InvocationScope, model: ConfigurableCreationModel): string {
  if (!/^[a-f0-9]{64}$/.test(scope.actorHex) || scope.organizationId <= 0n || scope.companyId <= 0n || !modelValid(model)) {
    throw new WorkflowError("validation", "Current record-creation actor and scope are required")
  }
  return `lumiere:record-create:v1:${scope.organizationId}:${scope.companyId}:${scope.actorHex}:${model}`
}

function decode(raw: string, scope: InvocationScope, model: ConfigurableCreationModel): PendingRecordCreation {
  let pending: PendingRecordCreation
  try { pending = JSON.parse(raw) } catch { throw new WorkflowError("conflict", "Saved creation attempt is invalid; no new record was dispatched") }
  if (!pending || pending.version !== 1 || pending.organizationId !== scope.organizationId.toString() || pending.companyId !== scope.companyId.toString()
    || pending.actorHex !== scope.actorHex || pending.model !== model || !validKey(pending.operationKey)
    || typeof pending.payloadJson !== "string" || typeof pending.requestJson !== "string" || !["prepared", "uncertain", "rejected"].includes(pending.phase)) {
    throw new WorkflowError("conflict", "Saved creation identity is inconsistent; no new record was dispatched")
  }
  return pending
}

function exactResult(pending: PendingRecordCreation, rows: readonly RowValueMap[]): string | undefined {
  const id = `${pending.organizationId}:${pending.companyId}:${pending.model}:${pending.operationKey}`
  const matches = rows.filter((row) => row.id === id)
  if (matches.length > 1) throw new WorkflowError("conflict", "Multiple saved records claim the same creation identity")
  const row = matches[0]
  if (!row) return undefined
  const field = (camel: string, snake: string) => Object.hasOwn(row, camel) ? row[camel] : row[snake]
  const recordId = parseStrictU64(field("recordId", "record_id"))
  if (parseStrictU64(field("organizationId", "organization_id"))?.toString() !== pending.organizationId
    || parseStrictU64(field("companyId", "company_id"))?.toString() !== pending.companyId || row.model !== pending.model
    || field("operationKey", "operation_key") !== pending.operationKey || !recordId || recordId === 0n
    || typeof field("payloadHash", "payload_hash") !== "string" || !/^sha256:[0-9a-f]{64}$/.test(String(field("payloadHash", "payload_hash")))) {
    throw new WorkflowError("conflict", "Saved record does not agree with canonical creation evidence")
  }
  return recordId.toString()
}

/** Mark only an explicit server-side rejection as safe to correct. Transport/5xx outcomes remain uncertain. */
export class RecordCreationRejected extends Error {}

/** One explicit user attempt, with durable identity before POST and exact recovery before any replay. */
export async function executeRecordCreation(
  scope: InvocationScope,
  model: ConfigurableCreationModel,
  payloadJson: string,
  storage: ReceiptStorage,
  ports: {
    makeKey(): string
    makeRequest(operationKey: string): string
    assertScope(): void
    read(operationKey: string): Promise<RowValueMap[]>
    dispatch(requestJson: string): Promise<void>
  },
): Promise<string> {
  const storageKey = recordCreationStorageKey(scope, model)
  ports.assertScope()
  let previousRaw: string | null
  try { previousRaw = storage.getItem(storageKey) } catch { throw new WorkflowError("validation", "Creation recovery storage is unavailable; no record was dispatched") }
  let pending = previousRaw == null ? undefined : decode(previousRaw, scope, model)
  // The capability read fails before a first write when the deployed native
  // receipt owner is unavailable. A lost response is resolved by this same read.
  const rows = await ports.read(pending?.operationKey ?? "capability_probe")
  ports.assertScope()
  if (pending) {
    const savedId = exactResult(pending, rows)
    if (savedId) { storage.removeItem(storageKey); return savedId }
    if (pending.payloadJson !== payloadJson) {
      if (pending.phase !== "rejected") throw new WorkflowError("conflict", "A previous save is unresolved. Restore its entered values and check it before creating a different record.")
      pending = undefined
    }
  }
  if (!pending) {
    const operationKey = ports.makeKey()
    if (!validKey(operationKey)) throw new WorkflowError("validation", "Invalid creation operation key")
    pending = { version: 1, organizationId: scope.organizationId.toString(), companyId: scope.companyId.toString(), actorHex: scope.actorHex,
      model, operationKey, payloadJson, requestJson: ports.makeRequest(operationKey), phase: "prepared" }
  }
  if (pending.requestJson !== ports.makeRequest(pending.operationKey)) {
    throw new WorkflowError("conflict", "Saved creation request no longer matches its retained input; no record was dispatched")
  }
  // Every retry uses the original complete request, including its operation key.
  pending.phase = "uncertain"
  const encoded = JSON.stringify(pending)
  try { storage.setItem(storageKey, encoded) } catch { throw new WorkflowError("validation", "Cannot preserve creation identity; no record was dispatched") }
  ports.assertScope()
  try { await ports.dispatch(pending.requestJson) } catch (error) {
    if (error instanceof RecordCreationRejected) { pending.phase = "rejected"; storage.setItem(storageKey, JSON.stringify(pending)) }
    throw error
  }
  ports.assertScope()
  const savedId = exactResult(pending, await ports.read(pending.operationKey))
  ports.assertScope()
  if (!savedId) throw new WorkflowError("server_failure", "Save was acknowledged but its exact record could not be read. Check this attempt again; do not create a replacement.")
  storage.removeItem(storageKey)
  return savedId
}
