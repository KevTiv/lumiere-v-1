export const IMPORT_TASK_VIEWS = [
  "sources",
  "decisions",
  "preview",
  "results",
] as const
export type ImportTaskView = (typeof IMPORT_TASK_VIEWS)[number]

export type ImportTaskLocation = {
  taskId: string
  companyId: number
  view: ImportTaskView
  reviewId?: string
}

export function isImportTaskView(value: unknown): value is ImportTaskView {
  return IMPORT_TASK_VIEWS.some((view) => view === value)
}

function validLocation(location: ImportTaskLocation): boolean {
  return (
    /^[a-f0-9]{32}$/.test(location.taskId) &&
    Number.isSafeInteger(location.companyId) &&
    location.companyId > 0 &&
    isImportTaskView(location.view) &&
    (location.reviewId === undefined || /^[1-9]\d*$/.test(location.reviewId))
  )
}

/** A saved task link never silently changes the active company. */
export function readImportTaskLocation(
  search: string,
  companyId: number,
): ImportTaskLocation | null {
  const params = new URLSearchParams(search)
  if (params.get("importCompany") !== String(companyId)) return null
  const view = params.get("importView")
  const location: ImportTaskLocation = {
    taskId: params.get("importTask") ?? "",
    companyId,
    view: isImportTaskView(view) ? view : "sources",
    ...(params.get("sourceReviewCompany") === String(companyId) &&
    params.get("sourceReview")
      ? { reviewId: params.get("sourceReview")! }
      : {}),
  }
  return validLocation(location) ? location : null
}

/** Preserve unrelated module filters when changing the view inside an import task. */
export function withImportTaskLocation(
  url: URL,
  location: ImportTaskLocation,
): URL {
  if (!validLocation(location))
    throw new Error("A valid saved import and company are required.")
  const next = new URL(url)
  next.searchParams.set("importTask", location.taskId)
  next.searchParams.set("importCompany", String(location.companyId))
  next.searchParams.set("importView", location.view)
  next.searchParams.delete("sourceReviewItem")
  next.searchParams.delete("sourceReviewRevision")
  if (location.reviewId) {
    next.searchParams.set("sourceReview", location.reviewId)
    next.searchParams.set("sourceReviewCompany", String(location.companyId))
  } else {
    next.searchParams.delete("sourceReview")
    next.searchParams.delete("sourceReviewCompany")
  }
  return next
}

export function importTaskHref(location: ImportTaskLocation): string {
  const url = withImportTaskLocation(
    new URL("/settings?section=imports", "https://lumiere.invalid"),
    location,
  )
  return url.pathname + url.search + "#import-task"
}
