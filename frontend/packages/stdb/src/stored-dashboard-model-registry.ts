import {
  QUERY_RESOURCE_KEYS,
  RESOURCE_REGISTRY,
  type QueryResourceKey,
} from "./generated/query-registry"

/** Normalize Odoo-style (`sale.order`) and kebab (`sale-order`) model names to SQL table form. */
export function normalizeDashboardModel(model: string): string {
  return model.trim().replace(/\./g, "_").replace(/-/g, "_").toLowerCase()
}

/** Primary query resource for a dashboard widget `model` field. */
export function resolveDashboardModelResourceKey(model: string): QueryResourceKey | null {
  const normalized = normalizeDashboardModel(model)
  if (!normalized) return null

  for (const key of QUERY_RESOURCE_KEYS) {
    const entry = RESOURCE_REGISTRY[key]
    if (!entry) continue
    if (entry.table === normalized) return key
    if (entry.aliases.some((alias) => alias.replace(/-/g, "_") === normalized)) return key
    if (entry.aliases.includes(normalized)) return key
  }

  return null
}

/** All model string aliases that should resolve to the same resource rows. */
export function dashboardModelLookupKeys(model: string): string[] {
  const normalized = normalizeDashboardModel(model)
  const resourceKey = resolveDashboardModelResourceKey(model)
  if (!resourceKey) return normalized ? [normalized, model.trim()] : []

  const entry = RESOURCE_REGISTRY[resourceKey]
  const keys = new Set<string>([normalized, model.trim(), entry.table, resourceKey])
  for (const alias of entry.aliases) {
    keys.add(alias)
    keys.add(alias.replace(/-/g, "_"))
  }
  return [...keys].filter(Boolean)
}

/** Unique resource keys required to hydrate a set of widget model fields. */
export function resourceKeysForDashboardModels(models: string[]): QueryResourceKey[] {
  const keys = new Set<QueryResourceKey>()
  for (const model of models) {
    const key = resolveDashboardModelResourceKey(model)
    if (key) keys.add(key)
  }
  return [...keys]
}

/** Map each query resource key back to its primary SQL table name. */
export function tableNameForResourceKey(resourceKey: QueryResourceKey): string {
  return RESOURCE_REGISTRY[resourceKey]?.table ?? resourceKey.replace(/-/g, "_")
}
