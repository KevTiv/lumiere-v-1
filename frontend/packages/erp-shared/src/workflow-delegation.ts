/** Metadata carried by the existing Purchasing delegation command contract. */
export function workflowDelegationMetadata(validFrom: string, validUntil: string, reason: string, now = Date.now()): string {
  const start = new Date(validFrom).getTime()
  const end = new Date(validUntil).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now) {
    throw new Error("Delegation requires a valid start and a future end after its start")
  }
  if (!reason.trim()) throw new Error("Delegation reason is required")
  return JSON.stringify({ valid_from_micros: String(BigInt(start) * 1000n), valid_until_micros: String(BigInt(end) * 1000n), reason: reason.trim() })
}
