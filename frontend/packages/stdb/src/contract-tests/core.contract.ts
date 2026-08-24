/**
 * Compile-only contract checks — must typecheck under `tsc --noEmit`.
 * No runtime assertions; safe to import nowhere from production bundles.
 */
import type { DbConnection } from "../generated";
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs";
import {
  callEnsureDevAdmin,
  ensureDevAdminContract,
  type EnsureDevAdminInput,
} from "../commands/core";

declare const __mockConn: DbConnection;

const _inputMatchesGenerated: EnsureDevAdminInput = {};
const _: OperationInputMap["ensure_dev_admin"] = _inputMatchesGenerated;

void ensureDevAdminContract.reducerName;
void ensureDevAdminContract.requiredSubscriptionResources;

callEnsureDevAdmin(__mockConn, {});
