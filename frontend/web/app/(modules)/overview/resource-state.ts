import type { QueryResourceState } from "@lumiere/api-client"

export type OverviewResourceStatus = QueryResourceState<unknown>["status"] | "loading"
export type OverviewInitialStates = Partial<Record<string, QueryResourceState<unknown>>>

/** Client success supersedes SSR. Errors never authorize stale/empty metrics. */
export function overviewResourceStatus(
  query: { status: "pending" | "error" | "success" },
  initial?: QueryResourceState<unknown>,
): OverviewResourceStatus {
  if (query.status === "success") return "ready"
  if (initial?.status === "denied") return "denied"
  if (query.status === "error") return "unavailable"
  if (initial?.status === "unavailable") return "unavailable"
  return "loading"
}

export function resourceStatusLabel(status: OverviewResourceStatus): string | undefined {
  switch (status) {
    case "ready":
    case "empty": return undefined
    case "denied": return "Access denied"
    case "unavailable": return "Unavailable"
    case "loading": return "Loading"
  }
}

export function combinedResourceStatus(...statuses: OverviewResourceStatus[]): OverviewResourceStatus {
  return statuses.find((status) => status === "denied")
    ?? statuses.find((status) => status === "unavailable")
    ?? statuses.find((status) => status === "loading")
    ?? "ready"
}
