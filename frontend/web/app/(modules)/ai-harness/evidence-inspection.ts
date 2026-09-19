export type EvidenceTargetKind = 'decision' | 'claim'

export interface EvidenceInspectionView {
  targetKind: string
  targetId: number
  lineagePasses: boolean
  decisions: Array<{
    id: number
    title: string
    rationale: string
    status: string
    adoptedClaimIds: number[]
  }>
  claims: Array<{
    id: number
    kind: string
    statement: string
    verificationMethod: string
    verificationOutcome: string
    status: string
  }>
  passages: Array<{
    id: number
    availability: string
    excerpt: string | null
    excerptTruncated: boolean
    coordinates: string[]
  }>
  sources: Array<{
    id: number
    outOfScope: boolean
    title: string | null
    authors: string[]
    authorAttribution: string | null
    scope: string | null
  }>
  findings: Array<{
    severity: string
    code: string
    message: string
  }>
}

const MAX_EXCERPT_CHARS = 1_000

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, maxLength = 2_000): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function optionalText(value: unknown, maxLength = 2_000): string | null {
  return typeof value === 'string' ? value.slice(0, maxLength) : null
}

function positiveId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const id = positiveId(item)
    return id === null ? [] : [id]
  })
}

function strings(value: unknown, maxItems = 64): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, maxItems)
    .map((item) => item.slice(0, 256))
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = record(item)
    return parsed ? [parsed] : []
  })
}

export function mapEvidenceInspection(payload: unknown): EvidenceInspectionView | null {
  const root = record(payload)
  if (!root) return null
  const targetId = positiveId(root.targetId)
  if (!targetId) return null

  const decisions = objects(root.decisions).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    return [{
      id,
      title: text(item.title, 512),
      rationale: text(item.rationale),
      status: text(item.status, 64),
      adoptedClaimIds: ids(item.adoptedClaimIds),
    }]
  })
  const claims = objects(root.claims).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    return [{
      id,
      kind: text(item.kind, 64),
      statement: text(item.statement),
      verificationMethod: text(item.verificationMethod, 64),
      verificationOutcome: text(item.verificationOutcome, 64),
      status: text(item.status, 64),
    }]
  })
  const passages = objects(root.passages).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    const availability = text(item.availability, 64) || 'missing'
    const isAvailable = availability === 'available'
    const excerpt = isAvailable ? optionalText(item.excerpt, MAX_EXCERPT_CHARS) : null
    return [{
      id,
      availability,
      excerpt,
      excerptTruncated: isAvailable && (
        item.excerptTruncated === true
        || (typeof item.excerpt === 'string' && item.excerpt.length > MAX_EXCERPT_CHARS)
      ),
      coordinates: isAvailable ? strings(item.coordinates) : [],
    }]
  })
  const sources = objects(root.sources).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    const outOfScope = item.outOfScope === true
    return [{
      id,
      outOfScope,
      title: outOfScope ? null : optionalText(item.title, 512),
      authors: outOfScope ? [] : strings(item.authors),
      authorAttribution: outOfScope ? null : optionalText(item.authorAttribution, 64),
      scope: outOfScope ? null : optionalText(item.scope, 64),
    }]
  })
  const findings = objects(root.findings).map((item) => ({
    severity: text(item.severity, 32) || 'review',
    code: text(item.code, 128),
    message: text(item.message),
  }))

  return {
    targetKind: text(root.targetKind, 64),
    targetId,
    lineagePasses: root.lineagePasses === true,
    decisions,
    claims,
    passages,
    sources,
    findings,
  }
}
