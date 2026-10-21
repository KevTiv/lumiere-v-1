import type { BillDocumentAttempt, BillDocumentScope } from "./bill-document-upload"

const attempts = new Map<string, BillDocumentAttempt>()
const listeners = new Map<string, Set<() => void>>()

export const billDocumentAttemptKey = (scope: BillDocumentScope, actorId: string) => JSON.stringify([scope.organizationId.toString(), scope.companyId.toString(), scope.billId.toString(), actorId])
export const readBillDocumentAttempt = (key: string) => attempts.get(key)

export function writeBillDocumentAttempt(key: string, attempt: BillDocumentAttempt): void {
  attempts.set(key, attempt)
  listeners.get(key)?.forEach((listener) => listener())
}

export function subscribeBillDocumentAttempt(key: string, listener: () => void): () => void {
  const subscribers = listeners.get(key) ?? new Set<() => void>()
  subscribers.add(listener)
  listeners.set(key, subscribers)
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key) }
}
