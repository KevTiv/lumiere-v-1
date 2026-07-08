import type { DbConnection } from "../generated"
import { RESOURCE_REGISTRY, type QueryResourceKey } from "../generated/query-registry"

type TableCallbacks = {
  onInsert: (cb: () => void) => void
  onUpdate?: (cb: () => void) => void
  onDelete: (cb: () => void) => void
  removeOnInsert: (cb: () => void) => void
  removeOnUpdate?: (cb: () => void) => void
  removeOnDelete: (cb: () => void) => void
}

export type TableChangeHandler = (table: string) => void

export interface WiredTableCallbacks {
  dispose: () => void
}

function tableHandle(conn: DbConnection, table: string): TableCallbacks | null {
  const accessor = table.replace(/-/g, "_")
  const db = conn.db as unknown as Record<string, TableCallbacks | undefined>
  return db[accessor] ?? null
}

/**
 * Register insert/update/delete listeners for subscribed SQL tables.
 * Re-reads affected resource caches on each change (simple + correct for sort/soft-delete).
 */
export function wireSubscriptionTableCallbacks(
  conn: DbConnection,
  tables: Iterable<string>,
  onTableChange: TableChangeHandler,
): WiredTableCallbacks {
  const listeners = new Map<string, { change: () => void; handle: TableCallbacks }>()

  for (const table of tables) {
    if (listeners.has(table)) continue
    const handle = tableHandle(conn, table)
    if (!handle) continue

    const change = () => {
      onTableChange(table)
    }

    handle.onInsert(change)
    handle.onDelete(change)
    handle.onUpdate?.(change)
    listeners.set(table, { change, handle })
  }

  return {
    dispose: () => {
      for (const [, { change, handle }] of listeners) {
        handle.removeOnInsert(change)
        handle.removeOnDelete(change)
        handle.removeOnUpdate?.(change)
      }
      listeners.clear()
    },
  }
}

/** Primary SQL tables for subscribed resource keys. */
export function tablesForSubscribedResources(resources: readonly string[]): string[] {
  const tables = new Set<string>()
  for (const resource of resources) {
    const entry = RESOURCE_REGISTRY[resource as QueryResourceKey]
    if (entry?.table) tables.add(entry.table)
  }
  return [...tables]
}
