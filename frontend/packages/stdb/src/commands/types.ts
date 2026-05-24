/**
 * Lightweight metadata for documentation, tooling, and future lint.
 * Command wrappers should attach a `contract` object alongside `call`.
 */
export interface ReducerCommandContractMeta {
  /** Snake-case reducer name as stored in SpacetimeDB. */
  readonly reducerName: string;
  /** Human-readable intent (dev tooling / AI agents). */
  readonly description: string;
  /**
   * Subscription resource keys (see {@link SUBSCRIPTION_RESOURCE_KEYS}) whose mirrors
   * must include rows touched by this reducer for UI to observe effects.
   */
  readonly requiredSubscriptionResources: readonly string[];
  /** Logical tables whose rows may change when this reducer succeeds. */
  readonly affectedTables: readonly string[];
  /** Caller / environment expectations (not enforced here — document only). */
  readonly expectations: string;
}
