import type { DbConnection } from "../generated"

type TableCallbacks = {
  onInsert: (cb: () => void) => void
  onUpdate?: (cb: () => void) => void
  onDelete: (cb: () => void) => void
  removeOnInsert: (cb: () => void) => void
  removeOnUpdate?: (cb: () => void) => void
  removeOnDelete: (cb: () => void) => void
}

export type TableChangeHandler = (table: string) => void

function tableHandle(conn: DbConnection, table: string): TableCallbacks | null {
  const accessor = table.replace(/-/g, "_")
  const db = conn.db as unknown as Record<string, TableCallbacks | undefined>
  return db[accessor] ?? null
}

/** Accumulates table row callbacks across incremental subscription adds. */
export class TableWireRegistry {
  private readonly wired = new Map<string, { change: () => void; handle: TableCallbacks }>()

  wireMore(
    conn: DbConnection,
    tables: Iterable<string>,
    onTableChange: TableChangeHandler,
  ): void {
    for (const table of tables) {
      if (this.wired.has(table)) continue
      const handle = tableHandle(conn, table)
      if (!handle) continue

      const change = () => {
        onTableChange(table)
      }

      handle.onInsert(change)
      handle.onDelete(change)
      handle.onUpdate?.(change)
      this.wired.set(table, { change, handle })
    }
  }

  dispose(): void {
    for (const { change, handle } of this.wired.values()) {
      handle.removeOnInsert(change)
      handle.removeOnDelete(change)
      handle.removeOnUpdate?.(change)
    }
    this.wired.clear()
  }
}
