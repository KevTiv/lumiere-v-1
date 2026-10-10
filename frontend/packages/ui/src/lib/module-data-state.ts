export type ModuleDataState =
  | { status: "ready" | "loading" }
  | { status: "error" | "denied" | "partial"; message?: string; onRetry?: () => void }

/** Retain stale rows only for a concrete server failure; authorization and unknown failures close the view. */
export function moduleQueryState(query: {
  isLoading: boolean
  isError: boolean
  error?: unknown
  data?: readonly unknown[]
  refetch: () => unknown
}): ModuleDataState {
  const status = query.error && typeof query.error === "object" && "status" in query.error
    ? query.error.status : undefined
  if (query.isError && (status === 401 || status === 403)) return { status: "denied" }
  if (query.isError) return {
    // Unknown failures may represent revoked access, so only a concrete server failure
    // may retain cached rows. Never infer authorization from an error message.
    status: typeof status === "number" && status >= 500 && query.data?.length ? "partial" : "error",
    onRetry: () => { void query.refetch() },
  }
  return { status: query.isLoading ? "loading" : "ready" }
}
