/**
 * Revision-conflict handling for `upsert_proposal_section`.
 *
 * The reducer rejects a stale write with
 * `Section conflict: expected revision <X>, found <Y>` (u32 revisions). The BFF relays that
 * text in the error body, so the hook parses it here and throws a typed error the UI can act on.
 */

const CONFLICT_PATTERN = /Section conflict: expected revision (\d+), found (\d+)/
const U32_MAX = 4_294_967_295

export type ProposalSectionConflictRevisions = {
  expectedRevision: number
  foundRevision: number
}

export const PROPOSAL_SECTION_CONFLICT_ERROR_NAME = "ProposalSectionConflictError"

/** Parses the reducer's conflict message; returns null for anything else (including malformed numbers). */
export function parseProposalSectionConflictMessage(
  message: unknown,
): ProposalSectionConflictRevisions | null {
  if (typeof message !== "string") return null
  const match = CONFLICT_PATTERN.exec(message)
  if (!match) return null
  const expectedRevision = Number(match[1])
  const foundRevision = Number(match[2])
  if (expectedRevision > U32_MAX || foundRevision > U32_MAX) return null
  return { expectedRevision, foundRevision }
}

export class ProposalSectionConflictError extends Error {
  readonly expectedRevision: number
  readonly foundRevision: number

  constructor(revisions: ProposalSectionConflictRevisions, message?: string) {
    super(
      message ??
        `Section conflict: expected revision ${revisions.expectedRevision}, found ${revisions.foundRevision}`,
    )
    this.name = PROPOSAL_SECTION_CONFLICT_ERROR_NAME
    this.expectedRevision = revisions.expectedRevision
    this.foundRevision = revisions.foundRevision
  }
}

export function isProposalSectionConflictError(error: unknown): error is ProposalSectionConflictError {
  return error instanceof ProposalSectionConflictError
}

/** Strings in an error response body that may carry the reducer message (`error`, `detail`, `message`). */
function errorBodyCandidates(bodyText: string): string[] {
  const candidates = [bodyText]
  try {
    const payload: unknown = JSON.parse(bodyText)
    if (payload && typeof payload === "object") {
      for (const key of ["error", "detail", "message"]) {
        const value = (payload as Record<string, unknown>)[key]
        if (typeof value === "string") candidates.push(value)
      }
    }
  } catch {
    // Not JSON; the raw text is already a candidate.
  }
  return candidates
}

/**
 * Maps a failed upsert response body to the error to throw: a typed conflict error when the
 * reducer reported a revision conflict, otherwise the generic error (unchanged behaviour).
 */
export function proposalSectionUpsertError(
  bodyText: string,
  genericMessage = "Failed to upsert proposal section",
): Error {
  for (const candidate of errorBodyCandidates(bodyText)) {
    const revisions = parseProposalSectionConflictMessage(candidate)
    if (revisions) return new ProposalSectionConflictError(revisions)
  }
  return new Error(genericMessage)
}
