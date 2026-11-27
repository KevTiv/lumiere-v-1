import { enqueueExpenseCapture, readExpenseCaptureOutbox, type ExpenseCaptureOutboxItem } from "../../../lib/expense-capture-outbox"
import { readExpenseReceipt, removeExpenseReceipt, storeExpenseReceipt } from "../../../lib/expense-receipt-storage"
import { syncExpenseCapture, type CaptureScope, type CaptureSyncServices } from "./expense-capture-sync"

export function withExpenseOutboxLock<T>(organizationId: string, deviceId: string, operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined
  return locks ? locks.request(JSON.stringify(["lumiere.expense-outbox", organizationId, deviceId]), operation) : operation()
}

export async function enqueueRetainedExpense(
  organizationId: string,
  attempt: Parameters<typeof enqueueExpenseCapture>[1],
  file?: File,
) {
  if (readExpenseCaptureOutbox(organizationId, attempt.deviceId, true).some(item => item.clientRequestId === attempt.clientRequestId)) {
    throw new Error("This expense request is already retained. Continue the saved request.")
  }
  if (attempt.payload.hasReceipt && !file) throw new Error("Choose a receipt file before saving")
  const fingerprint = file ? await storeExpenseReceipt(organizationId, attempt, file) : undefined
  const saved = fingerprint && attempt.receipt
    ? { ...attempt, receipt: { ...attempt.receipt, fingerprint } }
    : attempt
  try {
    return enqueueExpenseCapture(organizationId, saved)
  } catch (error) {
    if (file) await removeExpenseReceipt(organizationId, attempt).catch(() => undefined)
    throw error
  }
}

export async function syncRetainedExpense(item: ExpenseCaptureOutboxItem, scope: CaptureScope, services: CaptureSyncServices) {
  const organizationId = String(scope.organizationId)
  const retained = readExpenseCaptureOutbox(organizationId, item.deviceId, true)
    .find(candidate => candidate.clientRequestId === item.clientRequestId)
  if (!retained || !scope.actorIdentity || (retained.actorIdentity ?? retained.formOrigin?.actorIdentity) !== scope.actorIdentity ||
      retained.companyId !== String(scope.companyId)) throw new Error("Switch back to the company and signed-in account saved with this expense request")
  if (retained.syncState === "synced") return retained
  let checkpoint = retained
  let removed = false
  const releaseUploadedFile = async () => {
    if (!removed && checkpoint.receipt?.uploaded) {
      try {
        await removeExpenseReceipt(organizationId, checkpoint)
        removed = true
      } catch {
        // A verified remote upload remains valid. Retry local cleanup on the next check.
      }
    }
  }
  const file = retained.syncState === "unknown" || retained.syncState === "submitting"
    ? undefined : await readExpenseReceipt(organizationId, retained).catch(() => undefined)
  try {
    return await syncExpenseCapture(retained, scope, file, {
      ...services,
      afterUploadCheckpoint: releaseUploadedFile,
      save(next) {
        services.save(next)
        checkpoint = next
      },
    })
  } finally {
    // Only retire local bytes once the verified upload checkpoint has been committed.
    await releaseUploadedFile()
  }
}
