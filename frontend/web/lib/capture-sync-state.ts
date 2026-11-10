export type CaptureSyncState =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict"

export interface CaptureOwner {
  actorIdentity: string
  companyId: string
}

/** Older drafts without an owner cannot be attributed safely on a shared device. */
export function isCaptureOwnedBy(
  item: Partial<CaptureOwner> | null | undefined,
  owner: CaptureOwner,
): boolean {
  return Boolean(
    owner.actorIdentity &&
    owner.companyId &&
    owner.companyId !== "0" &&
    item?.actorIdentity === owner.actorIdentity &&
    item.companyId === owner.companyId,
  )
}
