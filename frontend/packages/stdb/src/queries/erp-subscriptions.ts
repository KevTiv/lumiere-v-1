import { authSubscriptions } from "./auth";
import {
  compileOrganizationSubscription,
  GENERATED_ORG_SUBSCRIPTION_RESOURCE_KEYS,
} from "./subscription-compiler";
import type { QueryResourceKey } from "../generated/query-registry";
export {
  SUBSCRIPTION_RESOURCE_KEYS,
  type SubscriptionResourceKey,
} from "../generated/subscription-descriptors";
import {
  type FieldAccessContext,
  hasHrPermission,
  identitySqlLiteral,
  resolveHttpSqlColumns,
  selectFieldPermissionsForOrgSql,
  selectRolesActiveSql,
  selectUserRoleAssignmentsForIdentitySql,
  sqlColumnListForGeneratedType,
} from "../field-policy";

/** Context for building subscription SQL (org + identity where needed). */
export interface SubscriptionQueryContext {
  organizationId?: number;
  /**
   * Company row ids for this organization (from e.g. RSC `serverFetchQueryList('companies')`).
   * Required for WebSocket SQL on resources that scope by `company_id` without `organization_id`
   * (fixed assets, intercompany, etc.) — SpacetimeDB HTTP/SQL does not support `IN (SELECT …)`.
   */
  companyIds?: readonly number[];
  /** Required for `user-roles` resource. */
  identityHex?: string;
  /** Passed to {@link authSubscriptions} when resource is `auth`. */
  roleNames?: string[];
  /** When set (e.g. from `my-employee` query), scopes `direct-reports` without subqueries. */
  managerEmployeeId?: number;
  /** When set (e.g. from the same sources as `/api/query`), subscription SQL matches API column projection. */
  fieldAccess?: FieldAccessContext;
}

/** CRM tables are private in SpacetimeDB and may only be read through the BFF. */
const PRIVATE_CRM_RESOURCES = new Set([
  "leads",
  "lead-sources",
  "lead-lost-reasons",
  "opportunities",
  "opportunity-stages",
  "opportunity-lines",
  "opportunity-presence",
  "contacts",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-tags",
  "contact-tag-assignments",
  "contact-categories",
  "contact-category-assignments",
  "contact-segments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "assignment-rules",
  "activities",
  "calendar-events",
  "utm-campaigns",
  "utm-media",
  "utm-sources",
  "privacy-consent",
  "contact-communication-preferences",
  "crm-forecast-snapshots",
  "lead-scores",
  "lead-score-factors",
  "contact-segment-rules",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
])


function authSelectAll(table: string, typeName: string): string {
  const cols = sqlColumnListForGeneratedType(typeName).join(", ");
  return `SELECT ${cols} FROM ${table}`;
}

const AUTH_SINGLE: Record<string, string> = {
  "user-profile": authSelectAll("user_profile", "UserProfile"),
  "user-role-assignment": authSelectAll("user_role_assignment", "UserRoleAssignment"),
  /** Full `role` table (matches auth bundle); for active-only use `roles`. */
  "auth-role-table": authSelectAll("role", "Role"),
  "user-organization": authSelectAll("user_organization", "UserOrganization"),
};
/** Resources scoped by `company_id` lists (no SQL subqueries). */
function companyIdsEqualityOr(column: string, ids: readonly number[]): string {
  return ids.map((id) => `${column} = ${id}`).join(" OR ")
}

function companyIdsDualFieldOr(colA: string, colB: string, ids: readonly number[]): string {
  return `(${companyIdsEqualityOr(colA, ids)}) OR (${companyIdsEqualityOr(colB, ids)})`
}

