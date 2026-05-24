import { authSubscriptions } from "../queries/auth";
import type { SubscriptionQueryContext } from "../queries/erp-subscriptions";

/**
 * Tables covered by the `auth` subscription bundle (see `authSubscriptions` SQL).
 * UI observers rely on these mirrors after session bootstrap / `ensure_dev_admin`.
 */
export const SESSION_WORKSPACE_TABLES = [
  "user_profile",
  "user_role_assignment",
  "role",
  "user_organization",
  "casbin_rule",
] as const;

/**
 * Resource keys to pass to `createClientSubscriptions` (`queries/erp-subscriptions`) for session/auth workspace intent.
 * Compose with org-scoped keys (e.g. `contacts`, `leads`) at the app layer.
 */
export const SESSION_WORKSPACE_RESOURCE_KEYS = ["auth"] as const;

export type SessionWorkspaceSubscriptionContext = Pick<
  SubscriptionQueryContext,
  "identityHex" | "roleNames" | "organizationId"
>;

/**
 * SQL fragments for WebSocket subscribe — equivalent to resource key `"auth"`.
 */
export function sessionWorkspaceSubscriptionSql(
  ctx: SessionWorkspaceSubscriptionContext,
): string[] {
  return authSubscriptions(ctx.identityHex, ctx.roleNames, ctx.organizationId);
}
