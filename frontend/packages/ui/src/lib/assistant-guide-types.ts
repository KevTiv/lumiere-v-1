import type { ChatMessageSourceRef } from "./ai-chat-types"

/** A canonical guide identity. u64 identities are strings to retain precision. */
export interface GuideReference {
  guideId: string
  revision: number
  title?: string
  module?: string
}

export type GuideReviewState = "draft" | "verified" | "needs_review" | "superseded"

/** Prepared content is not a saved document until a server acknowledges its identity. */
export interface GuideDraft {
  draftKey: string
  title: string
  markdown: string
  html?: string
  module: string
  workflow?: string
  companyId: string
  language?: string
  workflowVersion?: string
  sources: ChatMessageSourceRef[]
  originMessageId?: string
  runId?: string
}

export interface GuideDocument extends GuideDraft, Omit<GuideReference, "title" | "module"> {
  reviewState: GuideReviewState
  updatedAt?: string
  headRevision?: number
  canWrite?: boolean
  compatibility?: "unknown"
  reviewEvidence?: {
    state: string
    verified: boolean
    entryId?: string
    versionId?: string
    reviewEpoch?: number
    canNominate?: boolean
    canReview?: boolean
    reviews?: { kind: string; outcome: string; reviewer: string; reviewerName?: string }[]
  }
}

export type GuideVerificationInput = { sourcePassageIds: string[]; claimIds: string[]; decisionIds: string[] }
export type GuideReviewInput = { reviewKind: "source_fidelity" | "domain_interpretation" | "implementation"; outcome: "accepted" | "rejected"; note?: string }
export type GuideVerificationChoice = { decisionId: string; title: string; summary: string; sourceLabels: string[]; sourcePassageIds: string[]; claimIds: string[] }

export interface GuideRevisionSummary {
  revision: number
  title: string
  updatedAt?: string
  reviewState: GuideReviewState
}

export interface OpenGuideRequest {
  messageId: string
  draft?: GuideDraft
  reference?: GuideReference
}

export function isSavedGuide(guide: GuideDraft | GuideDocument): guide is GuideDocument {
  return "guideId" in guide && typeof guide.guideId === "string" && /^[1-9]\d{0,19}$/.test(guide.guideId) && BigInt(guide.guideId) <= 18_446_744_073_709_551_615n
    && "revision" in guide && Number.isSafeInteger(guide.revision) && guide.revision > 0
}

/** Links in generated content never become executable URLs. */
export function safeGuideHref(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return undefined
  if (value.startsWith("/") && !value.startsWith("//")) return value
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}

/** A single, closed HTML fence is an optional derivative of the admitted answer. */
export function extractGuideHtmlDerivative(markdown: string): string | undefined {
  const markers = [...markdown.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gm)]
  if (markers.length !== 2) return undefined
  const [opening, closing] = markers
  if (!opening || !closing || opening[2]?.trim().toLowerCase() !== "html"
    || closing[2]?.trim() !== "" || opening[1]?.[0] !== closing[1]?.[0]
    || closing[1]!.length < opening[1]!.length) return undefined
  const html = markdown.slice(opening.index! + opening[0].length, closing.index)
    .replace(/^\r?\n/, "").replace(/\r?\n$/, "")
  if (!html.trim() || html.length > 131_072 || new TextEncoder().encode(html).byteLength > 131_072) return undefined
  return html
}