function subscriptionSqlForCompanyScopedResource(
  resource: string,
  ctx: SubscriptionQueryContext,
): string[] | null | undefined {
  const ids = ctx.companyIds
  const fa = ctx.fieldAccess
  const crmOptionalCompanyTables: Record<string, string> = {
    contacts: "contact",
    opportunities: "opportunity",
    "contact-phone-identities": "contact_phone_identity",
    "contact-role-assignments": "contact_role_assignment",
    "contact-communication-preferences": "contact_communication_preference",
  }
  const crmRequiredCompanyTables: Record<string, string> = {
    "contact-duplicate-candidates": "contact_duplicate_candidate",
    "crm-forecast-snapshots": "crm_forecast_snapshot",
  }
  const crmIndirectCompanyResources = new Set([
    "opportunity-lines",
    "opportunity-presence",
    "contact-tag-assignments",
    "contact-category-assignments",
    "segment-members",
    "contact-relationships",
    "privacy-consent",
    "contact-relationship-insights",
    "crm-conversations",
    "crm-conversation-messages",
  ])
  const purchasingCompanyTables: Record<string, string> = {
    "purchase-orders": "purchase_order",
    "purchase-orders-to-approve": "purchase_order",
    "purchase-orders-partial-receipt": "purchase_order",
    "purchase-order-lines": "purchase_order_line",
    "purchase-order-lines-over-billed": "purchase_order_line",
    "landed-costs": "stock_landed_cost",
    // "landed-cost-lines" deliberately excluded: `stock_landed_cost_lines`
    // has no `company_id` column at all (only `organization_id` and
    // `landed_cost_id` — company is inherited via the parent
    // `stock_landed_cost` row). This map's `company_id = <n>` filter was a
    // real "column not in scope" SQL error, not an enum/Option dialect gap.
    // Falls through to the generated organization-scoped descriptor.
    // "partner-banks" deliberately excluded: `res_partner_bank.company_id` is
    // `Option<u64>`, and this map's `company_id = <n>` filter rejects it the
    // same way an enum-literal comparison is rejected. It falls through to
    // the generated organization-scoped descriptor instead (see below).
    "purchase-requisitions": "purchase_requisition",
    "purchase-requisition-lines": "purchase_requisition_line",
    "purchase-rfqs": "purchase_rfq",
    "purchase-rfq-lines": "purchase_rfq_line",
    "purchase-rfq-bids": "purchase_rfq_bid",
    "purchase-returns": "purchase_return",
    "purchase-return-lines": "purchase_return_line",
    "purchase-blanket-orders": "purchase_blanket_order",
    "purchase-blanket-order-lines": "purchase_blanket_order_line",
    "purchase-blanket-releases": "purchase_blanket_release",
    "purchase-contracts": "purchase_contract",
    "vendor-scorecards": "vendor_scorecard",
    "vendor-risk-flags": "vendor_risk_flag",
    "consignment-agreements": "consignment_agreement",
    "purchase-approval-delegates": "purchase_approval_delegate",
    "commodity-price-indexes": "commodity_price_index",
    "purchasing-integration-intents": "purchasing_integration_intent",
  }

  const purchasingTable = purchasingCompanyTables[resource]
  if (purchasingTable) {
    if (ctx.organizationId == null || ids?.length !== 1) return null
    const companyId = ids[0]
    const columns = resolveHttpSqlColumns(resource as QueryResourceKey, fa).join(", ")
    return [
      `SELECT ${columns} FROM ${purchasingTable} WHERE organization_id = ${ctx.organizationId} AND company_id = ${companyId}`,
    ]
  }

  const crmOptionalTable = crmOptionalCompanyTables[resource]
  if (crmOptionalTable) {
    if (ctx.organizationId == null || ids?.length !== 1) return null
    // SpacetimeDB SQL cannot express `company_id IS NULL` against an
    // `Option<u64>` column (rejected outright — see the `timesheets-to-validate`
    // fix above for the same class of engine limitation). A broken query in
    // this initial multi-table subscribe batch fails the whole subscription
    // (see `onError` in `stdb/src/context.tsx`), so this was silently
    // breaking every subscribed table's live updates, not just this one.
    // Subscribe org-wide instead; `projection.ts`'s `CRM_OPTIONAL_COMPANY_RESOURCES`
    // filter already narrows to `company_id === ids[0] || company_id == null`
    // client-side, so this preserves the exact same effective row set.
    const columns = resolveHttpSqlColumns(resource as QueryResourceKey, fa).join(", ")
    return [
      `SELECT ${columns} FROM ${crmOptionalTable} WHERE organization_id = ${ctx.organizationId}`,
    ]
  }

  const crmRequiredTable = crmRequiredCompanyTables[resource]
  if (crmRequiredTable) {
    if (ctx.organizationId == null || ids?.length !== 1) return null
    const companyId = ids[0]
    const columns = resolveHttpSqlColumns(resource as QueryResourceKey, fa).join(", ")
    return [
      `SELECT ${columns} FROM ${crmRequiredTable} WHERE organization_id = ${ctx.organizationId} AND company_id = ${companyId}`,
    ]
  }

  // These rows inherit company ownership from a parent. SpacetimeDB subscription SQL
  // cannot JOIN or use a subquery, so a direct public client subscription would expose
  // cross-company rows before projection. Use the authorized HTTP read path instead.
  if (crmIndirectCompanyResources.has(resource)) return null

  // `organization_id` is `Option<u64>` on account_asset, intercompany_rule,
  // intercompany_transaction, and account_asset_depreciation_line —
  // SpacetimeDB SQL rejects `=` against an `Option<T>` column in every
  // casing (same engine gap as sale-orders-to-approve). `company.id` is a
  // single global auto-increment primary key, so filtering by the org's
  // company IDs alone (dropping the org filter) is equally precise, not
  // just a workaround. `ctx.organizationId == null` guards are kept because
  // company-ID resolution above still needs an org context.
  if (resource === "fixed-assets") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("fixed-assets", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_asset WHERE ${filter}`]
  }
  if (resource === "intercompany-rules") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("intercompany-rules", fa).join(", ")
    const filter = companyIdsDualFieldOr("source_company_id", "destination_company_id", ids)
    return [`SELECT ${c} FROM intercompany_rule WHERE ${filter} ORDER BY sequence ASC`]
  }
  if (resource === "intercompany-transactions") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("intercompany-transactions", fa).join(", ")
    const filter = companyIdsDualFieldOr("origin_company_id", "destination_company_id", ids)
    return [`SELECT ${c} FROM intercompany_transaction WHERE ${filter} ORDER BY id DESC`]
  }
  if (resource === "depreciation-lines") {
    // Both tenant fields are optional and unfilterable in subscription SQL.
    // Keep the resource on the authorized HTTP path.
    return null
  }
  if (resource === "pos-configs") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("pos-configs", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM pos_config WHERE ${filter} ORDER BY name ASC`]
  }
  if (resource === "picking-batches") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("picking-batches", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM stock_picking_batch WHERE ${filter}`]
  }
  if (resource === "delivery-carriers") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("delivery-carriers", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM delivery_carrier WHERE ${filter} ORDER BY sequence ASC`]
  }
  if (resource === "delivery-price-rules") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("delivery-price-rules", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM delivery_price_rule WHERE ${filter}`]
  }
  if (resource === "shipping-methods") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("shipping-methods", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM shipping_method WHERE ${filter} ORDER BY name ASC`]
  }
  if (resource === "ai-document-processing-jobs") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("ai-document-processing-jobs", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM ai_document_processing_job WHERE ${filter}`]
  }
  if (resource === "ai-insights") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("ai-insights", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM ai_insight WHERE ${filter}`]
  }
  if (resource === "pos-payment-methods") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("pos-payment-methods", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM pos_payment_method WHERE ${filter} ORDER BY sequence ASC`]
  }
  if (resource === "pos-sessions") {
    // Child of pos_config — no SQL subqueries; load pos-sessions via api-server query instead.
    return null
  }
  // Same `organization_id: Option<u64>` gap as the fixed-assets block above.
  if (resource === "fiscal-years") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("fiscal-years", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_fiscal_year WHERE ${filter}`]
  }
  if (resource === "account-periods") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("account-periods", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_period WHERE ${filter}`]
  }
  if (resource === "consolidation-elimination-entries") {
    if (ctx.organizationId == null || !ids?.length) return null
    const c = resolveHttpSqlColumns("consolidation-elimination-entries", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM consolidation_elimination_entry WHERE ${filter}`]
  }
  // These resources expose only unfilterable optional/vector tenant fields.
  // Do not widen a subscription across organizations.
  if (resource === "consolidation-journals") {
    return null
  }
  if (resource === "consolidation-accounts") {
    return null
  }
  return undefined
}

