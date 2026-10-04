export type { CategoryRepository } from "./projection-store.ts";
export { ProjectionStore } from "./projection-store.ts";
export { SyncEngine, type SyncResult } from "./sync-engine.ts";
export {
  connectCategoryTransport,
  ProjectionResetError,
  ProjectionUnavailableError,
  type HttpProjectionOptions,
} from "./http-transport.ts";
export type {
  Change,
  ProjectionScope,
  ProjectionTransport,
  PullBatch,
  Snapshot,
} from "./contracts.ts";
export type { SqliteConnection, SqlValue } from "./sqlite.ts";
export {
  projectionResource,
  projectionSchemaHash,
  type ProductCategory,
} from "./generated/product-category.ts";
