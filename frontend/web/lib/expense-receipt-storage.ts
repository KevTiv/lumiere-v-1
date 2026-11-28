import { sha256Hex } from "./document-blob-upload"
import type { ExpenseCaptureOutboxItem, ExpenseCaptureReceipt } from "./expense-capture-outbox"

const databaseName = "lumiere-expense-receipts"
const storeName = "receipts"

export function receiptStorageKey(organizationId: string, item: Pick<ExpenseCaptureOutboxItem, "actorIdentity" | "formOrigin" | "companyId" | "deviceId" | "clientRequestId" | "receipt">): string {
  const actor = item.actorIdentity ?? item.formOrigin?.actorIdentity
  if (!actor || !organizationId || !item.companyId || !item.deviceId || !item.clientRequestId || !item.receipt?.clientRequestId ||
      (item.formOrigin && (item.formOrigin.organizationId !== organizationId || item.formOrigin.actorIdentity !== actor))) {
    throw new Error("Receipt storage scope is unavailable")
  }
  return JSON.stringify([organizationId, actor, item.companyId, item.deviceId, item.clientRequestId, item.receipt.clientRequestId])
}

export function captureFileMatches(file: File, receipt: ExpenseCaptureReceipt): boolean {
  return file.size === receipt.fileSize && file.name === receipt.fileName && file.type === receipt.mimeType && file.lastModified === receipt.lastModified
}

async function receiptTransaction<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (typeof indexedDB === "undefined") throw new Error("Receipt storage is unavailable on this device")
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(databaseName, 1)
    open.onupgradeneeded = () => { open.result.createObjectStore(storeName) }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => resolve(open.result)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const operation = request(transaction.objectStore(storeName))
      transaction.oncomplete = () => resolve(operation.result)
      transaction.onabort = () => reject(operation.error ?? transaction.error)
    })
  } finally {
    db.close()
  }
}

type ReceiptOwner = Parameters<typeof receiptStorageKey>[1]

export async function storeExpenseReceipt(organizationId: string, item: ReceiptOwner, file: File): Promise<string> {
  const key = receiptStorageKey(organizationId, item)
  if (!item.receipt || !captureFileMatches(file, item.receipt)) throw new Error("Select the original receipt file with the same name, size, type, and modification time")
  const fingerprint = await sha256Hex(file)
  if (item.receipt.fingerprint && item.receipt.fingerprint !== fingerprint) {
    throw new Error("The selected file does not match the original receipt")
  }
  try {
    // A separate Blob avoids relying on browser-specific structured cloning of File metadata.
    await receiptTransaction("readwrite", store => store.put(file.slice(0, file.size, file.type), key))
    return fingerprint
  } catch {
    throw new Error("The receipt could not be saved on this device. Check available storage and try again. No upload was sent.")
  }
}

export async function readExpenseReceipt(organizationId: string, item: ReceiptOwner): Promise<File | undefined> {
  const receipt = item.receipt
  if (!receipt || receipt.uploaded) return undefined
  const key = receiptStorageKey(organizationId, item)
  const blob: unknown = await receiptTransaction("readonly", store => store.get(key))
  if (!(blob instanceof Blob) || blob.size !== receipt.fileSize || blob.type !== receipt.mimeType) return undefined
  return new File([blob], receipt.fileName, { type: receipt.mimeType, lastModified: receipt.lastModified })
}

export async function removeExpenseReceipt(organizationId: string, item: ReceiptOwner): Promise<void> {
  const key = receiptStorageKey(organizationId, item)
  await receiptTransaction("readwrite", store => store.delete(key))
}
