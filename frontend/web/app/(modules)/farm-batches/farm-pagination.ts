import { farmBatchPath, farmRecordId } from "./farm-batch-model"

type Search = Pick<URLSearchParams, "get" | "getAll">

export function farmPageCursors(search: Search, scope: string): string[] {
  if (search.get("listScope") !== scope) return []
  const cursors = search.getAll("beforeId")
  return cursors.every(farmRecordId) ? cursors : []
}

export function farmPageHref(
  scope: string,
  cursors: string[],
  path = farmBatchPath,
): string {
  if (!cursors.length) return path
  const params = new URLSearchParams({ listScope: scope })
  for (const cursor of cursors) params.append("beforeId", cursor)
  return `${path}?${params}`
}
