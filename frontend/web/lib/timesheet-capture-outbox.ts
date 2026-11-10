/** Tracks interrupted timesheet writes. The native operation has no replay key. */
import { isCaptureOwnedBy, type CaptureOwner } from "./capture-sync-state"
import {
  getOrCreateLocalStorageDeviceId,
  readLocalStorageArray,
  writeLocalStorageArray,
} from "./local-outbox"

export interface TimesheetCapturePayload {
  projectId: string
  taskId: string
  employeeId: string
  date: string
  unitAmount: number
}

export interface TimesheetCaptureOutboxItem extends CaptureOwner {
  clientRequestId: string
  payload: TimesheetCapturePayload
  syncState: "submitting" | "failed" | "conflict"
}

function storageKey(organizationId: number, deviceId: string): string {
  return `lumiere.timesheet-capture-outbox.${organizationId}.${deviceId}`
}

export function getOrCreateTimesheetCaptureDeviceId(): string {
  return getOrCreateLocalStorageDeviceId("lumiere.timesheet-capture-device-id")
}

export function listTimesheetCaptures(
  organizationId: number,
  deviceId: string,
  owner: CaptureOwner,
): TimesheetCaptureOutboxItem[] {
  return readLocalStorageArray<TimesheetCaptureOutboxItem>(
    storageKey(organizationId, deviceId),
  ).filter((item) => isCaptureOwnedBy(item, owner))
}

export function writeTimesheetCapture(
  organizationId: number,
  deviceId: string,
  attempt: TimesheetCaptureOutboxItem,
  { remove = false }: { remove?: boolean } = {},
): void {
  const key = storageKey(organizationId, deviceId)
  const others = readLocalStorageArray<TimesheetCaptureOutboxItem>(key).filter(
    (item) =>
      !isCaptureOwnedBy(item, attempt) ||
      item.clientRequestId !== attempt.clientRequestId,
  )
  writeLocalStorageArray(key, remove ? others : [...others, attempt])
}

export function hasUnconfirmedTimesheetCapture(
  items: readonly TimesheetCaptureOutboxItem[],
  payload: TimesheetCapturePayload,
): boolean {
  return items.some(
    ({ syncState, payload: saved }) =>
      syncState !== "failed" &&
      saved.projectId === payload.projectId &&
      saved.taskId === payload.taskId &&
      saved.employeeId === payload.employeeId &&
      saved.date === payload.date &&
      saved.unitAmount === payload.unitAmount,
  )
}
