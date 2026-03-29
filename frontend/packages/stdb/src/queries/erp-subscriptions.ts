import { authSubscriptions } from "./auth";
import {
  type FieldAccessContext,
  selectOrgScopedSql,
  selectRolesActiveSql,
  selectUserRoleAssignmentsForIdentitySql,
} from "../field-policy";

/** Context for building subscription SQL (org + identity where needed). */
export interface SubscriptionQueryContext {
  organizationId?: number;
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
  "account-accounts",
  "account-journals",
  "account-moves",
  "account-taxes",
  "budgets",
  "analytic-accounts",
  "sale-orders",
  "sale-order-lines",
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
  "purchase-requisitions",
  "mrp-productions",
  "mrp-boms",
  "mrp-workorders",
  "mrp-workcenters",
  "employees",
  "departments",
  "leave-requests",
  "contracts",
  "payslips",
  "financial-reports",
  "trial-balances",
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "documents",
  "knowledge-articles",
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
  "calendar-events",
  "mail-messages",
  "expenses",
  "expense-sheets",
  "roles",
  "user-roles",
] as const;

export type SubscriptionResourceKey = (typeof SUBSCRIPTION_RESOURCE_KEYS)[number];

const AUTH_SINGLE: Record<string, string> = {
  "user-profile": "SELECT * FROM user_profile",
  "user-role-assignment": "SELECT * FROM user_role_assignment",
  /** Full `role` table (matches auth bundle); for active-only use `roles`. */
  "auth-role-table": "SELECT * FROM role",
  "user-organization": "SELECT * FROM user_organization",
  "casbin-rule": "SELECT * FROM casbin_rule",
};

/** Org-scoped ERP resources (matches `/api/query/[resource]` for data tables). */
const ERP_ORG_SQL: Record<string, (organizationId: number, fa?: FieldAccessContext) => string> = {
  "account-accounts": (id, fa) =>
    selectOrgScopedSql("account-accounts", "account_account", id, fa, "", " ORDER BY code"),
  "account-journals": (id, fa) =>
    selectOrgScopedSql("account-journals", "account_journal", id, fa, ""),
  "account-moves": (id, fa) =>
    selectOrgScopedSql("account-moves", "account_move", id, fa, ""),
  "account-taxes": (id, fa) =>
    selectOrgScopedSql("account-taxes", "account_tax", id, fa, ""),
  budgets: (id, fa) =>
    selectOrgScopedSql("budgets", "crossovered_budget", id, fa, ""),
  "analytic-accounts": (id, fa) =>
    selectOrgScopedSql("analytic-accounts", "account_analytic_account", id, fa, ""),
  "sale-orders": (id, fa) =>
    selectOrgScopedSql("sale-orders", "sale_order", id, fa, ""),
  "sale-order-lines": (id, fa) =>
    selectOrgScopedSql("sale-order-lines", "sale_order_line", id, fa, ""),
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
  "picking-batches": (id, fa) =>
    selectOrgScopedSql("picking-batches", "stock_picking_batch", id, fa, ""),
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
      " AND deleted_at IS NULL",
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
  "report-templates": (id, fa) =>
    selectOrgScopedSql("report-templates", "report_template", id, fa, ""),
  "scheduled-reports": (id, fa) =>
    selectOrgScopedSql("scheduled-reports", "scheduled_report", id, fa, ""),
  "analytics-metrics": (id, fa) =>
    selectOrgScopedSql("analytics-metrics", "analytics_metric", id, fa, ""),
  documents: (id, fa) =>
    selectOrgScopedSql("documents", "document", id, fa, ""),
  "knowledge-articles": (id, fa) =>
    selectOrgScopedSql(
      "knowledge-articles",
      "knowledge_article",
      id,
      fa,
      "",
    ),
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
};

/**
 * Returns subscription SQL for a single resource key.
 * - Most ERP keys require `organizationId`.
 * - `roles` is global (no org).
 * - `user-roles` requires `identityHex` (matches serverQueryUserRoleAssignments scope).
 * @returns `null` if the resource is unknown or required context is missing.
 */
export function subscriptionQueriesForResource(
  resource: string,
  ctx: SubscriptionQueryContext,
): string[] | null {
  const r = resource.trim();
  if (!r) return null;

  if (r === "auth") {
    return authSubscriptions(ctx.identityHex, ctx.roleNames);
  }

  if (AUTH_SINGLE[r] !== undefined) {
    return [AUTH_SINGLE[r]];
  }

  if (r === "roles") {
    return [selectRolesActiveSql(ctx.fieldAccess)];
  }

  /** Form configuration tables: org-scoped via form_config + subqueries for child tables. */
  if (r === "form-configuration") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) {
      return null;
    }
    const id = String(org);
    return [
      `SELECT * FROM form_config WHERE organization_id = ${id}`,
      `SELECT * FROM form_config_field WHERE configuration_id IN (SELECT id FROM form_config WHERE organization_id = ${id})`,
      `SELECT * FROM form_role_config WHERE configuration_id IN (SELECT id FROM form_config WHERE organization_id = ${id})`,
      `SELECT * FROM user_custom_field WHERE organization_id = ${id}`,
    ];
  }

  if (r === "user-roles") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    return [selectUserRoleAssignmentsForIdentitySql(ctx.identityHex, ctx.fieldAccess)];
  }

  const org = ctx.organizationId;
  if (org === undefined || org === null || Number.isNaN(Number(org))) {
    return null;
  }

  const builder = ERP_ORG_SQL[r];
  if (!builder) return null;

  return [builder(Number(org), ctx.fieldAccess)];
}

/** Keys for org-scoped ERP tables (same as {@link ERP_ORG_SQL}). */
export const ALL_ERP_RESOURCE_KEYS: string[] = Object.keys(ERP_ORG_SQL);

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
