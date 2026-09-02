
import type { ReducerCommandContractMeta } from "./types";

/**
 * Auth / session / RBAC mutations via Next.js BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` auth hooks.
 * (User invites use `POST /api/auth/invite` — not included here.)
 */
export const AUTH_BFF_REDUCERS = [
  "assign_role",
  "create_audit_rule",
  "create_role",
  "create_sod_conflict_rule",
  "create_user_session",
  "grant_delegated_admin_scope",
  "end_user_session",
  "log_audit_event",
  "record_privacy_consent",
  "remove_user_from_organization",
  "revoke_role",
  "revoke_delegated_admin_scope",
  "update_audit_rule",
  "update_sod_conflict_rule",
  "update_google_drive_credentials",
  "update_org_member_details",
  "update_org_member_role",
  "update_role",
  "update_user_email",
  "update_user_organization_status",
  "update_user_password",
  "update_user_profile",
  "update_whatsapp_credentials",
] as const;

export type AuthBffReducerKey = (typeof AUTH_BFF_REDUCERS)[number];

const AUTH_HINT_OVERRIDES: Partial<Record<AuthBffReducerKey, readonly string[]>> = {
  assign_role: ["auth", "user-roles", "roles"],
  create_audit_rule: ["audit-rules"],
  create_role: ["auth", "roles"],
  create_sod_conflict_rule: ["auth", "roles", "sod-conflict-rules"],
  grant_delegated_admin_scope: ["delegated-admin-scopes"],
  revoke_delegated_admin_scope: ["delegated-admin-scopes"],
  update_sod_conflict_rule: ["auth", "roles", "sod-conflict-rules"],
  create_user_session: ["user-sessions"],
  end_user_session: ["user-sessions"],
  log_audit_event: ["audit-log"],
  record_privacy_consent: [],
  remove_user_from_organization: ["auth", "users"],
  revoke_role: ["auth", "user-roles"],
  update_audit_rule: ["audit-rules"],
  update_google_drive_credentials: ["auth"],
  update_org_member_details: ["auth", "users"],
  update_org_member_role: ["auth", "user-roles", "users"],
  update_role: ["auth", "roles"],
  update_user_email: ["auth"],
  update_user_organization_status: ["auth", "users"],
  update_user_password: ["auth"],
  update_user_profile: ["auth"],
  update_whatsapp_credentials: ["auth"],
};

function authReducerHints(): Record<AuthBffReducerKey, readonly string[]> {
  const o = {} as Record<AuthBffReducerKey, readonly string[]>;
  for (const k of AUTH_BFF_REDUCERS) {
    o[k] = AUTH_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const AUTH_COMMAND_SUBSCRIPTION_HINTS: Record<
  AuthBffReducerKey,
  readonly string[]
> = authReducerHints();

export function authCommandContract(
  reducer: AuthBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Auth reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: AUTH_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
