import {
  createCsvImportRequest,
  type CsvImportRequest,
} from "@lumiere/query-hooks/hooks/csv-import-request"

export type ImportRecoveryScope = {
  actor: string
  organizationId: number
  companyId: number
}

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

/** A recovery copy is never proof of a save. Always read the server receipt. */
export type ImportRecovery = {
  version: 1
  scope: ImportRecoveryScope
  request: CsvImportRequest
}

const MAX_CSV_BYTES = 2_000_000

export function importRecoveryKey(scope: ImportRecoveryScope): string {
  if (!/^[a-f0-9]{64}$/i.test(scope.actor)
    || !Number.isSafeInteger(scope.organizationId) || scope.organizationId <= 0
    || !Number.isSafeInteger(scope.companyId) || scope.companyId <= 0) {
    throw new Error("An authenticated company scope is required for import recovery.")
  }
  return `lumiere.import-recovery.v1:${scope.actor.toLowerCase()}:${scope.organizationId}:${scope.companyId}`
}

function readObject(value: unknown): { [key: string]: unknown } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The retained import request is invalid. No new submission was sent.")
  }
  return value as { [key: string]: unknown }
}

function decodeRecovery(value: unknown, scope: ImportRecoveryScope): ImportRecovery {
  const envelope = readObject(value)
  const storedScope = readObject(envelope.scope)
  const stored = readObject(envelope.request)
  if (envelope.version !== 1 || storedScope.actor !== scope.actor.toLowerCase()
    || storedScope.organizationId !== scope.organizationId || storedScope.companyId !== scope.companyId
    || stored.organizationId !== String(scope.organizationId) || stored.companyId !== String(scope.companyId)
    || typeof stored.entity !== "string" || typeof stored.requestId !== "string"
    || typeof stored.csvData !== "string" || !stored.csvData.trim()
    || typeof stored.fileName !== "string" || !stored.fileName || stored.fileName.length > 1024
    || (stored.currencyId !== undefined && typeof stored.currencyId !== "string")
    || (stored.cacheCompanyId !== undefined && stored.cacheCompanyId !== stored.companyId)) {
    throw new Error("The retained import request does not match this company. No new submission was sent.")
  }
  if (new TextEncoder().encode(stored.csvData).byteLength > MAX_CSV_BYTES) {
    throw new Error("This import exceeds the 2 MB refresh-recovery limit. Use a smaller source file. No submission was sent.")
  }
  const request = createCsvImportRequest(
    BigInt(scope.organizationId), stored.entity, stored.csvData, stored.fileName,
    { companyId: scope.companyId, currencyId: stored.currencyId, cacheCompanyId: stored.cacheCompanyId },
    stored.requestId,
  )
  return { version: 1, scope: { ...scope, actor: scope.actor.toLowerCase() }, request }
}

export function readImportRecovery(storage: RecoveryStorage, scope: ImportRecoveryScope): ImportRecovery | null {
  const raw = storage.getItem(importRecoveryKey(scope))
  return raw === null ? null : decodeRecovery(JSON.parse(raw), scope)
}

/** Persist before dispatch; a storage failure prevents an unresumable effect. */
export function retainImportRequest(storage: RecoveryStorage, scope: ImportRecoveryScope, request: CsvImportRequest): void {
  const next = decodeRecovery({ version: 1, scope: { ...scope, actor: scope.actor.toLowerCase() }, request }, scope)
  const existing = readImportRecovery(storage, scope)
  if (existing && JSON.stringify(existing.request) !== JSON.stringify(next.request)) {
    throw new Error("Check the retained import result before starting another submission.")
  }
  const raw = JSON.stringify(next)
  const key = importRecoveryKey(scope)
  storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new Error("The import request could not be retained. No submission was sent.")
}

/** The UI calls this only after a terminal server receipt and explicit Start over. */
export function clearImportRecovery(storage: RecoveryStorage, scope: ImportRecoveryScope, requestId: string): void {
  const current = readImportRecovery(storage, scope)
  if (current && current.request.requestId !== requestId) {
    throw new Error("Another import is retained for this company. Check its result before replacing it.")
  }
  storage.removeItem(importRecoveryKey(scope))
}
