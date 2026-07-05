import { setRecordCustomFieldValues } from "@lumiere/stdb/client-ui-bridge"
import type { RecordCustomFieldEntry } from "@lumiere/stdb/types"

function parseMetadataObject(metadata: unknown): Record<string, unknown> | null {
  if (metadata == null) return null
  if (typeof metadata === "string") {
    const trimmed = metadata.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
    return null
  }
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }
  return null
}

/** Build EAV entries from entity metadata JSON (`custom:*` keys). */
export function customFieldEntriesFromMetadata(metadata: unknown): RecordCustomFieldEntry[] {
  const obj = parseMetadataObject(metadata)
  if (!obj) return []

  return Object.entries(obj)
    .filter(([key]) => key.startsWith("custom:"))
    .map(([fieldKey, value]) => ({
      fieldKey,
      valueJson: JSON.stringify(value ?? null),
    }))
}

export async function persistCustomFieldsToEav(args: {
  organizationId: number
  companyId: bigint
  model: string
  recordId: bigint
  metadata: unknown
}): Promise<void> {
  const entries = customFieldEntriesFromMetadata(args.metadata)
  if (entries.length === 0) return

  await setRecordCustomFieldValues(BigInt(args.organizationId), args.companyId, {
    model: args.model,
    recordId: args.recordId,
    entries,
  })
}

/** Pick the row with the highest numeric id among matches. */
export function findNewestRowByField(
  rows: readonly Record<string, unknown>[],
  field: string,
  value: string,
): Record<string, unknown> | undefined {
  const matches = rows.filter((row) => String(row[field] ?? "") === value)
  if (matches.length === 0) return undefined
  return matches.reduce((best, row) => {
    const bestId = BigInt(String(best.id ?? 0))
    const rowId = BigInt(String(row.id ?? 0))
    return rowId > bestId ? row : best
  })
}

export function findNewestRowByPartnerId(
  rows: readonly Record<string, unknown>[],
  partnerId: string | number | bigint,
): Record<string, unknown> | undefined {
  const pid = String(partnerId)
  const matches = rows.filter(
    (row) => String(row.partnerId ?? row.partner_id ?? "") === pid,
  )
  if (matches.length === 0) return undefined
  return matches.reduce((best, row) => {
    const bestId = BigInt(String(best.id ?? 0))
    const rowId = BigInt(String(row.id ?? 0))
    return rowId > bestId ? row : best
  })
}
