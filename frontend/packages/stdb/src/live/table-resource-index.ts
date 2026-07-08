import {
  QUERY_RESOURCE_KEYS,
  RESOURCE_REGISTRY,
  type QueryResourceKey,
} from "../generated/query-registry"

/** SQL table name → query resource keys backed by that primary table. */
export function buildTableToResourcesIndex(): ReadonlyMap<string, readonly QueryResourceKey[]> {
  const map = new Map<string, QueryResourceKey[]>()
  for (const key of QUERY_RESOURCE_KEYS) {
    const entry = RESOURCE_REGISTRY[key]
    if (!entry?.table) continue
    const list = map.get(entry.table) ?? []
    list.push(key)
    map.set(entry.table, list)
  }
  return map
}

export const TABLE_TO_RESOURCES = buildTableToResourcesIndex()

export function resourcesForTable(table: string): readonly QueryResourceKey[] {
  return TABLE_TO_RESOURCES.get(table) ?? []
}

export function tableAccessorForSqlTable(table: string): string {
  return table.replace(/-/g, "_")
}
