import { objectValue, stringValue, u64 } from "./codecs.ts";
import { projectionSchemaHash } from "./generated/product-category.ts";

/** Supplied by the authenticated host. A cached scope never grants server authority. */
export interface ProjectionScope {
  environmentId: string;
  actorId: string;
  organizationId: string;
  companyId: string | null;
  authorizationVersion: string;
}

export interface Snapshot {
  kind: "snapshot";
  scope: ProjectionScope;
  schemaHash: string;
  cursor: string;
  rows: unknown[];
}

export type Change =
  | { sequence: string; operation: "upsert"; row: unknown }
  | { sequence: string; operation: "delete"; id: string };

export interface PullBatch {
  kind: "pull";
  scope: ProjectionScope;
  schemaHash: string;
  fromCursor: string;
  nextCursor: string;
  changes: Change[];
  hasMore: boolean;
}

/** Implementations must reauthorize every request and return a consistent snapshot watermark.
 * A realtime invalidation socket is not an implementation of this durable replay port.
 */
export interface ProjectionTransport {
  snapshot(scope: ProjectionScope, signal?: AbortSignal): Promise<unknown>;
  pull(
    scope: ProjectionScope,
    cursor: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export function checkedScope(value: unknown): Readonly<ProjectionScope> {
  const scope = objectValue(value, [
    "environmentId",
    "actorId",
    "organizationId",
    "companyId",
    "authorizationVersion",
  ]);
  const result: ProjectionScope = {
    environmentId: stringValue(scope.environmentId),
    actorId: stringValue(scope.actorId),
    organizationId: u64(scope.organizationId),
    companyId: scope.companyId === null ? null : u64(scope.companyId),
    authorizationVersion: stringValue(scope.authorizationVersion),
  };
  if (!result.environmentId || !result.actorId || !result.authorizationVersion)
    throw new Error("Incomplete projection scope");
  return Object.freeze(result);
}

export function scopeKey(scope: ProjectionScope): string {
  return JSON.stringify([
    scope.environmentId,
    scope.actorId,
    scope.organizationId,
    scope.companyId,
    scope.authorizationVersion,
    projectionSchemaHash,
  ]);
}

export function requireEnvelope(
  value: unknown,
  scope: ProjectionScope,
  kind: "snapshot" | "pull",
): Record<string, unknown> {
  const fields =
    kind === "snapshot"
      ? ["kind", "scope", "schemaHash", "cursor", "rows"]
      : [
          "kind",
          "scope",
          "schemaHash",
          "fromCursor",
          "nextCursor",
          "changes",
          "hasMore",
        ];
  const envelope = objectValue(value, fields);
  if (
    envelope.kind !== kind ||
    envelope.schemaHash !== projectionSchemaHash ||
    scopeKey(checkedScope(envelope.scope)) !== scopeKey(scope)
  ) {
    throw new Error("Projection scope or schema mismatch; resnapshot required");
  }
  return envelope;
}
