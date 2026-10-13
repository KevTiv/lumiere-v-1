import type { StoredDashboardSourceState } from "@lumiere/ui"

export interface StoredDashboardQueryStateInput {
  isLoading: boolean
  error: unknown
  rowCount: number
}

export class StoredDashboardQueryError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "StoredDashboardQueryError"
    this.status = status
  }
}

export function storedDashboardSourceState(
  input: StoredDashboardQueryStateInput,
): StoredDashboardSourceState {
  if (input.isLoading) return { status: "loading", rowCount: input.rowCount }
  if (input.error) {
    const message = input.error instanceof Error ? input.error.message : "Dashboard source query failed."
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