/**
 * Returns subscription SQL for a single resource key.
 * - Most ERP keys require `organizationId`.
 * - `roles` is global (no org).
 * - `user-roles` requires `identityHex` (matches api-server user-roles query scope).
 * @returns `null` if the resource is unknown or required context is missing.
 */
export function subscriptionQueriesForResource(
  resource: string,
  ctx: SubscriptionQueryContext,
): string[] | null {
  const r = resource.trim();
  if (!r) return null;

  if (r === "auth") {
    return authSubscriptions(ctx.identityHex, ctx.roleNames, ctx.organizationId);
  }

  if (AUTH_SINGLE[r] !== undefined) {
    return [AUTH_SINGLE[r]];
  }

  if (PRIVATE_CRM_RESOURCES.has(r)) return null;

  // These Purchasing resources cannot be scoped safely in subscription SQL:
  // partner-bank company ownership is optional, while landed-cost lines inherit
  // company ownership from their parent. Keep realtime fail-closed and read them
  // through the BFF, which applies the required row/parent filtering.
  if (r === "partner-banks" || r === "landed-cost-lines") return null;

  if (r === "roles") {
    return [selectRolesActiveSql(ctx.fieldAccess)];
  }

  /** Org-scoped roots only; child tables used `IN (SELECT …)` which SpacetimeDB SQL rejects. */
  if (r === "form-configuration") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) {
      return null;
    }
    const id = String(org);
    const fc = sqlColumnListForGeneratedType("FormConfig").join(", ");
    const ucf = sqlColumnListForGeneratedType("UserCustomField").join(", ");
    return [
      `SELECT ${fc} FROM form_config WHERE organization_id = ${id}`,
      `SELECT ${ucf} FROM user_custom_field WHERE organization_id = ${id}`,
    ];
  }

  if (r === "user-roles") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    return [selectUserRoleAssignmentsForIdentitySql(ctx.identityHex, ctx.fieldAccess)];
  }

  if (r === "my-employee") {
    // `user_id` is Option<Identity>, which the live subscription dialect cannot
    // compare. A self-only authorization predicate must never be broadened.
    return null;
  }

  if (r === "direct-reports") {
    // `parent_id` is optional and cannot be compared in subscription SQL.
    return null;
  }

  // H1: org-wide employees only for HR roles; others get self (same as my-employee).
  if (r === "employees") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const cols = resolveHttpSqlColumns("employees", ctx.fieldAccess).join(", ");
    const canListAll =
      hasHrPermission(ctx.fieldAccess, "hr_employee", "read") ||
      hasHrPermission(ctx.fieldAccess, "hr_employee", "create") ||
      hasHrPermission(ctx.fieldAccess, "hr_employee", "update") ||
      hasHrPermission(ctx.fieldAccess, "hr_employee", "view_pii");
    if (!canListAll) return null;
    return [
      `SELECT ${cols} FROM hr_employee WHERE organization_id = ${Number(org)} AND is_active = true`,
    ];
  }

  if (r === "employee-documents") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const cols = resolveHttpSqlColumns("employee-documents", ctx.fieldAccess).join(", ");
    let extra = " AND active = true";
    if (!hasHrPermission(ctx.fieldAccess, "hr_employee", "view_pii")) {
      extra += " AND purpose != 'tax_id' AND purpose != 'identity'";
    }
    return [
      `SELECT ${cols} FROM hr_employee_document WHERE organization_id = ${Number(org)}${extra}`,
    ];
  }

  // Pilot ACL = owner-only on both WS and HTTP (not full `read_access_ids`).
  // Folder: unrestricted OR caller is owner — SQL cannot express Vec<Identity> membership.
  if (r === "document-folders") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const idLit = identitySqlLiteral(ctx.identityHex);
    const cols = resolveHttpSqlColumns("document-folders", ctx.fieldAccess).join(", ");
    return [
      `SELECT ${cols} FROM doc_folder WHERE organization_id = ${Number(org)} AND (is_access_restricted = false OR owner_id = ${idLit})`,
    ];
  }

  // Pilot ACL = owner-only on both WS and HTTP (match query_exec / erp_subscriptions.rs).
  if (r === "documents" || r === "documents-deleted") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const idLit = identitySqlLiteral(ctx.identityHex);
    const cols = resolveHttpSqlColumns(r, ctx.fieldAccess).join(", ");
    const deleted = r === "documents-deleted" ? "true" : "false";
    return [
      `SELECT ${cols} FROM document WHERE organization_id = ${Number(org)} AND is_deleted = ${deleted} AND owner_id = ${idLit}`,
    ];
  }

  // Pilot ACL = owner-only. `document_version` has no `owner_id`; SpacetimeDB SQL
  // cannot JOIN/subquery parent `document.owner_id`. Filter by `created_by` (version
  // author) — under owner-only docs the owner creates versions.
  if (r === "document-versions") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const idLit = identitySqlLiteral(ctx.identityHex);
    const cols = resolveHttpSqlColumns("document-versions", ctx.fieldAccess).join(", ");
    return [
      `SELECT ${cols} FROM document_version WHERE organization_id = ${Number(org)} AND created_by = ${idLit}`,
    ];
  }

  if (r === "field-permissions") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) {
      return null;
    }
    return [selectFieldPermissionsForOrgSql(Number(org))];
  }

  if (r === "org-permissions") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) {
      return null;
    }
    return [
      `SELECT id, organization_id, subject, role_id, resource, action, effect, created_by, created_at FROM org_permission WHERE organization_id = ${Number(org)}`,
    ];
  }

  if (r === "policy-snapshots") {
    const org = ctx.organizationId;
    if (
      org === undefined ||
      org === null ||
      Number.isNaN(Number(org)) ||
      !ctx.identityHex ||
      ctx.identityHex === "unknown"
    ) {
      return null;
    }
    const id = ctx.identityHex.toLowerCase();
    return [
      `SELECT id, organization_id, user_identity, role_id, role_name, role_permissions, org_permission_grants, field_permissions, is_superuser, version_hash, refreshed_at FROM policy_snapshot WHERE organization_id = ${Number(org)} AND user_identity = 0x${id}`,
    ];
  }

  const org = ctx.organizationId;
  if (org === undefined || org === null || Number.isNaN(Number(org))) {
    return null;
  }

  const companyScoped = subscriptionSqlForCompanyScopedResource(r, ctx);
  if (companyScoped !== undefined) return companyScoped;

  const compiled = compileOrganizationSubscription(r, Number(org), ctx.fieldAccess);
  return compiled === null ? null : [compiled];
}

