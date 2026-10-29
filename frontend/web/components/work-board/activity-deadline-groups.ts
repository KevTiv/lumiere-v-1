export type ActivityDeadlineGroup = "overdue" | "today" | "upcoming" | "undated" | "unavailable" | "completed"

/** Activity deadlines are calendar dates, not midnight instants. Hidden dates remain unavailable. */
export function activityDeadlineGroup(row: { isDone: boolean; dateDeadline?: string | null }, now: Date): ActivityDeadlineGroup {
  if (row.isDone) return "completed"
  const value = row.dateDeadline
  if (value === null || value === "") return "undated"
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "unavailable"
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(year!, month! - 1, day!)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month! - 1 || parsed.getDate() !== day) return "unavailable"
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  return value < today ? "overdue" : value === today ? "today" : "upcoming"
}

export const ACTIVITY_DEADLINE_GROUPS = ["overdue", "today", "upcoming", "undated", "unavailable", "completed"] as const

/** Groups the loaded authorized rows only; does not claim chronological server pagination. */
export function groupActivityDeadlines<Row extends { isDone: boolean; dateDeadline?: string | null }>(rows: readonly Row[], now: Date) {
  return ACTIVITY_DEADLINE_GROUPS.map((id) => ({
    id,
    rows: rows.filter((row) => activityDeadlineGroup(row, now) === id).sort((a, b) => (a.dateDeadline ?? "").localeCompare(b.dateDeadline ?? "")),
  })).filter((group) => group.rows.length > 0)
}
