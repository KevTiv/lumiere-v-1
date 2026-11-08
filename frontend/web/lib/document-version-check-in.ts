import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { documentActorId, documentOptional } from "@lumiere/ui/lib/bill-source-document-model"
import type { DocumentUploadReceipt, DocumentUploadScope } from "./document-upload-receipts"

type DocumentLockRow = {
  id?: unknown; organizationId?: unknown; organization_id?: unknown; companyId?: unknown; company_id?: unknown
  currentVersionId?: unknown; current_version_id?: unknown; isLocked?: unknown; is_locked?: unknown
  lockedBy?: unknown; locked_by?: unknown
}

/** A retry must never unlock a different version or another user's later lock. */
export async function releaseSavedVersionLock(input: {
  receipt: DocumentUploadReceipt
  scope: DocumentUploadScope
  assertCurrent(): void
  read(): Promise<readonly DocumentLockRow[]>
  unlock(documentId: string): Promise<unknown>
}): Promise<void> {
  const { receipt, scope } = input
  if (!receipt.documentId || !receipt.versionId || receipt.registration.versionDocumentId !== receipt.documentId) {
    throw new Error("The saved version must be confirmed before releasing its lock")
  }
  input.assertCurrent()
  const rows = await input.read()
  input.assertCurrent()
  const matches = rows.filter((row) => String(row.id) === receipt.documentId &&
    parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId &&
    parseStrictU64(documentOptional(row.companyId ?? row.company_id)) === scope.companyId)
  if (matches.length !== 1) throw new Error("The saved document lock could not be checked. Reopen the document before unlocking.")
  const row = matches[0]!
  const versionId = parseStrictU64(documentOptional(row.currentVersionId ?? row.current_version_id))
  const locked = row.isLocked ?? row.is_locked
  if (versionId == null || typeof locked !== "boolean") throw new Error("The current document version or lock state is unavailable")
  if (String(versionId) !== receipt.versionId || !locked) return
  if (documentActorId(row.lockedBy ?? row.locked_by) !== documentActorId(scope.actorId)) return
  input.assertCurrent()
  await input.unlock(receipt.documentId)
}
