/** Guide identity is a lookup hint. The API must reauthorize the exact revision. */
export interface RagGuideReference {
  guideId: string
  revision: number
}

const MAX_GUIDE_REFS = 4
const MAX_U64 = 18_446_744_073_709_551_615n

export function parseRagGuideReferences(raw: unknown): RagGuideReference[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > MAX_GUIDE_REFS) {
    throw new Error('guide_refs must be an array of at most 4 guide references')
  }
  const refs: RagGuideReference[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Each guide reference requires a guideId and revision')
    }
    const { guideId, revision } = value as Record<string, unknown>
    if (
      typeof guideId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(guideId) ||
      BigInt(guideId) > MAX_U64 || typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) || revision <= 0 || revision > 4_294_967_295
    ) {
      throw new Error('Guide references require a string u64 ID and a positive integer revision')
    }
    const key = `${guideId}:${revision}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push({ guideId, revision })
    }
  }
  return refs.length ? refs : undefined
}
