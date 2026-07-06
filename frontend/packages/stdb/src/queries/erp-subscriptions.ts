import { authSubscriptions } from "./auth";
import {
  type FieldAccessContext,
  resolveHttpSqlColumns,
  selectOrgScopedSql,
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
  /** When set (e.g. from the same sources as `/api/query`), subscription SQL matches API column projection. */
  fieldAccess?: FieldAccessContext;
}

/**
 * Kebab-case resource keys aligned with `/api/query/[resource]` plus auth bundle keys.
 * Use {@link subscriptionQueriesForResource} to resolve SQL for one resource.
 */
export const SUBSCRIPTION_RESOURCE_KEYS = [
  "auth",
  "user-profile",
  "user-role-assignment",
  "auth-role-table",
  "user-organization",
  "casbin-rule",
  "org-permissions",
  "policy-snapshots",
  "account-accounts",
  "account-account-types",
  "account-groups",
  "account-journals",
  "account-move-lines",
  "account-moves",
  "account-taxes",
  "budgets",
  "budget-lines",
  "budget-posts",
  "analytic-accounts",
  "depreciation-lines",
  "fixed-assets",
  "intercompany-rules",
  "intercompany-transactions",
  "tax-deadlines",
  "tax-groups",
  "tax-jurisdictions",
  "tax-schedules",
  "sale-orders",
  "sale-order-lines",
  "return-orders",
  "return-order-lines",
  "pos-loyalty-programs",
  "pos-loyalty-cards",
  "pricelists",
  "picking-batches",
  "leads",
  "opportunities",
  "opportunity-stages",
  "contacts",
  "projects",
  "tasks",
  "timesheets",
  "products",
  "product-categories",
  "uoms",
  "stock-quants",
  "stock-pickings",
  "warehouses",
  "inventory-adjustments",
  "purchase-orders",
  "purchase-order-lines",
  "partner-banks",
  "purchase-requisitions",
  "mrp-productions",
  "mrp-boms",
  "mrp-workorders",
  "mrp-workcenters",
  "mrp-routing-workcenters",
  "employees",
  "departments",
  "leave-requests",
  "contracts",
  "payslips",
  "financial-reports",
  "trial-balances",
  "saved-reports",
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "dashboards",
  "dashboard-widgets",
  "documents",
  "document-folders",
  "knowledge-articles",
  "knowledge-categories",
  "helpdesk-tickets",
  "helpdesk-teams",
  "helpdesk-stages",
  "helpdesk-slas",
  "subscriptions",
  "subscription-plans",
  "deferred-revenue-schedules",
  "deferred-revenue-lines",
  "revenue-recognition-rules",
  "workflows",
  "workflow-activities",
  "workflow-instances",
  "workflow-transitions",
  "workflow-workitems",
  "proposals",
  "proposal-sections",
  "proposal-line-items",
  "proposal-versions",
  "proposal-source-docs",
  "proposal-presence",
  "proposal-comments",
  "fleet-vehicles",
  "pos-terminals",
  "pos-configs",
  "pos-sessions",
  "calendar-events",
  "mail-messages",
  "expenses",
  "expense-sheets",
  "iot-devices",
  "iot-hubs",
  "iot-alerts",
  "iot-actions",
  "iot-telemetry",
  "iot-thresholds",
  "iot-pairing-tokens",
  "roles",
  "user-roles",
] as const;

export type SubscriptionResourceKey = (typeof SUBSCRIPTION_RESOURCE_KEYS)[number];

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
  "casbin-rule": authSelectAll("casbin_rule", "CasbinRule"),
};

