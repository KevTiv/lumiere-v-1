import type { StoredDashboardSourceState } from "@lumiere/ui"

export interface StoredDashboardQueryStateInput {
  isLoading: boolean
  error: unknown
  rowCount: number
}

export type StoredDashboardSourceIssue = {
  kind: "denied" | "query-error"
  resource: string
  message: string
  status?: number
}

export class StoredDashboardQueryError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "StoredDashboardQueryError"
    this.status = status
  }
}

export class StoredDashboardSourceQueryError extends StoredDashboardQueryError {
  readonly resource: string

  constructor(resource: string, status: number, message: string) {
    super(status, message)
    this.name = "StoredDashboardSourceQueryError"
    this.resource = resource
  }
}

export function storedDashboardSourceState(
  input: StoredDashboardQueryStateInput,
): StoredDashboardSourceState {
  if (input.isLoading) return { status: "loading", rowCount: input.rowCount }
  if (input.error) {
    const message =
      input.error instanceof Error ? input.error.message : "Dashboard source query failed."
    if (input.rowCount > 0) return { status: "partial", rowCount: input.rowCount, message }
    if (
      input.error instanceof StoredDashboardQueryError &&
      (input.error.status === 401 || input.error.status === 403)
    ) {
      return { status: "denied", rowCount: 0, message }
    }
    return { status: "unavailable", rowCount: 0, message }
  }
  return { status: input.rowCount === 0 ? "empty" : "ready", rowCount: input.rowCount }
}

export function storedDashboardSourceIssue(error: unknown): StoredDashboardSourceIssue | null {
  if (error == null) return null
  if (error instanceof StoredDashboardSourceQueryError) {
    return {
      kind: error.status === 401 || error.status === 403 ? "denied" : "query-error",
      resource: error.resource,
      message: error.message,
      status: error.status,
    }
  }
  return {
    kind: "query-error",
    resource: "unknown",
    message: error instanceof Error ? error.message : String(error),
  }
}

export function shouldRetryStoredDashboardSource(failureCount: number, error: unknown): boolean {
  const issue = storedDashboardSourceIssue(error)
  return issue?.kind !== "denied" && failureCount < 2
}