const EXTRA_COMPANY_SCOPED_ERP_KEYS = [
  "fixed-assets",
  "depreciation-lines",
  "intercompany-rules",
  "intercompany-transactions",
  "fiscal-years",
  "account-periods",
  "consolidation-elimination-entries",
  "consolidation-journals",
  "consolidation-accounts",
  "pos-configs",
  "pos-sessions",
  "pos-payment-methods",
  "picking-batches",
  "delivery-carriers",
  "delivery-price-rules",
  "shipping-methods",
  "ai-document-processing-jobs",
  "ai-insights",
] as const

/** Generated organization-scoped keys plus reviewed company-scoped resources. */
export const ALL_ERP_RESOURCE_KEYS: string[] = Array.from(
  new Set([...GENERATED_ORG_SUBSCRIPTION_RESOURCE_KEYS, ...EXTRA_COMPANY_SCOPED_ERP_KEYS]),
)

/**
 * Opt-in “full mirror” resource list: `auth` bundle + every org-scoped ERP table.
 * Pass this to {@link createClientSubscriptions} only when you explicitly want all tables.
 */
export const FULL_CLIENT_SUBSCRIPTION_RESOURCES: string[] = [
  "auth",
  "form-configuration",
  // Live field-permission rows use a dedicated authorization-sensitive compiler.
  "field-permissions",
  ...ALL_ERP_RESOURCE_KEYS,
];

/**
 * Builds SpacetimeDB subscription SQL from explicit resource keys only.
 * There is no default: an empty `resources` array yields no subscriptions.
 */
export function createClientSubscriptions(
  resources: string[],
  ctx: SubscriptionQueryContext = {},
): string[] {
  const identityHex =
    ctx.identityHex !== undefined && ctx.identityHex !== "unknown"
      ? ctx.identityHex
      : undefined;
  const scopedCtx: SubscriptionQueryContext = {
    ...ctx,
    identityHex,
  };

  const out: string[] = [];
  for (const key of resources) {
    const part = subscriptionQueriesForResource(key, scopedCtx);
    if (part === null) continue;
    out.push(...part);
  }
  return out;
}
