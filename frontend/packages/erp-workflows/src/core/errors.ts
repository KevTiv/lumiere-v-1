export type WorkflowErrorKind =
  | "validation"
  | "permission_denied"
  | "approval_required"
  | "stale_revision"
  | "conflict"
  | "already_applied"
  | "retryable_transport"
  | "outcome_unknown"
  | "not_found"
  | "server_failure"

export class WorkflowError extends Error {
  readonly kind: WorkflowErrorKind
  readonly status?: number

  constructor(kind: WorkflowErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = "WorkflowError"
    this.kind = kind
    this.status = options?.status
  }

  /** Safe to re-issue without risking a duplicate write. */
  get retryable(): boolean {
    return this.kind === "retryable_transport"
  }

  /** The command may have committed: converge on canonical state before offering a retry. */
  get needsReadback(): boolean {
    return this.kind === "outcome_unknown" || this.kind === "already_applied"
  }

  /**
   * The command did not commit, but what the user was looking at is out of date (someone else
   * changed the record, or it is gone). Refresh so they see the current state before deciding.
   */
  get viewIsStale(): boolean {
    return this.kind === "stale_revision" || this.kind === "conflict" || this.kind === "not_found"
  }

  /**
   * The server refused the change. The API server reports every reducer rejection (state guard
   * or input error alike) as one 422 with only a message, so a rejection can mean the record was
   * changed since it was loaded. A rejected write changed nothing, so refetching is harmless; a
   * check that failed on the client (no status) never reached the server and needs none.
   */
  get rejectedByServer(): boolean {
    return this.kind === "validation" && this.status !== undefined
  }

  /** Every failure after which the affected lists must be refetched. */
  get needsRefresh(): boolean {
    return this.needsReadback || this.viewIsStale || this.rejectedByServer
  }
}

const ALREADY_APPLIED = /\balready\b.*\b(confirmed|applied|processed|posted|done|validated|cancell?ed)\b/i

/**
 * Map an api-server failure (`{ "error": message }` with a stable status) to the taxonomy.
 * Until reducers emit machine codes, message text is the only signal separating
 * `already_applied` from `conflict` (409) and from a plain rejection (422).
 */
export function classifyHttpFailure(status: number, message: string): WorkflowErrorKind {
  if (status === 401 || status === 403) return "permission_denied"
  if (status === 404 || status === 410) return "not_found"
  if (status === 409) return ALREADY_APPLIED.test(message) ? "already_applied" : "conflict"
  if (status === 412) return "stale_revision"
  // The API server reports reducer rejections as 422 (never 409), so "already done" wording is the
  // only signal that a replayed command had in fact been applied.
  if (status === 400 || status === 422) return ALREADY_APPLIED.test(message) ? "already_applied" : "validation"
  // The server said the dependency is unavailable, so the write was not attempted.
  if (status === 502 || status === 503 || status === 504) return "retryable_transport"
  return "server_failure"
}

function errorMessageFromBody(body: string, fallback: string): string {
  const trimmed = body.trim()
  if (!trimmed) return fallback
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown }
    if (typeof parsed.error === "string" && parsed.error) return parsed.error
  } catch {
    // Plain-text body.
  }
  return trimmed
}

export function workflowErrorFromResponse(status: number, body: string, fallback: string): WorkflowError {
  const message = errorMessageFromBody(body, fallback)
  return new WorkflowError(classifyHttpFailure(status, message), message, { status })
}

/**
 * Normalize anything thrown while executing a command. A rejected fetch gives no response, so a
 * non-idempotent write's outcome is unknown; an idempotent one can simply be retried.
 */
export function toWorkflowError(error: unknown, options?: { idempotent?: boolean }): WorkflowError {
  if (error instanceof WorkflowError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
    return new WorkflowError(options?.idempotent ? "retryable_transport" : "outcome_unknown", message, {
      cause: error,
    })
  }
  return new WorkflowError("server_failure", message, { cause: error })
}
