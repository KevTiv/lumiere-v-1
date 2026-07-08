import type { QueryClient, QueryKey } from "@tanstack/react-query"
import type { DbConnection } from "../generated"
import type { QueryResourceKey } from "../generated/query-registry"
import { RESOURCE_REGISTRY } from "../generated/query-registry"
import {
  filterRowsForResource,
  normalizeRow,
  type ResourceScopeContext,
} from "./projection"
import { tableAccessorForSqlTable } from "./table-resource-index"

export type QueryKeyFactory = (
  resource: string,
  organizationId: bigint | number,
) => readonly QueryKey[]

type TableHandle = {
  iter: () => Iterable<unknown>
}

export function readTableRows(conn: DbConnection, table: string): Record<string, unknown>[] {
  const accessor = tableAccessorForSqlTable(table)
  const db = conn.db as unknown as Record<string, TableHandle | undefined>
  const handle = db[accessor]
  if (!handle?.iter) return []
  return Array.from(handle.iter()).map(normalizeRow)
}

export function buildResourceRows(
  resource: QueryResourceKey,
  conn: DbConnection,
  ctx: ResourceScopeContext,
): Record<string, unknown>[] {
  const reg = RESOURCE_REGISTRY[resource]
  if (!reg?.table) return []
  const raw = readTableRows(conn, reg.table)
  return filterRowsForResource(resource, raw, ctx)
}

export function seedResourceCache(
  qc: QueryClient,
  resource: QueryResourceKey,
  organizationId: number,
  rows: Record<string, unknown>[],
  keysFor: QueryKeyFactory,
): void {
  for (const queryKey of keysFor(resource, organizationId)) {
    qc.setQueryData(queryKey, rows)
  }
}

export function seedSubscribedResources(
  qc: QueryClient,
  conn: DbConnection,
  ctx: ResourceScopeContext,
  resources: readonly string[],
  keysFor: QueryKeyFactory,
): void {
  for (const resource of resources) {
    const key = resource as QueryResourceKey
    if (!RESOURCE_REGISTRY[key]) continue
    const rows = buildResourceRows(key, conn, ctx)
    seedResourceCache(qc, key, ctx.organizationId, rows, keysFor)
  }
}

export function refreshResourcesForTable(
  qc: QueryClient,
  conn: DbConnection,
  ctx: ResourceScopeContext,
  table: string,
  resourceKeys: readonly QueryResourceKey[],
  keysFor: QueryKeyFactory,
): void {
  for (const resource of resourceKeys) {
    const reg = RESOURCE_REGISTRY[resource]
    if (!reg || reg.table !== table) continue
    const rows = buildResourceRows(resource, conn, ctx)
    seedResourceCache(qc, resource, ctx.organizationId, rows, keysFor)
  }
}