/** Org-scoped ERP resources (matches `/api/query/[resource]` for data tables). */
const ERP_ORG_SQL: Record<string, (organizationId: number, fa?: FieldAccessContext) => string> = {
  "account-accounts": (id, fa) =>
    selectOrgScopedSql("account-accounts", "account_account", id, fa, "", " ORDER BY code"),
  "account-account-types": (id, fa) =>
    selectOrgScopedSql(
      "account-account-types",
      "account_account_type",
      id,
      fa,
      "",
      " ORDER BY name ASC",
    ),
  "account-groups": (id, fa) =>
    selectOrgScopedSql(
      "account-groups",
      "account_group",
      id,
      fa,
      "",
      " ORDER BY level ASC, name ASC",
    ),
  "account-journals": (id, fa) =>
    selectOrgScopedSql("account-journals", "account_journal", id, fa, ""),
  "account-move-lines": (id, fa) =>
    selectOrgScopedSql(
      "account-move-lines",
      "account_move_line",
      id,
      fa,
      "",
      " ORDER BY move_id ASC, sequence ASC",
    ),
  "account-moves": (id, fa) =>
    selectOrgScopedSql("account-moves", "account_move", id, fa, ""),
  "account-taxes": (id, fa) =>
    selectOrgScopedSql("account-taxes", "account_tax", id, fa, ""),
  budgets: (id, fa) =>
    selectOrgScopedSql("budgets", "crossovered_budget", id, fa, ""),
  "budget-lines": (id, fa) =>
    selectOrgScopedSql(
      "budget-lines",
      "crossovered_budget_lines",
      id,
      fa,
      "",
      " ORDER BY general_budget_id ASC, id ASC",
    ),
  "budget-posts": (id, fa) =>
    selectOrgScopedSql("budget-posts", "budget_post", id, fa, "", " ORDER BY name ASC"),
  "analytic-accounts": (id, fa) =>
    selectOrgScopedSql("analytic-accounts", "account_analytic_account", id, fa, ""),
  "tax-groups": (id, fa) =>
    selectOrgScopedSql("tax-groups", "account_tax_group", id, fa, ""),
  "tax-jurisdictions": (id, fa) =>
    selectOrgScopedSql("tax-jurisdictions", "tax_jurisdiction", id, fa, ""),
  "tax-schedules": (id, fa) =>
    selectOrgScopedSql("tax-schedules", "tax_schedule", id, fa, ""),
  "tax-deadlines": (id, fa) =>
    selectOrgScopedSql("tax-deadlines", "tax_deadline", id, fa, ""),
  "sale-orders": (id, fa) =>
    selectOrgScopedSql("sale-orders", "sale_order", id, fa, ""),
  "sale-order-lines": (id, fa) =>
    selectOrgScopedSql("sale-order-lines", "sale_order_line", id, fa, ""),
  "return-orders": (id, fa) =>
    selectOrgScopedSql("return-orders", "return_order", id, fa, "", " ORDER BY id DESC"),
  "return-order-lines": (id, fa) =>
    selectOrgScopedSql(
      "return-order-lines",
      "return_order_line",
      id,
      fa,
      "",
      " ORDER BY return_order_id ASC, id ASC",
    ),
  "pos-loyalty-programs": (id, fa) =>
    selectOrgScopedSql(
      "pos-loyalty-programs",
      "pos_loyalty_program",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "pos-loyalty-cards": (id, fa) =>
    selectOrgScopedSql(
      "pos-loyalty-cards",
      "pos_loyalty_card",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  pricelists: (id, fa) =>
    selectOrgScopedSql("pricelists", "product_pricelist", id, fa, ""),
  "pricelist-items": (id, fa) =>
    selectOrgScopedSql(
      "pricelist-items",
      "product_pricelist_item",
      id,
      fa,
      "",
      " ORDER BY pricelist_id ASC, sequence ASC",
    ),
  leads: (id, fa) => selectOrgScopedSql("leads", "lead", id, fa, ""),
  opportunities: (id, fa) =>
    selectOrgScopedSql("opportunities", "opportunity", id, fa, ""),
  "opportunity-stages": (id, fa) =>
    selectOrgScopedSql(
      "opportunity-stages",
      "opp_stage",
      id,
      fa,
      "",
      " ORDER BY sequence ASC",
    ),
  contacts: (id, fa) => selectOrgScopedSql("contacts", "contact", id, fa, ""),
  projects: (id, fa) =>
    selectOrgScopedSql("projects", "project_project", id, fa, ""),
  tasks: (id, fa) => selectOrgScopedSql("tasks", "project_task", id, fa, ""),
  timesheets: (id, fa) =>
    selectOrgScopedSql("timesheets", "project_timesheet", id, fa, ""),
  products: (id, fa) => selectOrgScopedSql("products", "product", id, fa, ""),
  "product-categories": (id, fa) =>
    selectOrgScopedSql(
      "product-categories",
      "product_category",
      id,
      fa,
      "",
    ),
  uoms: (id, fa) => selectOrgScopedSql("uoms", "uom", id, fa, ""),
  "stock-quants": (id, fa) =>
    selectOrgScopedSql("stock-quants", "stock_quant", id, fa, ""),
  "stock-pickings": (id, fa) =>
    selectOrgScopedSql("stock-pickings", "stock_picking", id, fa, ""),
  warehouses: (id, fa) =>
    selectOrgScopedSql("warehouses", "warehouse", id, fa, ""),
  "inventory-adjustments": (id, fa) =>
    selectOrgScopedSql(
      "inventory-adjustments",
      "inventory_adjustment",
      id,
      fa,
      "",
    ),
  "purchase-orders": (id, fa) =>
    selectOrgScopedSql("purchase-orders", "purchase_order", id, fa, ""),
  "purchase-order-lines": (id, fa) =>
    selectOrgScopedSql(
      "purchase-order-lines",
      "purchase_order_line",
      id,
      fa,
      "",
    ),
  "partner-banks": (id, fa) =>
    selectOrgScopedSql("partner-banks", "res_partner_bank", id, fa, ""),
  "purchase-requisitions": (id, fa) =>
    selectOrgScopedSql(
      "purchase-requisitions",
      "purchase_requisition",
      id,
      fa,
      "",
    ),
  "mrp-productions": (id, fa) =>
    selectOrgScopedSql("mrp-productions", "mrp_production", id, fa, ""),
  "mrp-boms": (id, fa) => selectOrgScopedSql("mrp-boms", "mrp_bom", id, fa, ""),
  "mrp-workorders": (id, fa) =>
    selectOrgScopedSql("mrp-workorders", "mrp_workorder", id, fa, ""),
  "mrp-workcenters": (id, fa) =>
    selectOrgScopedSql("mrp-workcenters", "mrp_workcenter", id, fa, ""),
  "mrp-routing-workcenters": (id, fa) =>
    selectOrgScopedSql(
      "mrp-routing-workcenters",
      "mrp_routing_workcenter",
      id,
      fa,
      "",
      " ORDER BY workcenter_id ASC, sequence ASC",
    ),
  employees: (id, fa) =>
    selectOrgScopedSql("employees", "hr_employee", id, fa, ""),
  departments: (id, fa) =>
    selectOrgScopedSql("departments", "hr_department", id, fa, ""),
  "leave-requests": (id, fa) =>
    selectOrgScopedSql("leave-requests", "hr_leave", id, fa, ""),
  contracts: (id, fa) =>
    selectOrgScopedSql("contracts", "hr_contract", id, fa, ""),
  payslips: (id, fa) => selectOrgScopedSql("payslips", "hr_payslip", id, fa, ""),
  "financial-reports": (id, fa) =>
    selectOrgScopedSql("financial-reports", "financial_report", id, fa, ""),
  "trial-balances": (id, fa) =>
    selectOrgScopedSql("trial-balances", "trial_balance", id, fa, ""),
  "saved-reports": (id, fa) =>
    selectOrgScopedSql("saved-reports", "saved_report", id, fa, ""),
  "report-templates": (id, fa) =>
    selectOrgScopedSql("report-templates", "report_template", id, fa, ""),
  "scheduled-reports": (id, fa) =>
    selectOrgScopedSql("scheduled-reports", "scheduled_report", id, fa, ""),
  "analytics-metrics": (id, fa) =>
    selectOrgScopedSql("analytics-metrics", "analytics_metric", id, fa, ""),
  dashboards: (id, fa) => selectOrgScopedSql("dashboards", "dashboard", id, fa, ""),
  "dashboard-widgets": (id, fa) =>
    selectOrgScopedSql("dashboard-widgets", "dashboard_widget", id, fa, ""),
  documents: (id, fa) =>
    selectOrgScopedSql("documents", "document", id, fa, ""),
  "document-folders": (id, fa) =>
    selectOrgScopedSql("document-folders", "doc_folder", id, fa, ""),
  "knowledge-articles": (id, fa) =>
    selectOrgScopedSql(
      "knowledge-articles",
      "knowledge_article",
      id,
      fa,
      "",
    ),
  "knowledge-categories": (id, fa) =>
    selectOrgScopedSql("knowledge-categories", "kb_category", id, fa, ""),
  "helpdesk-tickets": (id, fa) =>
    selectOrgScopedSql("helpdesk-tickets", "helpdesk_ticket", id, fa, ""),
  "helpdesk-teams": (id, fa) =>
    selectOrgScopedSql("helpdesk-teams", "helpdesk_team", id, fa, ""),
  "helpdesk-stages": (id, fa) =>
    selectOrgScopedSql("helpdesk-stages", "helpdesk_stage", id, fa, ""),
  "helpdesk-slas": (id, fa) =>
    selectOrgScopedSql("helpdesk-slas", "helpdesk_sla", id, fa, ""),
  subscriptions: (id, fa) =>
    selectOrgScopedSql("subscriptions", "subscription", id, fa, ""),
  "subscription-plans": (id, fa) =>
    selectOrgScopedSql(
      "subscription-plans",
      "subscription_plan",
      id,
      fa,
      "",
    ),
  "deferred-revenue-schedules": (id, fa) =>
    selectOrgScopedSql(
      "deferred-revenue-schedules",
      "deferred_revenue_schedule",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "deferred-revenue-lines": (id, fa) =>
    selectOrgScopedSql(
      "deferred-revenue-lines",
      "deferred_revenue_line",
      id,
      fa,
      "",
      " ORDER BY schedule_id ASC, sequence ASC",
    ),
  "revenue-recognition-rules": (id, fa) =>
    selectOrgScopedSql(
      "revenue-recognition-rules",
      "revenue_recognition_rule",
      id,
      fa,
      "",
      " ORDER BY priority DESC, id DESC",
    ),
  workflows: (id, fa) => selectOrgScopedSql("workflows", "workflow", id, fa, ""),
  "workflow-activities": (id, fa) =>
    selectOrgScopedSql(
      "workflow-activities",
      "workflow_activity",
      id,
      fa,
      "",
      " ORDER BY workflow_id ASC, sequence ASC",
    ),
  "workflow-instances": (id, fa) =>
    selectOrgScopedSql(
      "workflow-instances",
      "workflow_instance",
      id,
      fa,
      "",
    ),
  "workflow-transitions": (id, fa) =>
    selectOrgScopedSql(
      "workflow-transitions",
      "workflow_transition",
      id,
      fa,
      "",
      " ORDER BY id ASC",
    ),
  "workflow-workitems": (id, fa) =>
    selectOrgScopedSql(
      "workflow-workitems",
      "workflow_workitem",
      id,
      fa,
      "",
      " ORDER BY instance_id ASC, id ASC",
    ),
  proposals: (id, fa) => selectOrgScopedSql("proposals", "proposal", id, fa, ""),
  "proposal-sections": (id, fa) =>
    selectOrgScopedSql("proposal-sections", "proposal_section", id, fa, "", " ORDER BY sequence ASC"),
  "proposal-line-items": (id, fa) =>
    selectOrgScopedSql("proposal-line-items", "proposal_line_item", id, fa, ""),
  "proposal-versions": (id, fa) =>
    selectOrgScopedSql("proposal-versions", "proposal_version", id, fa, "", " ORDER BY version_number DESC"),
  "proposal-source-docs": (id, fa) =>
    selectOrgScopedSql("proposal-source-docs", "proposal_source_doc", id, fa, ""),
  "proposal-presence": (id, fa) =>
    selectOrgScopedSql("proposal-presence", "proposal_presence", id, fa, ""),
  "proposal-comments": (id, fa) =>
    selectOrgScopedSql("proposal-comments", "proposal_comment", id, fa, "", " ORDER BY id DESC"),
  "fleet-vehicles": (id, fa) =>
    selectOrgScopedSql("fleet-vehicles", "fleet_vehicle", id, fa, "", " ORDER BY name ASC"),
  "pos-terminals": (id, fa) =>
    selectOrgScopedSql("pos-terminals", "pos_terminal", id, fa, "", " ORDER BY name ASC"),
  "calendar-events": (id, fa) =>
    selectOrgScopedSql(
      "calendar-events",
      "calendar_event",
      id,
      fa,
      "",
      " ORDER BY start ASC",
    ),
  "mail-messages": (id, fa) =>
    selectOrgScopedSql("mail-messages", "mail_message", id, fa, ""),
  expenses: (id, fa) => selectOrgScopedSql("expenses", "hr_expense", id, fa, ""),
  "expense-sheets": (id, fa) =>
    selectOrgScopedSql("expense-sheets", "expense_sheet", id, fa, ""),
  "iot-devices": (id, fa) =>
    selectOrgScopedSql("iot-devices", "iot_device", id, fa, ""),
  "iot-hubs": (id, fa) => selectOrgScopedSql("iot-hubs", "iot_hub", id, fa, ""),
  "iot-alerts": (id, fa) => selectOrgScopedSql("iot-alerts", "iot_alert", id, fa, ""),
  "iot-actions": (id, fa) => selectOrgScopedSql("iot-actions", "iot_action", id, fa, ""),
  "iot-telemetry": (id, fa) =>
    selectOrgScopedSql("iot-telemetry", "iot_telemetry", id, fa, "", " ORDER BY recorded_at DESC"),
  "iot-thresholds": (id, fa) =>
    selectOrgScopedSql("iot-thresholds", "iot_threshold", id, fa, ""),
  "iot-pairing-tokens": (id, fa) =>
    selectOrgScopedSql(
      "iot-pairing-tokens",
      "iot_pairing_token",
      id,
      fa,
      "",
      " ORDER BY created_at DESC",
    ),
};

/** Resources scoped by `company_id` lists (no SQL subqueries). */
function subscriptionSqlForCompanyScopedResource(
  resource: string,
  ctx: SubscriptionQueryContext,
): string[] | null | undefined {
  const ids = ctx.companyIds
  const fa = ctx.fieldAccess
  if (resource === "fixed-assets") {
    if (!ids?.length) return null
    const list = ids.join(", ")
    const c = resolveHttpSqlColumns("fixed-assets", fa).join(", ")
    return [`SELECT ${c} FROM account_asset WHERE company_id IN (${list})`]
  }
  if (resource === "intercompany-rules") {
    if (!ids?.length) return null
    const list = ids.join(", ")
    const c = resolveHttpSqlColumns("intercompany-rules", fa).join(", ")
    return [
      `SELECT ${c} FROM intercompany_rule WHERE source_company_id IN (${list}) OR destination_company_id IN (${list}) ORDER BY sequence ASC`,
    ]
  }
  if (resource === "intercompany-transactions") {
    if (!ids?.length) return null
    const list = ids.join(", ")
    const c = resolveHttpSqlColumns("intercompany-transactions", fa).join(", ")
    return [
      `SELECT ${c} FROM intercompany_transaction WHERE origin_company_id IN (${list}) OR destination_company_id IN (${list}) ORDER BY id DESC`,
    ]
  }
  if (resource === "depreciation-lines") {
    return null
  }
  if (resource === "pos-configs") {
    if (!ids?.length) return null
    const list = ids.join(", ")
    const c = resolveHttpSqlColumns("pos-configs", fa).join(", ")
    return [`SELECT ${c} FROM pos_config WHERE company_id IN (${list}) ORDER BY name ASC`]
  }
  if (resource === "picking-batches") {
    if (!ids?.length) return null
    const list = ids.join(", ")
    const c = resolveHttpSqlColumns("picking-batches", fa).join(", ")
    return [`SELECT ${c} FROM stock_picking_batch WHERE company_id IN (${list})`]
  }
  if (resource === "pos-sessions") {
    // Child of pos_config — no SQL subqueries; load pos-sessions via api-server query instead.
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

  const builder = ERP_ORG_SQL[r];
  if (!builder) return null;

  return [builder(Number(org), ctx.fieldAccess)];
}

const EXTRA_COMPANY_SCOPED_ERP_KEYS = [
  "fixed-assets",
  "depreciation-lines",
  "intercompany-rules",
  "intercompany-transactions",
  "pos-configs",
  "pos-sessions",
  "picking-batches",
] as const

/** Keys for org-scoped ERP tables ({@link ERP_ORG_SQL} plus company-scoped resources). */
export const ALL_ERP_RESOURCE_KEYS: string[] = Array.from(
  new Set([...Object.keys(ERP_ORG_SQL), ...EXTRA_COMPANY_SCOPED_ERP_KEYS]),
)

/**
 * Opt-in “full mirror” resource list: `auth` bundle + every org-scoped ERP table.
 * Pass this to {@link createClientSubscriptions} only when you explicitly want all tables.
 */
export const FULL_CLIENT_SUBSCRIPTION_RESOURCES: string[] = [
  "auth",
  "form-configuration",
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
