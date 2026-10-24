/**
 * Record id lists from forms: a multi-picker submits `string[]`; older text fields (and saved
 * drafts) submit comma-, semicolon- or whitespace-separated text. Both give the same tokens.
 */
export function idListTokens(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map((item) => String(item ?? ""))
    : raw == null
      ? []
      : String(raw).split(/[\s,;]+/)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** u64 ids for reducer params; a non-numeric token throws, as the text parsers always did. */
export function parseU64IdList(raw: unknown): bigint[] {
  return idListTokens(raw).map((token) => BigInt(token))
}
