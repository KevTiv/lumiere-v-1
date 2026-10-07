/** Pure client-side record search used by the command palette. */

/** Lower-case, accent-free, whitespace-collapsed form used for every comparison. */
export function normalizeSearchText(value: unknown): string {
  if (value == null) return ""
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export const MATCH_EXACT = 3
export const MATCH_PREFIX = 2
export const MATCH_SUBSTRING = 1
export const MATCH_NONE = 0

/** exact > prefix > substring > none, case- and accent-insensitive. */
export function scoreSearchMatch(query: unknown, text: unknown): number {
  const q = normalizeSearchText(query)
  const t = normalizeSearchText(text)
  if (!q || !t) return MATCH_NONE
  if (t === q) return MATCH_EXACT
  if (t.startsWith(q)) return MATCH_PREFIX
  if (t.includes(q)) return MATCH_SUBSTRING
  return MATCH_NONE
}

/** Field of a row by camelCase key, falling back to its snake_case spelling. */
export function readRowField(row: Record<string, unknown>, key: string): unknown {
  if (row[key] != null) return row[key]
  const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  return row[snake]
}

export interface RecordSearchHit<T> {
  row: T
  score: number
}

/**
 * Rows whose fields match `query`, best match first (ties keep source order), at most `limit`.
 * A row scores by its best field; `getFields` returns the searchable text of one row.
 */
export function searchRecords<T>(
  rows: readonly T[] | null | undefined,
  query: string,
  getFields: (row: T) => readonly unknown[],
  limit = 5,
): RecordSearchHit<T>[] {
  if (!rows || !normalizeSearchText(query)) return []
  const hits: (RecordSearchHit<T> & { index: number })[] = []
  rows.forEach((row, index) => {
    let score = MATCH_NONE
    for (const field of getFields(row)) score = Math.max(score, scoreSearchMatch(query, field))
    if (score > MATCH_NONE) hits.push({ row, score, index })
  })
  hits.sort((a, b) => b.score - a.score || a.index - b.index)
  return hits.slice(0, Math.max(0, limit)).map(({ row, score }) => ({ row, score }))
}

/** Queries shorter than this do not touch any record table. */
export const RECORD_SEARCH_MIN_CHARS = 2

export function isRecordSearchQuery(query: string): boolean {
  return normalizeSearchText(query).length >= RECORD_SEARCH_MIN_CHARS
}
