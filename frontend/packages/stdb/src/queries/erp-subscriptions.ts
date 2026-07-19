import { authSubscriptions } from "./auth";
import {
  type FieldAccessContext,
  hasHrPermission,
  identitySqlLiteral,
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
  /** When set (e.g. from `my-employee` query), scopes `direct-reports` without subqueries. */
  managerEmployeeId?: number;
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
  "sale-orders-to-approve",
  "sale-order-lines",
  "sale-commissions",
  "sale-commissions-pending",
  "return-orders",
  "return-order-lines",
  "pos-loyalty-programs",
  "pos-loyalty-cards",
  "pricelists",
  "picking-batches",
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
  "contact-segments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "assignment-rules",
  "activities",
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
  "projects",
  "tasks",
  "timesheets",
  "timesheets-to-validate",
  "timesheets-unbilled",
  "project-rate-cards",
  "project-rate-card-lines",
  "working-calendars",
  "public-holidays",
  "resource-allocations",
  "resource-capacity-by-employee",
  "project-margin-by-project",
  "resource-utilisation-by-employee",
  "project-milestones",
  "capacity-forecast-by-employee",
  "project-baselines",
  "project-change-orders",
  "project-earned-value-by-project",
  "project-subcontractor-costs",
  "project-revenue-schedules",
  "project-revenue-lines",
  "project-integration-intents",
  "hr-resources",
  "hr-skills",
  "hr-employee-skills",
  "onboarding-templates",
  "onboarding-template-items",
  "onboarding-progress",
  "performance-cycles",
  "performance-goals",
  "performance-reviews",
  "benefit-plans",
  "benefit-enrollments",
  "employee-documents",
  "products",
  "product-categories",
  "uoms",
  "stock-quants",
  "stock-pickings",
  "warehouses",
  "inventory-adjustments",
  "stock-locations",
  "stock-moves",
  "stock-production-lots",
  "stock-production-serials",
  "stock-cycle-counts",
  "stock-inventories",
  "stock-routes",
  "stock-rules",
  "picking-waves",
  "warehouse-tasks",
  "warehouse-3d-zones",
  "quality-checks",
  "quality-alerts",
  "replenishment-rules",
  "barcode-rules",
  "barcode-nomenclatures",
  "adjustment-reasons",
  "serial-lot-traceability",
  "stock-traceability-reports",
  "stock-packages",
  "packaging-materials",
  "cartonization-results",
  "inventory-exceptions",
  "inventory-exceptions-short-atp",
  "inventory-exceptions-expired-lots",
  "inventory-exceptions-open-qc",
  "warehouse-sync-intents",
  "warehouse-sync-intents-pending",
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-orders-partial-receipt",
  "purchase-order-lines",
  "purchase-order-lines-over-billed",
  "landed-costs",
  "landed-cost-lines",
  "supplier-intakes",
  "partner-banks",
  "purchase-requisitions",
  "purchase-requisition-lines",
  "purchase-rfqs",
  "purchase-rfq-lines",
  "purchase-rfq-bids",
  "purchase-returns",
  "purchase-return-lines",
  "mrp-productions",
  "mrp-boms",
  "mrp-workorders",
  "mrp-workcenters",
  "mrp-routing-workcenters",
  "employees",
  "my-employee",
  "direct-reports",
  "departments",
  "leave-requests",
  "leaves-to-approve",
  "contracts",
  "payslips",
  "payslips-to-export",
  "hr-integration-intents",
  "financial-reports",
  "trial-balances",
  "saved-reports",
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "dashboards",
  "dashboard-widgets",
  "documents",
  "documents-deleted",
  "document-folders",
  "document-versions",
  "document-templates",
  "mail-templates",
  "knowledge-articles",
  "knowledge-categories",
  "ai-document-processing-jobs",
  "ai-insights",
  "helpdesk-tickets",
  "helpdesk-teams",
  "helpdesk-stages",
  "helpdesk-slas",
  "subscriptions",
  "subscription-plans",
  "subscription-lines",
  "subscription-billing-runs",
  "subscription-amendments",
  "subscription-usage-events",
  "subscription-usage-charges",
  "subscription-price-tiers",
  "subscription-commitments",
  "subscription-bundles",
  "subscription-bundle-items",
  "subscription-rating-backlog",
  "subscription-collections",
  "subscription-entitlements",
  "subscription-payment-intents",
  "subscription-tax-settle-intents",
  "subscription-price-indexes",
  "subscription-due-to-bill",
  "subscription-past-due",
  "subscription-amend-pending",
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
  "expense-sheets-to-approve",
  "expenses-missing-receipt",
  "expense-receipts",
  "expense-card-statement-unmatched",
  "expense-advances",
  "expense-policy-exceptions",
  "expense-mileage-rates",
  "expense-per-diem-rates",
  "iot-devices",
  "iot-hubs",
  "iot-alerts",
  "iot-actions",
  "iot-telemetry",
  "iot-thresholds",
  "iot-pairing-tokens",
  "sod-conflict-rules",
  "fx-revaluation-runs",
  "amortization-schedules",
  "amortization-lines",
  "partner-credit-controls",
  "partner-credit-holds",
  "delegated-admin-scopes",
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

/** Org-scoped ERP resources — row metadata codegen'd to `crates/stdb-auth/assets/erp-org-sql.json` via `make codegen`. */
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
  "bank-statements": (id, fa) =>
    selectOrgScopedSql("bank-statements", "account_bank_statement", id, fa, ""),
  "bank-statement-lines": (id, fa) =>
    selectOrgScopedSql(
      "bank-statement-lines",
      "account_bank_statement_line",
      id,
      fa,
      "",
      " ORDER BY id ASC",
    ),
  "bank-match-candidates": (id, fa) =>
    selectOrgScopedSql("bank-match-candidates", "bank_match_candidate", id, fa, ""),
  "account-reconciliation-widgets": (id, fa) =>
    selectOrgScopedSql(
      "account-reconciliation-widgets",
      "account_reconciliation_widget",
      id,
      fa,
      "",
    ),
  "account-payments": (id, fa) =>
    selectOrgScopedSql("account-payments", "account_payment", id, fa, "", " ORDER BY id DESC"),
  "account-payment-terms": (id, fa) =>
    selectOrgScopedSql("account-payment-terms", "account_payment_term", id, fa, ""),
  "payment-accounts": (id, fa) =>
    selectOrgScopedSql("payment-accounts", "payment_account", id, fa, ""),
  "payment-transactions": (id, fa) =>
    selectOrgScopedSql(
      "payment-transactions",
      "payment_transaction",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "payment-fees": (id, fa) =>
    selectOrgScopedSql("payment-fees", "payment_fee", id, fa, ""),
  "payment-reconciliations": (id, fa) =>
    selectOrgScopedSql("payment-reconciliations", "payment_reconciliation", id, fa, ""),
  "payment-reversals": (id, fa) =>
    selectOrgScopedSql("payment-reversals", "payment_reversal", id, fa, ""),
  "analytic-lines": (id, fa) =>
    selectOrgScopedSql("analytic-lines", "account_analytic_line", id, fa, ""),
  "analytic-distribution-models": (id, fa) =>
    selectOrgScopedSql(
      "analytic-distribution-models",
      "account_analytic_distribution_model",
      id,
      fa,
      "",
    ),
  "sale-orders": (id, fa) =>
    selectOrgScopedSql("sale-orders", "sale_order", id, fa, ""),
  "sale-orders-to-approve": (id, fa) =>
    selectOrgScopedSql(
      "sale-orders-to-approve",
      "sale_order",
      id,
      fa,
      " AND state = 'ToApprove'",
    ),
  "sale-order-lines": (id, fa) =>
    selectOrgScopedSql("sale-order-lines", "sale_order_line", id, fa, ""),
  "sale-commissions": (id, fa) =>
    selectOrgScopedSql(
      "sale-commissions",
      "sale_commission",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "sale-commissions-pending": (id, fa) =>
    selectOrgScopedSql(
      "sale-commissions-pending",
      "sale_commission",
      id,
      fa,
      " AND state = 'accrued'",
      " ORDER BY id DESC",
    ),
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
  "lead-sources": (id, fa) =>
    selectOrgScopedSql(
      "lead-sources",
      "lead_source",
      id,
      fa,
      "",
      " ORDER BY sequence ASC",
    ),
  "lead-lost-reasons": (id, fa) =>
    selectOrgScopedSql("lead-lost-reasons", "lead_lost_reason", id, fa, ""),
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
  "opportunity-lines": (id, fa) =>
    selectOrgScopedSql("opportunity-lines", "opportunity_line", id, fa, ""),
  "opportunity-presence": (id, fa) =>
    selectOrgScopedSql("opportunity-presence", "opportunity_presence", id, fa, ""),
  contacts: (id, fa) => selectOrgScopedSql("contacts", "contact", id, fa, ""),
  "contact-phone-identities": (id, fa) =>
    selectOrgScopedSql(
      "contact-phone-identities",
      "contact_phone_identity",
      id,
      fa,
      "",
    ),
  "contact-role-assignments": (id, fa) =>
    selectOrgScopedSql(
      "contact-role-assignments",
      "contact_role_assignment",
      id,
      fa,
      "",
    ),
  "contact-tags": (id, fa) =>
    selectOrgScopedSql("contact-tags", "contact_tag", id, fa, ""),
  "contact-tag-assignments": (id, fa) =>
    selectOrgScopedSql(
      "contact-tag-assignments",
      "contact_tag_assignment",
      id,
      fa,
      "",
    ),
  "contact-segments": (id, fa) =>
    selectOrgScopedSql("contact-segments", "contact_segment", id, fa, ""),
  "segment-members": (id, fa) =>
    selectOrgScopedSql("segment-members", "segment_member", id, fa, ""),
  "contact-relationships": (id, fa) =>
    selectOrgScopedSql(
      "contact-relationships",
      "contact_relationship",
      id,
      fa,
      "",
    ),
  "contact-duplicate-candidates": (id, fa) =>
    selectOrgScopedSql(
      "contact-duplicate-candidates",
      "contact_duplicate_candidate",
      id,
      fa,
      "",
    ),
  "assignment-rules": (id, fa) =>
    selectOrgScopedSql("assignment-rules", "assignment_rule", id, fa, ""),
  activities: (id, fa) => selectOrgScopedSql("activities", "activity", id, fa, ""),
  "utm-campaigns": (id, fa) =>
    selectOrgScopedSql("utm-campaigns", "utm_campaign", id, fa, ""),
  "utm-media": (id, fa) => selectOrgScopedSql("utm-media", "utm_medium", id, fa, ""),
  "utm-sources": (id, fa) =>
    selectOrgScopedSql("utm-sources", "utm_source", id, fa, ""),
  "privacy-consent": (id, fa) =>
    selectOrgScopedSql("privacy-consent", "privacy_consent", id, fa, ""),
  "contact-communication-preferences": (id, fa) =>
    selectOrgScopedSql(
      "contact-communication-preferences",
      "contact_communication_preference",
      id,
      fa,
      "",
    ),
  "crm-forecast-snapshots": (id, fa) =>
    selectOrgScopedSql(
      "crm-forecast-snapshots",
      "crm_forecast_snapshot",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "lead-scores": (id, fa) =>
    selectOrgScopedSql("lead-scores", "lead_score", id, fa, "", " ORDER BY id DESC"),
  "lead-score-factors": (id, fa) =>
    selectOrgScopedSql("lead-score-factors", "lead_score_factor", id, fa, ""),
  "contact-segment-rules": (id, fa) =>
    selectOrgScopedSql(
      "contact-segment-rules",
      "contact_segment_rule",
      id,
      fa,
      "",
      " ORDER BY sequence ASC",
    ),
  "contact-relationship-insights": (id, fa) =>
    selectOrgScopedSql(
      "contact-relationship-insights",
      "contact_relationship_insight",
      id,
      fa,
      "",
    ),
  "crm-conversations": (id, fa) =>
    selectOrgScopedSql(
      "crm-conversations",
      "crm_conversation",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "crm-conversation-messages": (id, fa) =>
    selectOrgScopedSql(
      "crm-conversation-messages",
      "crm_conversation_message",
      id,
      fa,
      "",
      " ORDER BY id ASC",
    ),
  projects: (id, fa) =>
    selectOrgScopedSql("projects", "project_project", id, fa, ""),
  tasks: (id, fa) => selectOrgScopedSql("tasks", "project_task", id, fa, ""),
  timesheets: (id, fa) =>
    selectOrgScopedSql("timesheets", "project_timesheet", id, fa, ""),
  "timesheets-to-validate": (id, fa) =>
    selectOrgScopedSql(
      "timesheets-to-validate",
      "project_timesheet",
      id,
      fa,
      " AND validation_status = 'draft' AND timesheet_invoice_id IS NULL",
    ),
  "timesheets-unbilled": (id, fa) =>
    selectOrgScopedSql(
      "timesheets-unbilled",
      "project_timesheet",
      id,
      fa,
      " AND validation_status = 'validated' AND timesheet_invoice_type = 'billable' AND timesheet_invoice_id IS NULL",
    ),
  "project-rate-cards": (id, fa) =>
    selectOrgScopedSql("project-rate-cards", "project_rate_card", id, fa, ""),
  "project-rate-card-lines": (id, fa) =>
    selectOrgScopedSql(
      "project-rate-card-lines",
      "project_rate_card_line",
      id,
      fa,
      "",
    ),
  "working-calendars": (id, fa) =>
    selectOrgScopedSql("working-calendars", "working_calendar", id, fa, ""),
  "public-holidays": (id, fa) =>
    selectOrgScopedSql("public-holidays", "public_holiday", id, fa, ""),
  "resource-allocations": (id, fa) =>
    selectOrgScopedSql(
      "resource-allocations",
      "resource_allocation",
      id,
      fa,
      "",
    ),
  /** Materialised capacity: available − leave − allocations − actual hours. */
  "resource-capacity-by-employee": (id, fa) =>
    selectOrgScopedSql(
      "resource-capacity-by-employee",
      "resource_capacity_snapshot",
      id,
      fa,
      "",
    ),
  /** Materialised project margin: billed/unbilled revenue, labor, expenses. */
  "project-margin-by-project": (id, fa) =>
    selectOrgScopedSql(
      "project-margin-by-project",
      "project_margin_snapshot",
      id,
      fa,
      "",
    ),
  /** Materialised utilisation: available vs billable/non-billable hours. */
  "resource-utilisation-by-employee": (id, fa) =>
    selectOrgScopedSql(
      "resource-utilisation-by-employee",
      "resource_utilisation_snapshot",
      id,
      fa,
      "",
    ),
  "project-milestones": (id, fa) =>
    selectOrgScopedSql("project-milestones", "project_milestone", id, fa, ""),
  "capacity-forecast-by-employee": (id, fa) =>
    selectOrgScopedSql(
      "capacity-forecast-by-employee",
      "capacity_forecast_snapshot",
      id,
      fa,
      "",
    ),
  "project-baselines": (id, fa) =>
    selectOrgScopedSql("project-baselines", "project_baseline", id, fa, ""),
  "project-change-orders": (id, fa) =>
    selectOrgScopedSql(
      "project-change-orders",
      "project_change_order",
      id,
      fa,
      "",
    ),
  "project-earned-value-by-project": (id, fa) =>
    selectOrgScopedSql(
      "project-earned-value-by-project",
      "project_earned_value_snapshot",
      id,
      fa,
      "",
    ),
  "project-subcontractor-costs": (id, fa) =>
    selectOrgScopedSql(
      "project-subcontractor-costs",
      "project_subcontractor_cost",
      id,
      fa,
      "",
    ),
  "project-revenue-schedules": (id, fa) =>
    selectOrgScopedSql(
      "project-revenue-schedules",
      "project_revenue_schedule",
      id,
      fa,
      "",
    ),
  "project-revenue-lines": (id, fa) =>
    selectOrgScopedSql(
      "project-revenue-lines",
      "project_revenue_line",
      id,
      fa,
      "",
    ),
  "project-integration-intents": (id, fa) =>
    selectOrgScopedSql(
      "project-integration-intents",
      "project_integration_intent",
      id,
      fa,
      "",
    ),
  "hr-resources": (id, fa) =>
    selectOrgScopedSql("hr-resources", "hr_resource", id, fa, ""),
  "hr-skills": (id, fa) =>
    selectOrgScopedSql("hr-skills", "hr_skill", id, fa, ""),
  "hr-employee-skills": (id, fa) =>
    selectOrgScopedSql(
      "hr-employee-skills",
      "hr_employee_skill",
      id,
      fa,
      "",
    ),
  "onboarding-templates": (id, fa) =>
    selectOrgScopedSql("onboarding-templates", "hr_onboarding_template", id, fa, " AND active = true"),
  "onboarding-template-items": (id, fa) =>
    selectOrgScopedSql(
      "onboarding-template-items",
      "hr_onboarding_template_item",
      id,
      fa,
      "",
      " ORDER BY sequence ASC, id ASC",
    ),
  "onboarding-progress": (id, fa) =>
    selectOrgScopedSql("onboarding-progress", "hr_onboarding_progress", id, fa, ""),
  "performance-cycles": (id, fa) =>
    selectOrgScopedSql("performance-cycles", "hr_performance_cycle", id, fa, " AND active = true"),
  "performance-goals": (id, fa) =>
    selectOrgScopedSql("performance-goals", "hr_performance_goal", id, fa, ""),
  "performance-reviews": (id, fa) =>
    selectOrgScopedSql("performance-reviews", "hr_performance_review", id, fa, ""),
  "benefit-plans": (id, fa) =>
    selectOrgScopedSql("benefit-plans", "hr_benefit_plan", id, fa, " AND active = true"),
  "benefit-enrollments": (id, fa) =>
    selectOrgScopedSql("benefit-enrollments", "hr_benefit_enrollment", id, fa, ""),
  "employee-documents": (id, fa) =>
    selectOrgScopedSql("employee-documents", "hr_employee_document", id, fa, " AND active = true"),
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
  "stock-locations": (id, fa) =>
    selectOrgScopedSql("stock-locations", "stock_location", id, fa, ""),
  "stock-moves": (id, fa) =>
    selectOrgScopedSql("stock-moves", "stock_move", id, fa, ""),
  "stock-production-lots": (id, fa) =>
    selectOrgScopedSql(
      "stock-production-lots",
      "stock_production_lot",
      id,
      fa,
      "",
    ),
  "stock-production-serials": (id, fa) =>
    selectOrgScopedSql(
      "stock-production-serials",
      "stock_production_serial",
      id,
      fa,
      "",
    ),
  "stock-cycle-counts": (id, fa) =>
    selectOrgScopedSql("stock-cycle-counts", "stock_cycle_count", id, fa, ""),
  "stock-inventories": (id, fa) =>
    selectOrgScopedSql("stock-inventories", "stock_inventory", id, fa, ""),
  "stock-routes": (id, fa) =>
    selectOrgScopedSql("stock-routes", "stock_route", id, fa, ""),
  "stock-rules": (id, fa) =>
    selectOrgScopedSql("stock-rules", "stock_rule", id, fa, ""),
  "picking-waves": (id, fa) =>
    selectOrgScopedSql("picking-waves", "picking_wave", id, fa, ""),
  "warehouse-tasks": (id, fa) =>
    selectOrgScopedSql("warehouse-tasks", "warehouse_task", id, fa, ""),
  "warehouse-3d-zones": (id, fa) =>
    selectOrgScopedSql("warehouse-3d-zones", "warehouse_3d_zone", id, fa, ""),
  "quality-checks": (id, fa) =>
    selectOrgScopedSql("quality-checks", "quality_check", id, fa, ""),
  "quality-alerts": (id, fa) =>
    selectOrgScopedSql("quality-alerts", "quality_alert", id, fa, ""),
  "replenishment-rules": (id, fa) =>
    selectOrgScopedSql("replenishment-rules", "replenishment_rule", id, fa, ""),
  "barcode-rules": (id, fa) =>
    selectOrgScopedSql("barcode-rules", "barcode_rule", id, fa, ""),
  "barcode-nomenclatures": (id, fa) =>
    selectOrgScopedSql(
      "barcode-nomenclatures",
      "barcode_nomenclature",
      id,
      fa,
      "",
    ),
  "adjustment-reasons": (id, fa) =>
    selectOrgScopedSql("adjustment-reasons", "adjustment_reason", id, fa, ""),
  "serial-lot-traceability": (id, fa) =>
    selectOrgScopedSql(
      "serial-lot-traceability",
      "serial_lot_traceability",
      id,
      fa,
      "",
    ),
  "stock-traceability-reports": (id, fa) =>
    selectOrgScopedSql(
      "stock-traceability-reports",
      "stock_traceability_report",
      id,
      fa,
      "",
    ),
  "stock-packages": (id, fa) =>
    selectOrgScopedSql("stock-packages", "stock_package", id, fa, ""),
  "packaging-materials": (id, fa) =>
    selectOrgScopedSql("packaging-materials", "packaging_material", id, fa, ""),
  "cartonization-results": (id, fa) =>
    selectOrgScopedSql(
      "cartonization-results",
      "cartonization_result",
      id,
      fa,
      "",
    ),
  "inventory-exceptions": (id, fa) =>
    selectOrgScopedSql(
      "inventory-exceptions",
      "inventory_exception",
      id,
      fa,
      " AND state = 'open'",
      " ORDER BY id DESC",
    ),
  "inventory-exceptions-short-atp": (id, fa) =>
    selectOrgScopedSql(
      "inventory-exceptions-short-atp",
      "inventory_exception",
      id,
      fa,
      " AND state = 'open' AND exception_type = 'short_atp'",
      " ORDER BY id DESC",
    ),
  "inventory-exceptions-expired-lots": (id, fa) =>
    selectOrgScopedSql(
      "inventory-exceptions-expired-lots",
      "inventory_exception",
      id,
      fa,
      " AND state = 'open' AND exception_type = 'expired_lot'",
      " ORDER BY id DESC",
    ),
  "inventory-exceptions-open-qc": (id, fa) =>
    selectOrgScopedSql(
      "inventory-exceptions-open-qc",
      "inventory_exception",
      id,
      fa,
      " AND state = 'open' AND exception_type = 'open_qc'",
      " ORDER BY id DESC",
    ),
  "warehouse-sync-intents": (id, fa) =>
    selectOrgScopedSql(
      "warehouse-sync-intents",
      "warehouse_sync_intent",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "warehouse-sync-intents-pending": (id, fa) =>
    selectOrgScopedSql(
      "warehouse-sync-intents-pending",
      "warehouse_sync_intent",
      id,
      fa,
      " AND status = 'pending'",
      " ORDER BY id DESC",
    ),
  "purchase-orders": (id, fa) =>
    selectOrgScopedSql("purchase-orders", "purchase_order", id, fa, ""),
  "purchase-orders-to-approve": (id, fa) =>
    selectOrgScopedSql(
      "purchase-orders-to-approve",
      "purchase_order",
      id,
      fa,
      " AND state = 'ToApprove'",
    ),
  "purchase-orders-partial-receipt": (id, fa) =>
    selectOrgScopedSql(
      "purchase-orders-partial-receipt",
      "purchase_order",
      id,
      fa,
      " AND receipt_status = 'partial'",
    ),
  "purchase-order-lines": (id, fa) =>
    selectOrgScopedSql(
      "purchase-order-lines",
      "purchase_order_line",
      id,
      fa,
      "",
    ),
  "purchase-order-lines-over-billed": (id, fa) =>
    selectOrgScopedSql(
      "purchase-order-lines-over-billed",
      "purchase_order_line",
      id,
      fa,
      " AND match_state = 'over_billed'",
    ),
  "landed-costs": (id, fa) =>
    selectOrgScopedSql("landed-costs", "stock_landed_cost", id, fa, ""),
  "landed-cost-lines": (id, fa) =>
    selectOrgScopedSql(
      "landed-cost-lines",
      "stock_landed_cost_lines",
      id,
      fa,
      "",
    ),
  "supplier-intakes": (id, fa) =>
    selectOrgScopedSql(
      "supplier-intakes",
      "supplier_intake_request",
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
  "purchase-requisition-lines": (id, fa) =>
    selectOrgScopedSql(
      "purchase-requisition-lines",
      "purchase_requisition_line",
      id,
      fa,
      "",
    ),
  "purchase-rfqs": (id, fa) =>
    selectOrgScopedSql("purchase-rfqs", "purchase_rfq", id, fa, "", " ORDER BY id DESC"),
  "purchase-rfq-lines": (id, fa) =>
    selectOrgScopedSql(
      "purchase-rfq-lines",
      "purchase_rfq_line",
      id,
      fa,
      "",
    ),
  "purchase-rfq-bids": (id, fa) =>
    selectOrgScopedSql("purchase-rfq-bids", "purchase_rfq_bid", id, fa, ""),
  "purchase-returns": (id, fa) =>
    selectOrgScopedSql(
      "purchase-returns",
      "purchase_return",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "purchase-return-lines": (id, fa) =>
    selectOrgScopedSql(
      "purchase-return-lines",
      "purchase_return_line",
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
    selectOrgScopedSql("employees", "hr_employee", id, fa, " AND is_active = true"),
  "my-employee": (id, fa) =>
    selectOrgScopedSql("my-employee", "hr_employee", id, fa, " AND is_active = true"),
  "direct-reports": (id, fa) =>
    selectOrgScopedSql("direct-reports", "hr_employee", id, fa, " AND is_active = true"),
  departments: (id, fa) =>
    selectOrgScopedSql("departments", "hr_department", id, fa, ""),
  "job-positions": (id, fa) =>
    selectOrgScopedSql("job-positions", "hr_job_position", id, fa, ""),
  applicants: (id, fa) =>
    selectOrgScopedSql("applicants", "hr_applicant", id, fa, ""),
  "leave-types": (id, fa) =>
    selectOrgScopedSql("leave-types", "hr_leave_type", id, fa, ""),
  "payroll-structures": (id, fa) =>
    selectOrgScopedSql("payroll-structures", "hr_payroll_structure", id, fa, ""),
  "salary-rules": (id, fa) =>
    selectOrgScopedSql("salary-rules", "hr_salary_rule", id, fa, ""),
  "leave-requests": (id, fa) =>
    selectOrgScopedSql("leave-requests", "hr_leave", id, fa, ""),
  "leaves-to-approve": (id, fa) =>
    selectOrgScopedSql(
      "leaves-to-approve",
      "hr_leave",
      id,
      fa,
      " AND (state = 'confirm' OR state = 'validatedOne')",
    ),
  contracts: (id, fa) =>
    selectOrgScopedSql("contracts", "hr_contract", id, fa, ""),
  attendance: (id, fa) =>
    selectOrgScopedSql("attendance", "hr_attendance", id, fa, ""),
  "compensation-events": (id, fa) =>
    selectOrgScopedSql(
      "compensation-events",
      "hr_compensation_event",
      id,
      fa,
      "",
      " ORDER BY effective_from DESC",
    ),
  "work-schedules": (id, fa) =>
    selectOrgScopedSql("work-schedules", "hr_work_schedule", id, fa, ""),
  "labor-cost-snapshots": (id, fa) =>
    selectOrgScopedSql(
      "labor-cost-snapshots",
      "hr_labor_cost_snapshot",
      id,
      fa,
      "",
      " ORDER BY period_start DESC, id DESC",
    ),
  "shift-opt-jobs": (id, fa) =>
    selectOrgScopedSql(
      "shift-opt-jobs",
      "hr_shift_opt_job",
      id,
      fa,
      "",
      " ORDER BY created_at DESC, id DESC",
    ),
  "global-assignments": (id, fa) =>
    selectOrgScopedSql(
      "global-assignments",
      "hr_global_assignment",
      id,
      fa,
      "",
      " ORDER BY date_from DESC, id DESC",
    ),
  "hr-capacity-forecast": (id, fa) =>
    selectOrgScopedSql(
      "hr-capacity-forecast",
      "hr_capacity_forecast",
      id,
      fa,
      "",
      " ORDER BY period_start DESC, id DESC",
    ),
  payslips: (id, fa) => selectOrgScopedSql("payslips", "hr_payslip", id, fa, ""),
  "payslips-to-export": (id, fa) =>
    selectOrgScopedSql(
      "payslips-to-export",
      "hr_payslip",
      id,
      fa,
      " AND state = 'verify'",
    ),
  "hr-integration-intents": (id, fa) =>
    selectOrgScopedSql(
      "hr-integration-intents",
      "hr_integration_intent",
      id,
      fa,
      " AND status = 'pending'",
    ),
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
    selectOrgScopedSql(
      "documents",
      "document",
      id,
      fa,
      " AND is_deleted = false",
    ),
  "documents-deleted": (id, fa) =>
    selectOrgScopedSql(
      "documents-deleted",
      "document",
      id,
      fa,
      " AND is_deleted = true",
    ),
  "document-folders": (id, fa) =>
    selectOrgScopedSql("document-folders", "doc_folder", id, fa, ""),
  "document-versions": (id, fa) =>
    selectOrgScopedSql("document-versions", "document_version", id, fa, ""),
  "document-templates": (id, fa) =>
    selectOrgScopedSql("document-templates", "document_template", id, fa, ""),
  "mail-templates": (id, fa) =>
    selectOrgScopedSql("mail-templates", "mail_template", id, fa, ""),
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
  "sod-conflict-rules": (id, fa) =>
    selectOrgScopedSql(
      "sod-conflict-rules",
      "sod_conflict_rule",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "fx-revaluation-runs": (id, fa) =>
    selectOrgScopedSql(
      "fx-revaluation-runs",
      "fx_revaluation_run",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "amortization-schedules": (id, fa) =>
    selectOrgScopedSql(
      "amortization-schedules",
      "amortization_schedule",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "amortization-lines": (id, fa) =>
    selectOrgScopedSql(
      "amortization-lines",
      "amortization_line",
      id,
      fa,
      "",
      " ORDER BY schedule_id ASC, sequence ASC",
    ),
  "partner-credit-controls": (id, fa) =>
    selectOrgScopedSql(
      "partner-credit-controls",
      "partner_credit_control",
      id,
      fa,
      "",
    ),
  "partner-credit-holds": (id, fa) =>
    selectOrgScopedSql(
      "partner-credit-holds",
      "partner_credit_control",
      id,
      fa,
      " AND payment_hold = true",
    ),
  "delegated-admin-scopes": (id, fa) =>
    selectOrgScopedSql(
      "delegated-admin-scopes",
      "delegated_admin_scope",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-plans": (id, fa) =>
    selectOrgScopedSql(
      "subscription-plans",
      "subscription_plan",
      id,
      fa,
      "",
    ),
  "subscription-lines": (id, fa) =>
    selectOrgScopedSql(
      "subscription-lines",
      "subscription_line",
      id,
      fa,
      "",
      " ORDER BY subscription_id ASC, id ASC",
    ),
  "subscription-billing-runs": (id, fa) =>
    selectOrgScopedSql(
      "subscription-billing-runs",
      "subscription_billing_run",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-amendments": (id, fa) =>
    selectOrgScopedSql(
      "subscription-amendments",
      "subscription_amendment",
      id,
      fa,
      "",
      " ORDER BY subscription_id ASC, version DESC",
    ),
  "subscription-usage-events": (id, fa) =>
    selectOrgScopedSql(
      "subscription-usage-events",
      "subscription_usage_event",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-usage-charges": (id, fa) =>
    selectOrgScopedSql(
      "subscription-usage-charges",
      "subscription_usage_charge",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-price-tiers": (id, fa) =>
    selectOrgScopedSql(
      "subscription-price-tiers",
      "subscription_price_tier",
      id,
      fa,
      "",
      " ORDER BY plan_id ASC, sequence ASC",
    ),
  "subscription-commitments": (id, fa) =>
    selectOrgScopedSql(
      "subscription-commitments",
      "subscription_commitment",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-bundles": (id, fa) =>
    selectOrgScopedSql(
      "subscription-bundles",
      "subscription_bundle",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-bundle-items": (id, fa) =>
    selectOrgScopedSql(
      "subscription-bundle-items",
      "subscription_bundle_item",
      id,
      fa,
      "",
      " ORDER BY bundle_id ASC, sequence ASC",
    ),
  "subscription-rating-backlog": (id, fa) =>
    selectOrgScopedSql(
      "subscription-rating-backlog",
      "subscription_usage_event",
      id,
      fa,
      " AND status = 'pending'",
      " ORDER BY id ASC",
    ),
  "subscription-collections": (id, fa) =>
    selectOrgScopedSql(
      "subscription-collections",
      "subscription_collection",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-entitlements": (id, fa) =>
    selectOrgScopedSql(
      "subscription-entitlements",
      "subscription_entitlement",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-payment-intents": (id, fa) =>
    selectOrgScopedSql(
      "subscription-payment-intents",
      "subscription_payment_intent",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-tax-settle-intents": (id, fa) =>
    selectOrgScopedSql(
      "subscription-tax-settle-intents",
      "subscription_tax_settle_intent",
      id,
      fa,
      "",
      " ORDER BY id DESC",
    ),
  "subscription-price-indexes": (id, fa) =>
    selectOrgScopedSql(
      "subscription-price-indexes",
      "subscription_price_index",
      id,
      fa,
      "",
      " ORDER BY index_code ASC, period_key DESC",
    ),
  "subscription-due-to-bill": (id, fa) =>
    selectOrgScopedSql(
      "subscription-due-to-bill",
      "subscription_collection",
      id,
      fa,
      " AND due_to_bill = true",
      " ORDER BY id ASC",
    ),
  "subscription-past-due": (id, fa) =>
    selectOrgScopedSql(
      "subscription-past-due",
      "subscription_collection",
      id,
      fa,
      " AND past_due = true",
      " ORDER BY id ASC",
    ),
  "subscription-amend-pending": (id, fa) =>
    selectOrgScopedSql(
      "subscription-amend-pending",
      "subscription_collection",
      id,
      fa,
      " AND amend_pending = true",
      " ORDER BY id ASC",
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
  "expense-sheets-to-approve": (id, fa) =>
    selectOrgScopedSql(
      "expense-sheets-to-approve",
      "expense_sheet",
      id,
      fa,
      " AND state = 'Submitted'",
    ),
  "expenses-missing-receipt": (id, fa) =>
    selectOrgScopedSql(
      "expenses-missing-receipt",
      "hr_expense",
      id,
      fa,
      " AND has_receipt = false AND state = 'Draft'",
    ),
  "expense-receipts": (id, fa) =>
    selectOrgScopedSql("expense-receipts", "hr_expense_receipt", id, fa, ""),
  "expense-card-statement-unmatched": (id, fa) =>
    selectOrgScopedSql(
      "expense-card-statement-unmatched",
      "expense_card_statement_line",
      id,
      fa,
      " AND status = 'unmatched'",
    ),
  "expense-advances": (id, fa) =>
    selectOrgScopedSql("expense-advances", "hr_expense_advance", id, fa, ""),
  "expense-policy-exceptions": (id, fa) =>
    selectOrgScopedSql(
      "expense-policy-exceptions",
      "hr_expense_policy_exception",
      id,
      fa,
      " AND state = 'Pending'",
    ),
  "expense-mileage-rates": (id, fa) =>
    selectOrgScopedSql(
      "expense-mileage-rates",
      "hr_expense_mileage_rate",
      id,
      fa,
      " AND active = true",
    ),
  "expense-per-diem-rates": (id, fa) =>
    selectOrgScopedSql(
      "expense-per-diem-rates",
      "hr_expense_per_diem_rate",
      id,
      fa,
      " AND active = true",
    ),
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
  if (resource === "fixed-assets") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("fixed-assets", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_asset WHERE ${filter}`]
  }
  if (resource === "intercompany-rules") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("intercompany-rules", fa).join(", ")
    const filter = companyIdsDualFieldOr("source_company_id", "destination_company_id", ids)
    return [
      `SELECT ${c} FROM intercompany_rule WHERE ${filter} ORDER BY sequence ASC`,
    ]
  }
  if (resource === "intercompany-transactions") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("intercompany-transactions", fa).join(", ")
    const filter = companyIdsDualFieldOr("origin_company_id", "destination_company_id", ids)
    return [
      `SELECT ${c} FROM intercompany_transaction WHERE ${filter} ORDER BY id DESC`,
    ]
  }
  if (resource === "depreciation-lines") {
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
  if (resource === "fiscal-years") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("fiscal-years", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_fiscal_year WHERE ${filter}`]
  }
  if (resource === "account-periods") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("account-periods", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM account_period WHERE ${filter}`]
  }
  if (resource === "consolidation-elimination-entries") {
    if (!ids?.length) return null
    const c = resolveHttpSqlColumns("consolidation-elimination-entries", fa).join(", ")
    const filter = companyIdsEqualityOr("company_id", ids)
    return [`SELECT ${c} FROM consolidation_elimination_entry WHERE ${filter}`]
  }
  if (resource === "consolidation-journals") {
    // Indexed company_ids vector — mirror journals that touch selected companies via elimination.
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
    if (!ctx.identityHex || ctx.identityHex === "unknown") return null;
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const idLit = identitySqlLiteral(ctx.identityHex);
    const cols = resolveHttpSqlColumns("my-employee", ctx.fieldAccess).join(", ");
    return [
      `SELECT ${cols} FROM hr_employee WHERE organization_id = ${Number(org)} AND user_id = ${idLit} AND is_active = true`,
    ];
  }

  if (r === "direct-reports") {
    const managerId = ctx.managerEmployeeId;
    if (managerId === undefined || managerId === null || managerId <= 0) return null;
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const cols = resolveHttpSqlColumns("direct-reports", ctx.fieldAccess).join(", ");
    return [
      `SELECT ${cols} FROM hr_employee WHERE organization_id = ${Number(org)} AND parent_id = ${Number(managerId)} AND is_active = true`,
    ];
  }

  if (r === "employee-documents") {
    const org = ctx.organizationId;
    if (org === undefined || org === null || Number.isNaN(Number(org))) return null;
    const cols = resolveHttpSqlColumns("employee-documents", ctx.fieldAccess).join(", ");
    let extra = " AND active = true";
    if (!hasHrPermission(ctx.fieldAccess, "hr_employee", "view_pii")) {
      extra += " AND purpose NOT IN ('tax_id', 'identity')";
    }
    return [
      `SELECT ${cols} FROM hr_employee_document WHERE organization_id = ${Number(org)}${extra}`,
    ];
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
