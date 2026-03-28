import { authSubscriptions } from "./auth";

/** Context for building subscription SQL (org + identity where needed). */
export interface SubscriptionQueryContext {
  organizationId?: number;
  /** Required for `user-roles` resource. */
  identityHex?: string;
  /** Passed to {@link authSubscriptions} when resource is `auth`. */
  roleNames?: string[];
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
  "documents",
  "knowledge-articles",
  "helpdesk-tickets",
  "helpdesk-teams",
  "helpdesk-stages",
  "subscriptions",
  "subscription-plans",
  "workflows",
  "workflow-instances",
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
const ERP_ORG_SQL: Record<string, (organizationId: number) => string> = {
  "account-accounts": (id) =>
    `SELECT * FROM account_account WHERE organization_id = ${id}`,
  "account-journals": (id) =>
    `SELECT * FROM account_journal WHERE organization_id = ${id}`,
  "account-moves": (id) =>
    `SELECT * FROM account_move WHERE organization_id = ${id}`,
  "account-taxes": (id) =>
    `SELECT * FROM account_tax WHERE organization_id = ${id}`,
  budgets: (id) =>
    `SELECT * FROM crossovered_budget WHERE organization_id = ${id}`,
  "analytic-accounts": (id) =>
    `SELECT * FROM account_analytic_account WHERE organization_id = ${id}`,
  "sale-orders": (id) =>
    `SELECT * FROM sale_order WHERE organization_id = ${id}`,
  "sale-order-lines": (id) =>
    `SELECT * FROM sale_order_line WHERE organization_id = ${id}`,
  pricelists: (id) =>
    `SELECT * FROM product_pricelist WHERE organization_id = ${id}`,
  "picking-batches": (id) =>
    `SELECT * FROM stock_picking_batch WHERE organization_id = ${id}`,
  leads: (id) => `SELECT * FROM lead WHERE organization_id = ${id}`,
  opportunities: (id) =>
    `SELECT * FROM opportunity WHERE organization_id = ${id}`,
  "opportunity-stages": (id) =>
    `SELECT * FROM opp_stage WHERE organization_id = ${id}`,
  contacts: (id) => `SELECT * FROM contact WHERE organization_id = ${id}`,
  projects: (id) =>
    `SELECT * FROM project_project WHERE organization_id = ${id}`,
  tasks: (id) => `SELECT * FROM project_task WHERE organization_id = ${id}`,
  timesheets: (id) =>
    `SELECT * FROM project_timesheet WHERE organization_id = ${id}`,
  products: (id) => `SELECT * FROM product WHERE organization_id = ${id}`,
  "product-categories": (id) =>
    `SELECT * FROM product_category WHERE organization_id = ${id} AND deleted_at IS NULL`,
  uoms: (id) => `SELECT * FROM uom WHERE organization_id = ${id}`,
  "stock-quants": (id) =>
    `SELECT * FROM stock_quant WHERE organization_id = ${id}`,
  "stock-pickings": (id) =>
    `SELECT * FROM stock_picking WHERE organization_id = ${id}`,
  warehouses: (id) =>
    `SELECT * FROM warehouse WHERE organization_id = ${id}`,
  "inventory-adjustments": (id) =>
    `SELECT * FROM inventory_adjustment WHERE organization_id = ${id}`,
  "purchase-orders": (id) =>
    `SELECT * FROM purchase_order WHERE organization_id = ${id}`,
  "purchase-order-lines": (id) =>
    `SELECT * FROM purchase_order_line WHERE organization_id = ${id}`,
  "purchase-requisitions": (id) =>
    `SELECT * FROM purchase_requisition WHERE organization_id = ${id}`,
  "mrp-productions": (id) =>
    `SELECT * FROM mrp_production WHERE organization_id = ${id}`,
  "mrp-boms": (id) => `SELECT * FROM mrp_bom WHERE organization_id = ${id}`,
  "mrp-workorders": (id) =>
    `SELECT * FROM mrp_workorder WHERE organization_id = ${id}`,
  "mrp-workcenters": (id) =>
    `SELECT * FROM mrp_workcenter WHERE organization_id = ${id}`,
  employees: (id) =>
    `SELECT * FROM hr_employee WHERE organization_id = ${id}`,
  departments: (id) =>
    `SELECT * FROM hr_department WHERE organization_id = ${id}`,
  "leave-requests": (id) =>
    `SELECT * FROM hr_leave WHERE organization_id = ${id}`,
  contracts: (id) =>
    `SELECT * FROM hr_contract WHERE organization_id = ${id}`,
  payslips: (id) => `SELECT * FROM hr_payslip WHERE organization_id = ${id}`,
  "financial-reports": (id) =>
    `SELECT * FROM financial_report WHERE organization_id = ${id}`,
  "trial-balances": (id) =>
    `SELECT * FROM trial_balance WHERE organization_id = ${id}`,
  documents: (id) =>
    `SELECT * FROM document WHERE organization_id = ${id}`,
  "knowledge-articles": (id) =>
    `SELECT * FROM knowledge_article WHERE organization_id = ${id}`,
  "helpdesk-tickets": (id) =>
    `SELECT * FROM helpdesk_ticket WHERE organization_id = ${id}`,
  "helpdesk-teams": (id) =>
    `SELECT * FROM helpdesk_team WHERE organization_id = ${id}`,
  "helpdesk-stages": (id) =>
    `SELECT * FROM helpdesk_stage WHERE organization_id = ${id}`,
  subscriptions: (id) =>
    `SELECT * FROM subscription WHERE organization_id = ${id}`,
  "subscription-plans": (id) =>
    `SELECT * FROM subscription_plan WHERE organization_id = ${id}`,
  workflows: (id) => `SELECT * FROM workflow WHERE organization_id = ${id}`,
  "workflow-instances": (id) =>
    `SELECT * FROM workflow_instance WHERE organization_id = ${id}`,
  proposals: (id) => `SELECT * FROM proposal WHERE organization_id = ${id}`,
  "calendar-events": (id) =>
    `SELECT * FROM calendar_event WHERE organization_id = ${id}`,
  "mail-messages": (id) =>
    `SELECT * FROM mail_message WHERE organization_id = ${id}`,
  expenses: (id) => `SELECT * FROM hr_expense WHERE organization_id = ${id}`,
  "expense-sheets": (id) =>
    `SELECT * FROM expense_sheet WHERE organization_id = ${id}`,
};

const ROLES_SQL = "SELECT * FROM role WHERE is_active = true";

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
    return [ROLES_SQL];
  }

  if (r === "user-roles") {
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    const hex = ctx.identityHex.replace(/'/g, "''");
    return [
      `SELECT * FROM user_role_assignment WHERE user_identity = '${hex}' AND is_active = true`,
    ];
  }

  const org = ctx.organizationId;
  if (org === undefined || org === null || Number.isNaN(Number(org))) {
    return null;
  }

  const builder = ERP_ORG_SQL[r];
  if (!builder) return null;

  return [builder(Number(org))];
}

/** Keys for org-scoped ERP tables (same as {@link ERP_ORG_SQL}). */
export const ALL_ERP_RESOURCE_KEYS: string[] = Object.keys(ERP_ORG_SQL);

/**
 * Opt-in “full mirror” resource list: `auth` bundle + every org-scoped ERP table.
 * Pass this to {@link createClientSubscriptions} only when you explicitly want all tables.
 */
export const FULL_CLIENT_SUBSCRIPTION_RESOURCES: string[] = [
  "auth",
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
