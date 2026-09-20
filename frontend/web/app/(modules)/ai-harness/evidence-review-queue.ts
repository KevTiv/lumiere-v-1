/** The reviewer's queue as the screen may trust it: bounded, and blind to anything the server redacted. */

export interface QueuePassageView {
  id: number
  availability: string
  status: string | null
  /** Only present when the passage is available to this reviewer. */
  sourceTitle: string | null
}

export interface AffectedComponentView {
  id: number
  workflowVersionId: number | null
  nodeKey: string | null
  linkState: string
}

export interface QueueClaimView {
  id: number
  kind: string
  statement: string
  status: string
  queueReason: string
  verificationMethod: string
  verificationOutcome: string
  verificationNote: string | null
  passages: QueuePassageView[]
  creatorUid: string | null
  proposerUid: string | null
  proposerKind: string | null
  reviewableByViewer: boolean
  affectedComponents: AffectedComponentView[]
}

export interface QueueDecisionView {
  id: number
  title: string
  status: string
  adoptedClaimIds: number[]
  creatorUid: string | null
  proposerUid: string | null
  reviewableByViewer: boolean
  affectedComponents: AffectedComponentView[]
}

export interface QueueComponentView {
  id: number
  workflowVersionId: number | null
  nodeKey: string | null
  linkState: string
  version: number
  /** The exact content a confirmation must name. */
  contentHash: string
  decisionIds: number[]
  claimIds: number[]
}

export interface ReviewQueueView {
  claims: QueueClaimView[]
  decisions: QueueDecisionView[]
  components: QueueComponentView[]
  claimsTruncated: boolean
  decisionsTruncated: boolean
  componentsTruncated: boolean
}

const MAX_ITEMS = 50
const HEX_IDENTITY = /^[0-9a-f]{64}$/
const CONTENT_HASH = /^[0-9a-f]{64}$/

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, maxLength = 512): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function optionalText(value: unknown, maxLength = 512): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maxLength) : null
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 256).flatMap((item) => {
    const id = positiveId(item)
    return id === null ? [] : [id]
  })
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ITEMS).flatMap((item) => {
    const parsed = record(item)
    return parsed ? [parsed] : []
  })
}

function identity(value: unknown): string | null {
  return typeof value === 'string' && HEX_IDENTITY.test(value) ? value : null
}

/** A short, stable label for an identity; never the credential itself. */
export function shortIdentity(identityHex: string | null): string {
  return identityHex ? `${identityHex.slice(0, 8)}…` : 'unknown'
}

function affected(value: unknown): AffectedComponentView[] {
  return objects(value).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    return [{
      id,
      workflowVersionId: positiveId(item.workflowVersionId),
      nodeKey: optionalText(item.nodeKey, 128),
      linkState: text(item.linkState, 32),
    }]
  })
}

function passages(value: unknown): QueuePassageView[] {
  return objects(value).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    const availability = text(item.availability, 32) || 'missing'
    const available = availability === 'available'
    return [{
      id,
      availability,
      status: available ? optionalText(item.status, 32) : null,
      // A title is only ever shown for a passage the reviewer may see.
      sourceTitle: available ? optionalText(item.sourceTitle) : null,
    }]
  })
}

export function mapReviewQueue(payload: unknown): ReviewQueueView | null {
  const root = record(payload)
  if (!root) return null

  const claims = objects(root.claims).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    return [{
      id,
      kind: text(item.kind, 64),
      statement: text(item.statement, 400),
      status: text(item.status, 64),
      queueReason: text(item.queueReason, 64),
      verificationMethod: text(item.verificationMethod, 64),
      verificationOutcome: text(item.verificationOutcome, 64),
      verificationNote: optionalText(item.verificationNote, 400),
      passages: passages(item.passages),
      creatorUid: identity(item.creatorUid),
      proposerUid: identity(item.proposerUid),
      proposerKind: optionalText(item.proposerKind, 16),
      // Default to "not reviewable": the screen must be told it is.
      reviewableByViewer: item.reviewableByViewer === true,
      affectedComponents: affected(item.affectedComponents),
    }]
  })
  const decisions = objects(root.decisions).flatMap((item) => {
    const id = positiveId(item.id)
    if (!id) return []
    return [{
      id,
      title: text(item.title, 400),
      status: text(item.status, 64),
      adoptedClaimIds: ids(item.adoptedClaimIds),
      creatorUid: identity(item.creatorUid),
      proposerUid: identity(item.proposerUid),
      reviewableByViewer: item.reviewableByViewer === true,
      affectedComponents: affected(item.affectedComponents),
    }]
  })
  const components = objects(root.components).flatMap((item) => {
    const id = positiveId(item.id)
    const contentHash = typeof item.contentHash === 'string' && CONTENT_HASH.test(item.contentHash)
      ? item.contentHash
      : null
    // Without an exact hash a confirmation cannot be bound to what was reviewed.
    if (!id || !contentHash) return []
    return [{
      id,
      workflowVersionId: positiveId(item.workflowVersionId),
      nodeKey: optionalText(item.nodeKey, 128),
      linkState: text(item.linkState, 32),
      version: positiveId(item.version) ?? 1,
      contentHash,
      decisionIds: ids(item.decisionIds),
      claimIds: ids(item.claimIds),
    }]
  })

  return {
    claims,
    decisions,
    components,
    claimsTruncated: root.claimsTruncated === true,
    decisionsTruncated: root.decisionsTruncated === true,
    componentsTruncated: root.componentsTruncated === true,
  }
}

export type QueueReviewTarget =
  | { kind: 'claim'; id: number; outcome: 'supported' | 'qualified' | 'unsupported' }
  | { kind: 'decision'; id: number; outcome: 'accepted' | 'rejected' }
  | { kind: 'component'; id: number; outcome: 'confirmed' | 'unresolved'; expectedContentHash?: string }

/**
 * The only fields the browser sends for a verdict: a target, a verdict, a note
 * and the company it intends. Organization, actor and role stay server-side.
 */
export function buildReviewRequest(
  companyId: number,
  target: QueueReviewTarget,
  note: string,
): Record<string, unknown> | null {
  if (!Number.isSafeInteger(companyId) || companyId <= 0 || target.id <= 0) return null
  const trimmed = note.trim()
  if (target.kind === 'claim' && target.outcome === 'qualified' && trimmed.length === 0) {
    return null
  }
  const body: Record<string, unknown> = {
    companyId,
    kind: target.kind,
    id: target.id,
    outcome: target.outcome,
    note: trimmed.length > 0 ? trimmed.slice(0, 2_000) : null,
  }
  if (target.kind === 'component' && target.outcome === 'confirmed') {
    if (!target.expectedContentHash || !CONTENT_HASH.test(target.expectedContentHash)) return null
    body.expectedContentHash = target.expectedContentHash
  }
  return body
}
