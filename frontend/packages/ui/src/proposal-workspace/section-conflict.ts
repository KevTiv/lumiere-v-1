/**
 * Pure logic for proposal section revision conflicts.
 *
 * `upsert_proposal_section` rejects a write whose expected revision is stale. The workspace keeps
 * the user's draft ("mine") and compares it with the live section row ("theirs").
 */

export type SectionDraft = {
  title: string
  content: string
  status: string
  sequence: number
  aiSuggestion: string | null
}

/** A rejected save: the draft that was being written plus the revisions the reducer reported. */
export type SectionConflict = {
  sectionId: string
  draft: SectionDraft
  expectedRevision: number
  foundRevision: number
}

export const SECTION_CONFLICT_FIELDS = ["title", "content", "status", "sequence", "aiSuggestion"] as const
export type SectionConflictField = (typeof SECTION_CONFLICT_FIELDS)[number]

export type SectionConflictFieldDiff = {
  field: SectionConflictField
  mine: string
  theirs: string
}

export type SectionConflictView = {
  /** Only fields whose values differ between the draft and the server version. */
  fields: SectionConflictFieldDiff[]
  /** Revision the draft was based on. */
  mineRevision: number
  /** Revision of the server version (live row when available, else the one the reducer reported). */
  theirsRevision: number
  /** True when the server version already equals the draft (nothing left to choose between). */
  identical: boolean
}

/** Reads a conflict off an error thrown by the upsert hook (duck-typed so the UI needs no hook import). */
export function readSectionConflictError(
  error: unknown,
): { expectedRevision: number; foundRevision: number } | null {
  if (!error || typeof error !== "object") return null
  const e = error as { name?: unknown; expectedRevision?: unknown; foundRevision?: unknown }
  if (e.name !== "ProposalSectionConflictError") return null
  if (typeof e.expectedRevision !== "number" || typeof e.foundRevision !== "number") return null
  return { expectedRevision: e.expectedRevision, foundRevision: e.foundRevision }
}

function statusKey(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object") {
    const tag = (value as { tag?: unknown }).tag
    if (typeof tag === "string") return tag.toLowerCase()
    const first = Object.keys(value)[0]
    if (first) return first.toLowerCase()
  }
  return ""
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value
  return null
}

/** The server (live) section row as a draft-shaped value. */
export function sectionDraftFromRow(row: Record<string, unknown> | null | undefined): SectionDraft {
  const sequence = Number(row?.sequence)
  return {
    title: typeof row?.title === "string" ? row.title : "",
    content: typeof row?.content === "string" ? row.content : "",
    status: statusKey(row?.status),
    sequence: Number.isFinite(sequence) ? sequence : 0,
    aiSuggestion: optionalText(row?.aiSuggestion),
  }
}

/** Normalises a draft so comparison ignores status case and empty-vs-null suggestions. */
export function normalizeSectionDraft(draft: Partial<SectionDraft>): SectionDraft {
  return {
    title: draft.title ?? "",
    content: draft.content ?? "",
    status: statusKey(draft.status),
    sequence: Number.isFinite(draft.sequence) ? (draft.sequence as number) : 0,
    aiSuggestion: optionalText(draft.aiSuggestion),
  }
}

function display(value: string | number | null): string {
  return value == null ? "" : String(value)
}

/**
 * Builds the conflict view-model: which fields differ and the two revisions.
 * `serverRow` is the live section row; when it is not available yet the reducer-reported revision is used
 * and only the draft side is meaningful.
 */
export function buildSectionConflictView(
  conflict: SectionConflict,
  serverRow: Record<string, unknown> | null | undefined,
): SectionConflictView {
  const mine = normalizeSectionDraft(conflict.draft)
  const theirs = sectionDraftFromRow(serverRow)
  const fields: SectionConflictFieldDiff[] = []
  if (serverRow) {
    for (const field of SECTION_CONFLICT_FIELDS) {
      if (mine[field] !== theirs[field]) {
        fields.push({ field, mine: display(mine[field]), theirs: display(theirs[field]) })
      }
    }
  }
  const liveRevision = Number(serverRow?.revision)
  return {
    fields,
    mineRevision: conflict.expectedRevision,
    theirsRevision: Number.isFinite(liveRevision) && serverRow?.revision != null ? liveRevision : conflict.foundRevision,
    identical: serverRow != null && fields.length === 0,
  }
}

/** Params for `resolve_proposal_section_conflict` that force-write the user's draft. */
export function sectionResolveParams(
  proposalId: bigint | number | string,
  sectionId: bigint | number | string,
  draft: SectionDraft,
) {
  return {
    proposalId,
    sectionId,
    title: draft.title,
    content: draft.content,
    status: draft.status || "draft",
    sequence: draft.sequence,
    aiSuggestion: draft.aiSuggestion,
  }
}

/** Records the latest edit on a conflicted section into the kept draft instead of sending another stale save. */
export function updateConflictDraft(conflict: SectionConflict, patch: Partial<SectionDraft>): SectionConflict {
  return { ...conflict, draft: { ...conflict.draft, ...patch } }
}
