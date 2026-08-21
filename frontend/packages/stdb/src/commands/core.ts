import type { DbConnection } from "../generated";
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs";
import type { ReducerCommandContractMeta } from "./types";

export type EnsureDevAdminInput = OperationInputMap["ensure_dev_admin"];

/** Stable facade over generated `EnsureDevAdminParams` (currently `{}`). */
export function normalizeEnsureDevAdminInput(
  input?: EnsureDevAdminInput,
): EnsureDevAdminInput {
  return input ?? {};
}

/**
 * Dev-only bootstrap: provisions caller into first org with owner role (see SpacetimeDB `ensure_dev_admin`).
 */
export const ensureDevAdminContract = {
  reducerName: "ensure_dev_admin",
  description:
    "Ensures minimal dev org exists and caller is owner (memberships, org permissions, superuser profile flag).",
  requiredSubscriptionResources: ["auth"],
  affectedTables: [
    "organization",
    "company",
    "role",
    "user_organization",
    "user_role_assignment",
    "org_permission",
    "field_permission",
    "user_profile",
  ],
  expectations:
    "Caller must be authenticated WebSocket identity. Intended for local/dev when NEXT_PUBLIC_DEV_ADMIN_* flags are set — not a production onboarding path.",
} satisfies ReducerCommandContractMeta;

export function callEnsureDevAdmin(
  conn: DbConnection,
  input: EnsureDevAdminInput = {},
): void {
  conn.reducers.ensureDevAdmin(normalizeEnsureDevAdminInput(input));
}
