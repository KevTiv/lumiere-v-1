import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { u64 } from "./codecs.ts";
import { checkedScope, scopeKey, type ProjectionScope } from "./contracts.ts";
import {
  productCategory,
  projectionDdl,
  projectionFields,
  projectionSchemaHash,
  projectionTable,
  decodeProductCategory,
  type ProductCategory,
} from "./generated/product-category.ts";
import type { SqliteConnection } from "./sqlite.ts";

export type ProjectionChange =
  | { operation: "upsert"; row: ProductCategory }
  | { operation: "delete"; id: string };

/** Application-facing reads only. The sync owner holds the store's write capability. */
export interface CategoryRepository {
  get(id: string): Promise<ProductCategory | null>;
  list(limit?: number): Promise<ProductCategory[]>;
}

function canonicalRow(
  row: typeof productCategory.$inferSelect,
): ProductCategory {
  const { _lumiere_scope: _scope, ...canonical } = row;
  return canonical;
}

export class ProjectionStore {
  readonly scope: Readonly<ProjectionScope>;
  readonly #key: string;
  readonly #connection: SqliteConnection;
  readonly #generation: string;
  readonly repository: CategoryRepository;

  constructor(connection: SqliteConnection, scope: ProjectionScope) {
    this.#connection = connection;
    this.scope = checkedScope(scope);
    this.#key = scopeKey(this.scope);
    this.#initialize();
    this.#generation = this.#readGeneration();
    // Drizzle owns typed reads, while the adapter owns synchronous transaction boundaries.
    const db = drizzle(async (sql, parameters, method) => {
      const rows = connection.all(sql, parameters);
      const values = rows.map((row) => Object.values(row));
      return { rows: method === "get" ? (values[0] ?? []) : values };
    });
    this.repository = Object.freeze({
      get: async (id: string) => {
        this.generation();
        const rows = await db
          .select()
          .from(productCategory)
          .where(
            and(
              eq(productCategory._lumiere_scope, this.#key),
              eq(productCategory.id, u64(id)),
            ),
          )
          .limit(1)
          .all();
        this.generation();
        return rows[0] ? canonicalRow(rows[0]) : null;
      },
      list: async (limit = 100) => {
        this.generation();
        if (!Number.isInteger(limit) || limit < 1 || limit > 200)
          throw new Error("Invalid repository limit");
        const rows = await db
          .select()
          .from(productCategory)
          .where(eq(productCategory._lumiere_scope, this.#key))
          .orderBy(
            asc(productCategory.sequence),
            asc(productCategory.name),
            asc(productCategory.id),
          )
          .limit(limit)
          .all();
        this.generation();
        return rows.map(canonicalRow);
      },
    });
  }

  #initialize(): void {
    this.#connection.transaction(() => {
      this.#connection.exec(
        'CREATE TABLE IF NOT EXISTS "_lumiere_projection_schema" (name TEXT PRIMARY KEY, schema_hash TEXT NOT NULL);',
      );
      const existing = this.#connection.all(
        'SELECT schema_hash FROM "_lumiere_projection_schema" WHERE name = ?',
        [projectionTable],
      )[0];
      if (existing && existing.schema_hash !== projectionSchemaHash)
        throw new Error("Local schema migration required");
      this.#connection.exec(projectionDdl);
      this.#connection.exec(
        'CREATE TABLE IF NOT EXISTS "_lumiere_sync_checkpoint" (scope TEXT PRIMARY KEY, cursor TEXT NOT NULL);',
      );
      this.#connection.exec(
        'CREATE TABLE IF NOT EXISTS "_lumiere_scope_generation" (scope TEXT PRIMARY KEY, generation TEXT NOT NULL);',
      );
      this.#connection.run(
        'INSERT OR IGNORE INTO "_lumiere_scope_generation" (scope, generation) VALUES (?, ?)',
        [this.#key, "0"],
      );
      this.#connection.run(
        'INSERT OR IGNORE INTO "_lumiere_projection_schema" (name, schema_hash) VALUES (?, ?)',
        [projectionTable, projectionSchemaHash],
      );
    });
  }

  checkpoint(): string | null {
    this.generation();
    const row = this.#connection.all(
      'SELECT cursor FROM "_lumiere_sync_checkpoint" WHERE scope = ?',
      [this.#key],
    )[0];
    return row ? u64(row.cursor) : null;
  }

  /** Compare-and-swap protects against competing engines/connections and stale network replies. */
  #readGeneration(): string {
    const row = this.#connection.all(
      'SELECT generation FROM "_lumiere_scope_generation" WHERE scope = ?',
      [this.#key],
    )[0];
    if (!row) throw new Error("Missing local scope generation");
    return u64(row.generation);
  }

  generation(): string {
    if (this.#readGeneration() !== this.#generation)
      throw new Error(
        "Local scope was cleared; reauthenticate before reopening",
      );
    return this.#generation;
  }

  apply(
    generation: string,
    expectedCursor: string | null,
    nextCursor: string,
    changes: readonly ProjectionChange[],
    replace: boolean,
  ): void {
    u64(nextCursor);
    if (
      replace !== (expectedCursor === null) ||
      (expectedCursor !== null &&
        BigInt(nextCursor) < BigInt(u64(expectedCursor)))
    )
      throw new Error("Invalid checkpoint transition");
    if (changes.length > 1000) throw new Error("Invalid projection batch size");
    const checkedChanges: ProjectionChange[] = changes.map((change) => {
      if (change.operation === "delete")
        return { operation: "delete", id: u64(change.id) };
      const row = decodeProductCategory(change.row);
      if (
        row.organization_id !== this.scope.organizationId ||
        (row.company_id !== null && row.company_id !== this.scope.companyId)
      ) {
        throw new Error("Row lies outside projection scope");
      }
      return { operation: "upsert", row };
    });
    this.#connection.transaction(() => {
      if (this.generation() !== generation)
        throw new Error("Local scope changed during synchronization");
      if (this.checkpoint() !== expectedCursor)
        throw new Error("Checkpoint changed; retry synchronization");
      if (replace)
        this.#connection.run(
          `DELETE FROM "${projectionTable}" WHERE "_lumiere_scope" = ?`,
          [this.#key],
        );
      for (const change of checkedChanges) {
        if (change.operation === "delete") {
          this.#connection.run(
            `DELETE FROM "${projectionTable}" WHERE "_lumiere_scope" = ? AND id = ?`,
            [this.#key, change.id],
          );
        } else {
          const names = ["_lumiere_scope", ...projectionFields];
          const columns = names.map((name) => `"${name}"`).join(", ");
          const update = projectionFields
            .filter((field) => field !== "id")
            .map((name) => `"${name}" = excluded."${name}"`)
            .join(", ");
          this.#connection.run(
            `INSERT INTO "${projectionTable}" (${columns}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT ("_lumiere_scope", id) DO UPDATE SET ${update}`,
            [this.#key, ...projectionFields.map((field) => change.row[field])],
          );
        }
      }
      this.#connection.run(
        'INSERT INTO "_lumiere_sync_checkpoint" (scope, cursor) VALUES (?, ?) ON CONFLICT (scope) DO UPDATE SET cursor = excluded.cursor',
        [this.#key, nextCursor],
      );
    });
  }

  /** The host calls this before logout, actor/company changes or observed revocation. */
  clear(): void {
    this.#connection.transaction(() => {
      const nextGeneration = u64((BigInt(this.generation()) + 1n).toString());
      this.#connection.run(
        `DELETE FROM "${projectionTable}" WHERE "_lumiere_scope" = ?`,
        [this.#key],
      );
      this.#connection.run(
        'DELETE FROM "_lumiere_sync_checkpoint" WHERE scope = ?',
        [this.#key],
      );
      this.#connection.run(
        'UPDATE "_lumiere_scope_generation" SET generation = ? WHERE scope = ?',
        [nextGeneration, this.#key],
      );
    });
  }
}
