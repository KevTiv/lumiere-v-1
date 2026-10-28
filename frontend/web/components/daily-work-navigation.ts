/** Carry only the existing work-board presentation parameters into the full workspace. */
export function dailyWorkHref(params: Pick<URLSearchParams, "get">): string {
  const next = new URLSearchParams()
  for (const key of ["workScope", "workSource", "workView", "workTeam", "workLayout"]) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  const query = next.toString()
  return query ? `/tasks?${query}` : "/tasks"
}
