import { objectValue, u64 } from "./codecs.ts";
import { requireEnvelope, type ProjectionTransport } from "./contracts.ts";
import {
  decodeProductCategory,
  projectionResource,
} from "./generated/product-category.ts";
import { ProjectionStore, type ProjectionChange } from "./projection-store.ts";
import { ProjectionResetError } from "./http-transport.ts";

const MAX_BATCH_SIZE = 1000;

function boundedArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE)
    throw new Error("Invalid projection batch size");
  return value;
}

export interface SyncResult {
  cursor: string;
  changed: number;
  hasMore: boolean;
  /** Notification failure cannot turn a committed batch into a failed sync. */
  notificationError?: unknown;
}

/** One bounded snapshot/page per call. The host owns connectivity, backoff and UI scheduling. */
export class SyncEngine {
  readonly #store: ProjectionStore;
  readonly #transport: ProjectionTransport;
  readonly #onApplied: (resource: string) => void;
  #active: Promise<SyncResult> | undefined;

  constructor(
    store: ProjectionStore,
    transport: ProjectionTransport,
    onApplied: (resource: string) => void = () => {},
  ) {
    this.#store = store;
    this.#transport = transport;
    this.#onApplied = onApplied;
  }

  /** Repeated callers share the same request. Cancellation belongs to its initiating caller. */
  sync(signal?: AbortSignal): Promise<SyncResult> {
    if (!this.#active) {
      this.#active = this.#sync(signal)
        .catch((error: unknown) => {
          if (error instanceof ProjectionResetError) this.#store.clear();
          throw error;
        })
        .finally(() => {
          this.#active = undefined;
        });
    }
    return this.#active;
  }

  #committed(result: SyncResult): SyncResult {
    try {
      this.#onApplied(projectionResource);
      return result;
    } catch (notificationError) {
      return { ...result, notificationError };
    }
  }

  async #sync(signal?: AbortSignal): Promise<SyncResult> {
    signal?.throwIfAborted();
    const generation = this.#store.generation();
    const cursor = this.#store.checkpoint();
    if (cursor === null) {
      const response = await this.#transport.snapshot(
        this.#store.scope,
        signal,
      );
      signal?.throwIfAborted();
      const envelope = requireEnvelope(response, this.#store.scope, "snapshot");
      const nextCursor = u64(envelope.cursor);
      const rows = boundedArray(envelope.rows).map(decodeProductCategory);
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        throw new Error("Duplicate snapshot identity");
      this.#store.apply(
        generation,
        null,
        nextCursor,
        rows.map((row) => ({ operation: "upsert", row })),
        true,
      );
      return this.#committed({
        cursor: nextCursor,
        changed: rows.length,
        hasMore: false,
      });
    }

    const response = await this.#transport.pull(
      this.#store.scope,
      cursor,
      signal,
    );
    signal?.throwIfAborted();
    const envelope = requireEnvelope(response, this.#store.scope, "pull");
    const fromCursor = u64(envelope.fromCursor);
    const nextCursor = u64(envelope.nextCursor);
    if (
      fromCursor !== cursor ||
      BigInt(nextCursor) < BigInt(cursor) ||
      typeof envelope.hasMore !== "boolean"
    ) {
      throw new Error("Invalid pull checkpoint");
    }
    if (envelope.hasMore && nextCursor === cursor)
      throw new Error("Pull made no progress");
    let lastSequence = BigInt(cursor);
    const changes: ProjectionChange[] = boundedArray(envelope.changes).map(
      (value) => {
        if (
          value === null ||
          typeof value !== "object" ||
          !("operation" in value)
        )
          throw new Error("Invalid change");
        if (value.operation !== "upsert" && value.operation !== "delete")
          throw new Error("Unsupported projection operation");
        const change = objectValue(
          value,
          value.operation === "upsert"
            ? ["sequence", "operation", "row"]
            : ["sequence", "operation", "id"],
        );
        const sequence = BigInt(u64(change.sequence));
        if (
          sequence <= BigInt(cursor) ||
          sequence < lastSequence ||
          sequence > BigInt(nextCursor)
        )
          throw new Error("Unordered projection change");
        lastSequence = sequence;
        return value.operation === "upsert"
          ? { operation: "upsert", row: decodeProductCategory(change.row) }
          : { operation: "delete", id: u64(change.id) };
      },
    );
    this.#store.apply(generation, cursor, nextCursor, changes, false);
    return this.#committed({
      cursor: nextCursor,
      changed: changes.length,
      hasMore: envelope.hasMore,
    });
  }
}
