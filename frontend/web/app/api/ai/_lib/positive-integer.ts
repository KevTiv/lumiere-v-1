import { parseStrictU64 } from '@lumiere/erp-shared/u64'

/** Parse a positive HTTP ID without rounding, truncation, or unsafe Number conversion. */
export function positiveInteger(raw: unknown): number {
  // HTTP IDs are decimal scalars, not form-formatted/grouped values or SATS
  // Option envelopes. Keep that source contract narrower than the form parser.
  if (typeof raw !== 'number' && typeof raw !== 'string') return NaN
  if (typeof raw === 'string' && !/^\d+$/.test(raw.trim())) return NaN
  const parsed = parseStrictU64(raw)
  if (parsed === undefined || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return NaN
  const value = Number(parsed)
  return value > 0 ? value : NaN
}
