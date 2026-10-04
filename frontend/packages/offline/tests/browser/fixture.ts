import type { ProjectionScope } from "../../src/contracts.ts";
import { projectionSchemaHash } from "../../src/generated/product-category.ts";

export const scope: ProjectionScope = {
  environmentId: "browser-fixture",
  actorId: "actor-a",
  organizationId: "7",
  companyId: "9",
  authorizationVersion: "auth-1",
};
export const row = {
  id: "18446744073709551615",
  organization_id: "7",
  company_id: "9",
  name: "Produce",
  parent_id: null,
  sequence: 1,
};
export const snapshot = {
  kind: "snapshot",
  scope,
  schemaHash: projectionSchemaHash,
  cursor: "10",
  rows: [row],
};
export const pull = {
  kind: "pull",
  scope,
  schemaHash: projectionSchemaHash,
  fromCursor: "10",
  nextCursor: "11",
  hasMore: false,
  changes: [
    {
      sequence: "11",
      operation: "upsert",
      row: { ...row, id: "2", name: "Grain" },
    },
    { sequence: "11", operation: "delete", id: row.id },
  ],
};
