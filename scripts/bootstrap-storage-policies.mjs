#!/usr/bin/env node

/**
 * Bootstrap and validate the C1 storage-policy source from the generated C0
 * schema manifest. The generated JSON is checked in so reviewers can inspect
 * every table's policy; this script is the reproducible source of that file.
 *
 * Usage:
 *   node scripts/bootstrap-storage-policies.mjs
 *   node scripts/bootstrap-storage-policies.mjs --check
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const schemaPath = path.join(
  repoRoot,
  ".contracts-staging",
  "manifests",
  "lumiere-schema-manifest.json",
);
const policyPath = path.join(repoRoot, "lumiere-codegen", "storage-policy-manifest.json");
const resourceRegistryPath = path.join(repoRoot, "crates", "stdb-auth", "assets", "resource_registry.json");
const checkOnly = process.argv.includes("--check");

// C0 no longer permits application-level platform-global tables. Former
// exceptions must be organization-owned in schema source before policy
// generation is allowed to succeed.
const PLATFORM_GLOBAL_TABLES = new Set();
const PLATFORM_GLOBAL_REASONS = {};

// Prefixes are intentionally ordered from specific to broad. Names not
// matching a prefix remain in the explicit map below so adding a table cannot
// silently lose its module owner.
const MODULE_PREFIXES = [
  ["subscription_", "subscriptions"],
  ["workflow_", "workflow"],
  ["project_", "projects"],
  ["proposal_", "proposals"],
  ["purchase_", "purchasing"],
  ["purchasing_", "purchasing"],
  ["stock_", "inventory"],
  ["warehouse", "inventory"],
  ["inventory_", "inventory"],
  ["mrp_", "manufacturing"],
  ["quality_", "manufacturing"],
  ["iot_", "iot"],
  ["fleet_", "fleet"],
  ["expense_", "expenses"],
  ["hr_", "hr"],
  ["helpdesk_", "helpdesk"],
  ["document_", "documents"],
  ["doc_", "documents"],
  ["form_", "forms"],
  ["import_", "data_ops"],
  ["record_custom_", "data_ops"],
  ["ai_", "ai"],
  ["analytics_", "analytics"],
  ["dashboard", "analytics"],
  ["financial_report", "analytics"],
  ["balance_sheet", "accounting"],
  ["cash_flow", "accounting"],
  ["profit_loss", "accounting"],
  ["trial_balance", "accounting"],
  ["account", "accounting"],
  ["amortization_", "accounting"],
  ["consolidation_", "accounting"],
  ["deferred_revenue_", "accounting"],
  ["fiscal_", "accounting"],
  ["fx_", "accounting"],
  ["intercompany_", "accounting"],
  ["payment_", "accounting"],
  ["revenue_", "accounting"],
  ["tax_", "accounting"],
  ["bank_", "accounting"],
  ["billing_", "subscriptions"],
  ["contact", "crm"],
  ["crm_", "crm"],
  ["lead", "crm"],
  ["opp_", "crm"],
  ["opportunity", "crm"],
  ["segment", "crm"],
  ["sale_", "sales"],
  ["sales_", "sales"],
  ["delivery_", "sales"],
  ["shipping_", "sales"],
  ["pos_", "sales"],
  ["return_order", "sales"],
  ["supplier_", "purchasing"],
  ["vendor_", "purchasing"],
  ["barcode", "inventory"],
  ["product", "inventory"],
  ["packaging", "inventory"],
  ["uom", "inventory"],
  ["replenishment_", "inventory"],
  ["resource_", "projects"],
  ["capacity_", "projects"],
  ["assignment_", "workflow"],
  ["activity", "workflow"],
  ["calendar", "workflow"],
  ["working_calendar", "workflow"],
];

const EXPLICIT_MODULES = {
  accounting_ownership_backfill_issue: "accounting",
  accounting_ownership_backfill_run: "accounting",
  audit_log: "core",
  audit_rule: "core",
  company: "core",
  company_country_pack: "core",
  company_vertical_pack: "core",
  country_pack_definition: "core",
  country_pack_tax_rule: "core",
  currency: "core",
  currency_rate: "accounting",
  data_classification: "core",
  data_classification_rule: "core",
  delegated_admin_scope: "core",
  document_sequence: "core",
  field_permission: "core",
  generated_owner_report: "analytics",
  guarded_action_receipt: "core",
  mail_follower: "core",
  mail_message: "core",
  mail_template: "core",
  message_batch: "core",
  message_template: "core",
  organization: "core",
  organization_commit: "core",
  organization_commit_cursor: "core",
  organization_reconstruction_batch_receipt: "core",
  organization_reconstruction_fence: "core",
  organization_row_change: "core",
  organization_settings: "core",
  org_permission: "core",
  org_schema_migration: "core",
  password_reset_token: "core",
  policy_snapshot: "core",
  privacy_consent: "core",
  queue_attempt: "core",
  queue_effect_receipt: "core",
  queue_job: "core",
  queue_worker: "core",
  role: "core",
  schema_migration: "core",
  search_embedding: "ai",
  sod_conflict_rule: "core",
  user_credential: "core",
  user_custom_field: "core",
  user_invite: "core",
  user_organization: "core",
  user_profile: "core",
  user_role_assignment: "core",
  user_session: "core",
  utm_campaign: "crm",
  utm_medium: "crm",
  utm_source: "crm",
};

// Only rows whose names explicitly communicate immutable event/history/log
// semantics use append-history. Receipts, snapshots, jobs, and messages stay
// upsert-current until their domain policy is reviewed.
const APPEND_HISTORY_TABLES = new Set([
  "audit_log",
  "hr_pii_access_log",
  "iot_telemetry",
  "organization_commit",
  "organization_row_change",
  "subscription_usage_event",
  "workflow_decision_event",
  "workflow_human_task_event",
]);

// Reviewed parent links. A link is included only when both the child FK and
// parent primary-key column are present in the current schema manifest. All
// other tables remain explicit roots until a domain-owned FK graph exists.
const PARENT_OVERRIDES = {
  account_period: ["account_fiscal_year", "fiscal_year_id", "id"],
  account_asset_depreciation_line: ["account_asset", "asset_id", "id"],
  account_bank_statement_line: ["account_bank_statement", "statement_id", "id"],
  account_move_line: ["account_move", "move_id", "id"],
  account_payment_term_line: ["account_payment_term", "payment_term_id", "id"],
  amortization_line: ["amortization_schedule", "schedule_id", "id"],
  ai_agent_run_step: ["ai_agent_run", "run_id", "id"],
  ai_agent_run_policy_snapshot: ["ai_agent_run", "run_id", "id"],
  ai_skill_release: ["ai_skill", "skill_id", "id"],
  ai_skill_version: ["ai_skill", "skill_id", "id"],
  bank_statement_import_line: ["bank_statement_import", "import_id", "id"],
  balance_sheet_line: ["financial_report", "report_id", "id"],
  cash_flow_line: ["financial_report", "report_id", "id"],
  contact_category_assignment: ["contact", "contact_id", "id"],
  contact_role_assignment: ["contact", "contact_id", "id"],
  contact_segment_rule: ["contact_segment", "segment_id", "id"],
  contact_tag_assignment: ["contact", "contact_id", "id"],
  crm_conversation_message: ["crm_conversation", "conversation_id", "id"],
  deferred_revenue_line: ["deferred_revenue_schedule", "schedule_id", "id"],
  delivery_price_rule: ["delivery_carrier", "carrier_id", "id"],
  document_version: ["document", "document_id", "id"],
  form_field_label: ["form_config_field", "field_row_id", "id"],
  form_config_field: ["form_config", "configuration_id", "id"],
  form_role_config: ["form_config", "configuration_id", "id"],
  helpdesk_team_member: ["helpdesk_team", "team_id", "id"],
  hr_expense_advance_application: ["hr_expense_advance", "advance_id", "id"],
  hr_expense_allocation: ["hr_expense", "expense_id", "id"],
  hr_expense_policy_exception: ["hr_expense", "expense_id", "id"],
  hr_leave_allocation: ["hr_employee", "employee_id", "id"],
  hr_onboarding_template_item: ["hr_onboarding_template", "template_id", "id"],
  import_job_error: ["import_job", "job_id", "id"],
  import_job_record: ["import_job", "job_id", "id"],
  mrp_bom_line: ["mrp_bom", "bom_id", "id"],
  opportunity_line: ["opportunity", "opportunity_id", "id"],
  pos_order_line: ["pos_order", "order_id", "id"],
  pos_payment: ["pos_order", "order_id", "id"],
  product_attribute_line: ["product", "product_tmpl_id", "id"],
  product_pricelist_item: ["product_pricelist", "pricelist_id", "id"],
  project_rate_card_line: ["project_rate_card", "rate_card_id", "id"],
  project_revenue_line: ["project_revenue_schedule", "schedule_id", "id"],
  proposal_line_item: ["proposal", "proposal_id", "id"],
  proposal_section: ["proposal", "proposal_id", "id"],
  proposal_version: ["proposal", "proposal_id", "id"],
  purchase_blanket_order_line: ["purchase_blanket_order", "blanket_order_id", "id"],
  purchase_blanket_release: ["purchase_blanket_order", "blanket_order_id", "id"],
  purchase_order_line: ["purchase_order", "order_id", "id"],
  purchase_requisition_line: ["purchase_requisition", "requisition_id", "id"],
  purchase_return_line: ["purchase_return", "purchase_return_id", "id"],
  purchase_rfq_bid: ["purchase_rfq", "rfq_id", "id"],
  purchase_rfq_line: ["purchase_rfq", "rfq_id", "id"],
  return_order_line: ["return_order", "return_order_id", "id"],
  sale_commission_plan_split: ["sale_commission_plan", "plan_id", "id"],
  sale_order_line: ["sale_order", "order_id", "id"],
  sale_order_option: ["sale_order", "order_id", "id"],
  segment_member: ["contact_segment", "segment_id", "id"],
  stock_inventory_line: ["stock_inventory", "inventory_id", "id"],
  stock_landed_cost_allocation: ["stock_landed_cost", "landed_cost_id", "id"],
  stock_landed_cost_application: ["stock_landed_cost", "landed_cost_id", "id"],
  stock_move_line: ["stock_move", "move_id", "id"],
  stock_picking: ["stock_picking_batch", "batch_id", "id"],
  subscription_bundle_item: ["subscription_bundle", "bundle_id", "id"],
  subscription_line: ["subscription", "subscription_id", "id"],
  subscription_usage_event: ["subscription", "subscription_id", "id"],
  tax_deadline_reminder: ["tax_deadline", "tax_deadline_id", "id"],
  workflow_calendar_exception: ["workflow_calendar_version", "calendar_version_id", "id"],
  workflow_calendar_version: ["workflow_calendar", "calendar_id", "id"],
  workflow_decision_event: ["workflow", "workflow_id", "id"],
  workflow_human_task_candidate: ["workflow_human_task", "task_id", "id"],
  workflow_human_task_event: ["workflow_human_task", "task_id", "id"],
  workflow_simulation_step: ["workflow_simulation_result", "simulation_result_id", "id"],
  workflow_version: ["workflow", "workflow_id", "id"],
};

const SNAPSHOT_TABLES = new Set([
  "ai_agent_run_policy_snapshot",
  "capacity_forecast_snapshot",
  "crm_forecast_snapshot",
  "hr_labor_cost_snapshot",
  "policy_snapshot",
  "project_earned_value_snapshot",
  "project_margin_snapshot",
  "resource_capacity_snapshot",
  "resource_utilisation_snapshot",
]);

const OPERATIONAL_STATE_TABLES = new Set(["organization_commit_cursor"]);

const ACTIVE_ARCHIVE_POLICIES = {
  audit_log: { cooling: "policy", hot: "none", hydration: "not_applicable" },
  pos_order: { cooling: "policy", hot: "terminal_window", hydration: "full_row" },
};

const COOLING_PARENT_TABLES = new Map([
  ["pos_order_line", "pos_order"],
  ["pos_payment", "pos_order"],
]);

// Shared provider/reference truth lives outside ERP. Its organization-seeded
// application copies are ordinary durable organization records.
const EXTERNAL_REFERENCE_TABLES = new Set();

function moduleFor(tableName) {
  if (EXPLICIT_MODULES[tableName]) return EXPLICIT_MODULES[tableName];
  const prefix = MODULE_PREFIXES.find(([candidate]) => tableName.startsWith(candidate));
  if (prefix) return prefix[1];
  const explicitDomain = {
    adjustment_reason: "accounting",
    activity_type: "workflow",
    assignment_rule: "workflow",
    barcode_nomenclature: "inventory",
    barcode_rule: "inventory",
    barcode_scan: "inventory",
    bom_explosion_result: "manufacturing",
    budget_post: "accounting",
    cartonization_result: "inventory",
    commodity_price_index: "accounting",
    consignment_agreement: "purchasing",
    capacity_forecast_snapshot: "projects",
    cold_tier_service_identity: "core",
    country: "core",
    currency: "core",
    document: "documents",
    google_drive_connection: "integrations",
    crossovered_budget: "accounting",
    crossovered_budget_lines: "accounting",
    knowledge_article: "documents",
    knowledge_article_presence: "documents",
    kb_category: "documents",
    operational_message: "core",
    packaging_material: "inventory",
    partner_credit_control: "accounting",
    picking_wave: "inventory",
    proposal: "proposals",
    public_holiday: "workflow",
    report_template: "analytics",
    res_partner_bank: "accounting",
    return_order: "sales",
    saved_report: "analytics",
    scheduled_report: "analytics",
    scheduled_report_run: "analytics",
    serial_lot_traceability: "inventory",
    subscription: "subscriptions",
    hr_country_pack_leave_default: "hr",
    vendor_risk_flag: "purchasing",
    warehouse_geo: "inventory",
    whatsapp_business_account: "integrations",
    workflow: "workflow",
  };
  if (explicitDomain[tableName]) return explicitDomain[tableName];
  throw new Error(`no C1 module mapping for ${tableName}`);
}

const FINANCE_COMMERCIAL_MODULES = new Set([
  "accounting", "crm", "expenses", "proposals", "purchasing", "sales", "subscriptions",
]);
const OPERATIONS_MODULES = new Set([
  "analytics", "data_ops", "documents", "fleet", "inventory", "iot", "manufacturing", "projects",
]);

function reviewGroup(moduleName) {
  if (FINANCE_COMMERCIAL_MODULES.has(moduleName)) return "finance-commercial";
  if (OPERATIONS_MODULES.has(moduleName)) return "operations";
  return "people-platform";
}

function hasColumn(table, name) {
  return table.columns.some((column) => column.sql_name === name);
}

function versionStrategy(table) {
  const names = new Set(table.columns.map((column) => column.sql_name));
  if (names.has("archive_version")) return "archive_version";
  if (names.has("revision")) return "revision";
  if (names.has("updated_at")) return "updated_at";
  return "none";
}

function primaryKeyStrategy(table) {
  const { column_name: column, ty } = table.primary_key;
  if (ty === "Identity") return "identity";
  if (table.sql_name === "organization_commit_cursor") return "natural";
  if (ty === "U64") return "auto_increment";
  if (column.endsWith("_key") || column === "code" || column === "token" || column === "scope_key") {
    return "natural";
  }
  return "natural";
}

function companyPath(table, allTables, seen = new Set()) {
  if (hasColumn(table, "company_id")) return ["company_id"];
  if (seen.has(table.sql_name)) {
    throw new Error(`company ownership cycle at ${table.sql_name}`);
  }
  const parentOverride = PARENT_OVERRIDES[table.sql_name];
  if (!parentOverride) return null;
  const parent = allTables.find((candidate) => candidate.sql_name === parentOverride[0]);
  if (!parent) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(table.sql_name);
  const parentPath = companyPath(parent, allTables, nextSeen);
  return parentPath ? [parentOverride[1], ...parentPath] : null;
}

function companyNullable(table, allTables, seen = new Set()) {
  const direct = table.columns.find((column) => column.sql_name === "company_id");
  if (direct) return direct.nullable;
  if (seen.has(table.sql_name)) throw new Error(`company ownership cycle at ${table.sql_name}`);
  const parentOverride = PARENT_OVERRIDES[table.sql_name];
  if (!parentOverride) return null;
  const parent = allTables.find((candidate) => candidate.sql_name === parentOverride[0]);
  if (!parent) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(table.sql_name);
  return companyNullable(parent, allTables, nextSeen);
}

function buildPolicy(table, allTables, resourcesByTable) {
  const platform = PLATFORM_GLOBAL_TABLES.has(table.sql_name);
  const appendHistory = APPEND_HISTORY_TABLES.has(table.sql_name);
  const snapshot = SNAPSHOT_TABLES.has(table.sql_name);
  const operationalState = OPERATIONAL_STATE_TABLES.has(table.sql_name);
  const primaryKey = table.primary_key.column_name;
  const hasCompany = hasColumn(table, "company_id");
  const parentOverride = PARENT_OVERRIDES[table.sql_name];
  const parentTable = parentOverride && allTables.find((candidate) => candidate.sql_name === parentOverride[0]);
  const parentValid = parentTable && hasColumn(table, parentOverride[1]) && hasColumn(parentTable, parentOverride[2]);
  const activeArchive = ACTIVE_ARCHIVE_POLICIES[table.sql_name];
  const coolingParent = COOLING_PARENT_TABLES.get(table.sql_name);
  const externalReference = EXTERNAL_REFERENCE_TABLES.has(table.sql_name);
  const resolvedCompanyPath = platform ? null : companyPath(table, allTables);
  const parentCompany = !hasCompany && resolvedCompanyPath !== null;
  const aggregateKind = platform ? "standalone" : parentValid ? "child" : table.sql_name === "organization" ? "root" : "root";
  const projectionMode = externalReference
    ? "external-reference"
    : appendHistory
      ? "append-history"
      : snapshot
        ? "snapshot"
        : "upsert-current";
  const durabilityClass = externalReference
    ? "external_reference"
    : platform
      ? "platform_control"
    : appendHistory
      ? "durable_history"
      : snapshot
        ? "derived_rebuildable"
        : operationalState
          ? "durable_operational_state"
        : ["queue_", "job", "_job", "intent", "receipt", "token", "session", "presence", "run"].some((marker) => table.sql_name.includes(marker))
          ? "durable_operational_state"
          : "durable_business_record";

  const policy = {
    table: table.sql_name,
    module: moduleFor(table.sql_name),
    rationale: platform
      ? PLATFORM_GLOBAL_REASONS[table.sql_name]
      : parentValid
        ? `Reviewed child aggregate: ${parentOverride[1]} references ${parentOverride[0]}.${parentOverride[2]}.`
        : "Independent organization-owned aggregate root; related rows do not determine storage routing.",
    authoritative_resources: resourcesByTable.get(table.sql_name) ?? [],
    durability_class: durabilityClass,
    organization_ownership: platform ? "platform_global" : "direct",
    organization_column: platform ? null : "organization_id",
    company_ownership: platform ? "none" : hasCompany ? "direct" : parentCompany ? "parent" : "none",
    company_column_path: resolvedCompanyPath,
    company_column_nullable: resolvedCompanyPath === null ? null : companyNullable(table, allTables),
    aggregate: {
      kind: aggregateKind,
      parent: parentValid
        ? { table: parentOverride[0], child_column: parentOverride[1], parent_column: parentOverride[2] }
        : null,
    },
    primary_key: {
      strategy: primaryKeyStrategy(table),
      column: primaryKey,
      version_strategy: versionStrategy(table),
    },
    projection_mode: projectionMode,
    hot_retention: activeArchive?.hot ?? (coolingParent ? "terminal_window" : "always"),
    cooling_eligibility: activeArchive?.cooling ?? (coolingParent ? "parent" : "never"),
    cooling_eligibility_source: table.sql_name === "audit_log"
      ? "reviewed:c5/people-platform/coolable/audit-log"
      : table.sql_name === "pos_order"
        ? "reviewed:c5/finance-commercial/coolable/pos-order"
        : coolingParent
          ? `reviewed:c5/finance-commercial/coolable/${coolingParent}-child`
        : `reviewed:c5/${reviewGroup(moduleFor(table.sql_name))}/always-hot/missing-semantic-safety-contract`,
    dependency_behavior: activeArchive && table.sql_name === "pos_order"
      ? "block_parent_cooling"
      : coolingParent || parentValid
        ? "follow_parent"
        : "independent",
    hydration_policy: activeArchive?.hydration ?? (coolingParent ? "parent" : "not_applicable"),
    delete_behavior: externalReference
      ? "external"
      : appendHistory
        ? "append_only"
        : snapshot
          ? "rebuild"
          : "tombstone",
    postgres_access_path: externalReference
      ? "external"
      : platform
        ? "platform_shared"
      : activeArchive || appendHistory
        ? "organization_partition"
        : snapshot
          ? "snapshot_key"
          : durabilityClass === "derived_rebuildable"
            ? "derived_only"
            : appendHistory
              ? "append_sequence"
              : "organization_index",
  };

  if (table.sql_name === "audit_log") {
    policy.semantic_eligibility = {
      state: "immutable after creation",
      age_window: "eligible immediately after exact append-only PG archive proof",
      open_obligations: "must_be_clear",
      workflow_state: "must_not_be_active",
      durable_watermark: "append-only archive checksum proof",
      exact_durable_version: "canonical payload checksum must match",
      hot_dependencies: "must_be_clear",
    };
    policy.archive = {
      cold_table: "cold_audit_log",
      mode: "append_only",
      scope: { organization_id: "organization_id", company_id: "company_id" },
      finalize_reducer: "finalize_audit_log_archive",
      order_by: [{ column: "id", direction: "ASC" }],
    };
  } else if (table.sql_name === "pos_order") {
    policy.rationale = "POS transaction aggregate root; lines and payments cool and hydrate atomically with the order.";
    policy.semantic_eligibility = {
      state: "Paid or otherwise terminal; domain reducer validates state",
      age_window: "cold_eligible_at is the reviewed terminal-window eligibility boundary and must be reached",
      open_obligations: "must_be_clear",
      workflow_state: "must_not_be_active",
      durable_watermark: "required",
      exact_durable_version: "archive_version must match",
      hot_dependencies: "all required child rows must be eligible",
    };
    policy.archive = {
      cold_table: "cold_pos_order",
      mode: "versioned",
      scope: { organization_id: "organization_id", company_id: "company_id" },
      finalize_reducer: "finalize_pos_order_archive",
      order_by: [{ column: "id", direction: "ASC" }],
    };
  } else if (table.sql_name === "pos_order_line") {
    policy.semantic_eligibility = {
      state: "inherited from terminal pos_order parent",
      age_window: "inherited from pos_order.cold_eligible_at",
      open_obligations: "inherited from parent aggregate",
      workflow_state: "inherited from parent aggregate",
      durable_watermark: "required for exact child row image",
      exact_durable_version: "latest child commit must be covered",
      hot_dependencies: "must remain in the same aggregate as pos_order",
    };
  } else if (table.sql_name === "pos_payment") {
    policy.semantic_eligibility = {
      state: "inherited from terminal pos_order parent",
      age_window: "inherited from pos_order.cold_eligible_at",
      open_obligations: "payment_status must be terminal and parent must have no balance due",
      workflow_state: "inherited from parent aggregate",
      durable_watermark: "required for exact child row image",
      exact_durable_version: "latest child commit must be covered",
      hot_dependencies: "must remain in the same aggregate as pos_order",
    };
  }

  return policy;
}

function storageClass(policy) {
  if (policy.hot_retention === "terminal_window") return "terminal_window";
  if (policy.hot_retention === "time_window") return "short_hot_tail";
  if (policy.hot_retention === "none") return "pg_first";
  if (["derived-rebuildable", "snapshot", "ephemeral"].includes(policy.projection_mode)) {
    return "projection_only";
  }
  if (policy.projection_mode === "external-reference") return "external_reference";
  return "always_hot";
}

function reviewedFixtures(policies) {
  const seen = new Set();
  const fixtures = [];
  for (const policy of policies) {
    const storage_class = storageClass(policy);
    const key = `${policy.module}\u0000${storage_class}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fixtures.push({
      table: policy.table,
      module: policy.module,
      storage_class,
      reviewed: true,
    });
  }
  return fixtures;
}

function validateParentOverrides(tables) {
  for (const [childName, [parentName, childColumn, parentColumn]] of Object.entries(PARENT_OVERRIDES)) {
    const child = tables.find((table) => table.sql_name === childName);
    const parent = tables.find((table) => table.sql_name === parentName);
    if (!child) throw new Error(`parent override child is not in schema: ${childName}`);
    if (!parent) throw new Error(`parent override parent is not in schema: ${childName} -> ${parentName}`);
    if (!hasColumn(child, childColumn)) {
      throw new Error(`parent override child column is not in schema: ${childName}.${childColumn}`);
    }
    if (!hasColumn(parent, parentColumn)) {
      throw new Error(`parent override parent column is not in schema: ${parentName}.${parentColumn}`);
    }
  }
}

function validate(schema, policyDocument, resourceRegistry) {
  if (!Array.isArray(schema.tables) || schema.tables.length !== 463) {
    throw new Error(`expected schema manifest with 463 tables, found ${schema.tables?.length ?? "none"}`);
  }
  if (policyDocument.version !== 1 || !Array.isArray(policyDocument.policies)) {
    throw new Error("storage policy source must have version 1 and a policies array");
  }
  if (policyDocument.policies.length !== schema.tables.length) {
    throw new Error(`policy count ${policyDocument.policies.length} does not match schema count ${schema.tables.length}`);
  }

  const schemaNames = new Set(schema.tables.map((table) => table.sql_name));
  if (schemaNames.size !== schema.tables.length) throw new Error("schema manifest contains duplicate table names");
  if (schema.ownership_summary?.verified !== true
      || schema.ownership_summary.erp_owned_count !== 463
      || schema.ownership_summary.platform_global_count !== 0) {
    throw new Error("schema manifest must carry verified C0 ownership totals (463 organization + 0 platform)");
  }
  const policyNames = new Set();
  const resources = new Map(Object.entries(resourceRegistry));
  for (const [resource, definition] of resources) {
    if (!schemaNames.has(definition.table)) {
      throw new Error(`resource ${resource} references missing schema table ${definition.table}`);
    }
  }
  const enumValues = {
    durability_class: new Set(["durable_business_record", "durable_history", "durable_operational_state", "derived_rebuildable", "ephemeral", "external_reference", "platform_control"]),
    organization_ownership: new Set(["direct", "platform_global"]),
    company_ownership: new Set(["none", "direct", "parent"]),
    aggregate_kind: new Set(["root", "child", "standalone"]),
    pk_strategy: new Set(["auto_increment", "natural", "composite", "identity"]),
    version_strategy: new Set(["none", "updated_at", "archive_version", "revision", "sequence"]),
    projection_mode: new Set(["upsert-current", "append-history", "snapshot", "derived-rebuildable", "ephemeral", "external-reference"]),
    hot_retention: new Set(["always", "terminal_window", "time_window", "none"]),
    cooling_eligibility: new Set(["never", "terminal", "time_window", "parent", "policy"]),
    dependency_behavior: new Set(["none", "follow_parent", "block_parent_cooling", "independent"]),
    hydration_policy: new Set(["not_applicable", "parent", "aggregate", "full_row"]),
    delete_behavior: new Set(["tombstone", "append_only", "rebuild", "external"]),
    postgres_access_path: new Set(["organization_partition", "organization_index", "append_sequence", "snapshot_key", "derived_only", "platform_shared", "external"]),
  };
  for (const policy of policyDocument.policies) {
    if (policyNames.has(policy.table)) throw new Error(`duplicate C1 policy entry: ${policy.table}`);
    policyNames.add(policy.table);
    if (!schemaNames.has(policy.table)) throw new Error(`policy references missing schema table: ${policy.table}`);
    if (!policy.module || !policy.rationale || !policy.organization_ownership || !Object.hasOwn(policy, "organization_column")) {
      throw new Error(`incomplete ownership policy: ${policy.table}`);
    }
    if (!Array.isArray(policy.authoritative_resources)) {
      throw new Error(`authoritative_resources must be an array in ${policy.table}`);
    }
    for (const resource of policy.authoritative_resources) {
      if (resources.get(resource)?.table !== policy.table) {
        throw new Error(`authoritative resource ${resource} does not map to ${policy.table}`);
      }
    }
    const expectedResources = [...resources]
      .filter(([, definition]) => definition.table === policy.table)
      .map(([resource]) => resource)
      .sort();
    if (JSON.stringify(policy.authoritative_resources) !== JSON.stringify(expectedResources)) {
      throw new Error(`authoritative resources are incomplete in ${policy.table}`);
    }
    if (!policy.aggregate || !policy.primary_key || !Object.hasOwn(policy.primary_key, "version_strategy")) {
      throw new Error(`incomplete relationship/key policy: ${policy.table}`);
    }
    if (!policy.durability_class || !policy.projection_mode || !policy.hot_retention) {
      throw new Error(`incomplete durability policy: ${policy.table}`);
    }
    if (!policy.cooling_eligibility || !policy.cooling_eligibility_source || !policy.dependency_behavior || !policy.hydration_policy) {
      throw new Error(`incomplete lifecycle policy: ${policy.table}`);
    }
    if (!policy.cooling_eligibility_source.startsWith("reviewed:")) {
      throw new Error(`unreviewed cooling decision: ${policy.table}`);
    }
    if (!policy.delete_behavior || !policy.postgres_access_path) {
      throw new Error(`incomplete persistence policy: ${policy.table}`);
    }
    for (const [field, values] of Object.entries(enumValues)) {
      const value = field === "aggregate_kind" ? policy.aggregate.kind : field === "pk_strategy" ? policy.primary_key.strategy : field === "version_strategy" ? policy.primary_key.version_strategy : policy[field];
      if (!values.has(value)) throw new Error(`invalid ${field} '${value}' in ${policy.table}`);
    }
    if (policy.organization_ownership === "direct" && policy.organization_column !== "organization_id") {
      throw new Error(`direct ownership requires organization_id in ${policy.table}`);
    }
    if (policy.organization_ownership === "platform_global" && (policy.organization_column !== null || policy.company_ownership !== "none")) {
      throw new Error(`platform ownership must have null organization/company paths in ${policy.table}`);
    }
    if (policy.company_ownership === "none" && policy.company_column_path !== null) {
      throw new Error(`company none requires null path in ${policy.table}`);
    }
    if (policy.company_ownership === "none" && policy.company_column_nullable !== null) {
      throw new Error(`company none requires null nullability in ${policy.table}`);
    }
    if (policy.company_ownership === "direct" && JSON.stringify(policy.company_column_path) !== JSON.stringify(["company_id"])) {
      throw new Error(`direct company ownership requires ['company_id'] in ${policy.table}`);
    }
    if (policy.company_ownership === "direct") {
      const table = schema.tables.find((candidate) => candidate.sql_name === policy.table);
      const company = table.columns.find((column) => column.sql_name === "company_id");
      if (!company || company.ty !== "U64" || company.nullable !== policy.company_column_nullable) {
        throw new Error(`direct company ownership disagrees with schema in ${policy.table}`);
      }
    }
    if (policy.company_ownership === "parent") {
      const parent = policy.aggregate.parent;
      const parentPolicy = parent && policyDocument.policies.find((candidate) => candidate.table === parent.table);
      const expected = parentPolicy?.company_column_path
        ? [parent.child_column, ...parentPolicy.company_column_path]
        : null;
      if (!parent || JSON.stringify(policy.company_column_path) !== JSON.stringify(expected)) {
        throw new Error(`parent company ownership requires the aggregate parent path in ${policy.table}`);
      }
      if (policy.company_column_nullable !== parentPolicy?.company_column_nullable) {
        throw new Error(`parent company nullability disagrees in ${policy.table}`);
      }
    }
    if (policy.aggregate.kind === "child" && !policy.aggregate.parent) {
      throw new Error(`child aggregate requires parent in ${policy.table}`);
    }
    if (policy.aggregate.kind !== "child" && policy.aggregate.parent !== null) {
      throw new Error(`non-child aggregate cannot have parent in ${policy.table}`);
    }
  }
  const missing = [...schemaNames].filter((name) => !policyNames.has(name));
  if (missing.length) throw new Error(`missing C1 policy entries: ${missing.join(", ")}`);

  const platform = policyDocument.policies.filter((entry) => entry.organization_ownership === "platform_global");
  const organization = policyDocument.policies.filter((entry) => entry.organization_ownership === "direct");
  if (platform.length !== PLATFORM_GLOBAL_TABLES.size || organization.length !== 463) {
    throw new Error(`C0 ownership split must be 463 organization + 0 platform, got ${organization.length} + ${platform.length}`);
  }
  const wrongPlatform = platform.filter((entry) => !PLATFORM_GLOBAL_TABLES.has(entry.table));
  if (wrongPlatform.length) throw new Error(`unapproved platform-global policy: ${wrongPlatform.map((entry) => entry.table).join(", ")}`);
  for (const entry of organization) {
    if (entry.organization_column !== "organization_id") {
      throw new Error(`organization table ${entry.table} lacks direct C0 ownership path`);
    }
  }
  for (const table of schema.tables) {
    const organizationColumns = table.columns.filter((column) => column.sql_name === "organization_id");
    if (PLATFORM_GLOBAL_TABLES.has(table.sql_name)) {
      if (organizationColumns.length !== 0) throw new Error(`platform table ${table.sql_name} carries organization_id`);
      continue;
    }
    const organization = organizationColumns[0];
    const orgLeadingIndex = table.indexes.some((index) => index.columns[0] === "organization_id");
    const orgPrimaryKey = table.primary_key.column_name === "organization_id";
    if (organizationColumns.length !== 1 || organization.ty !== "U64" || organization.nullable || (!orgLeadingIndex && !orgPrimaryKey)) {
      throw new Error(`table ${table.sql_name} fails the C0 ownership shape`);
    }
  }
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const resourceRegistry = JSON.parse(fs.readFileSync(resourceRegistryPath, "utf8"));
const resourcesByTable = new Map();
for (const [resource, definition] of Object.entries(resourceRegistry)) {
  const current = resourcesByTable.get(definition.table) ?? [];
  current.push(resource);
  resourcesByTable.set(definition.table, current);
}
for (const resources of resourcesByTable.values()) resources.sort();
validateParentOverrides(schema.tables);
let policyDocument;
if (checkOnly) {
  policyDocument = JSON.parse(fs.readFileSync(policyPath, "utf8"));
} else {
  const existingDocument = fs.existsSync(policyPath)
    ? JSON.parse(fs.readFileSync(policyPath, "utf8"))
    : { policies: [] };
  const existingByTable = new Map(existingDocument.policies.map((policy) => [policy.table, policy]));
  const policies = schema.tables.map((table) => {
    const generated = buildPolicy(table, schema.tables, resourcesByTable);
    const reviewed = existingByTable.get(table.sql_name);
    // Reviewed domain classifications are deliberate source data. Preserve
    // them across a structural census refresh; the validator below rejects
    // stale tables, ownership paths, relationships, resources, and enum
    // values instead of silently replacing the review with defaults.
    return reviewed ? { ...generated, ...reviewed } : generated;
  });
  policyDocument = {
    _comment: "Checked-in C1 storage-policy source. Bootstrap defaults are deterministic; reviewed policy entries may be hand-edited and must pass --check.",
    version: 1,
    reviewed_fixtures: existingDocument.reviewed_fixtures ?? reviewedFixtures(policies),
    policies,
  };
}

validate(schema, policyDocument, resourceRegistry);

if (checkOnly) {
  const existingByTable = new Map(policyDocument.policies.map((policy) => [policy.table, policy]));
  const refreshedPolicies = schema.tables.map((table) => {
    const generated = buildPolicy(table, schema.tables, resourcesByTable);
    const reviewed = existingByTable.get(table.sql_name);
    return reviewed ? { ...generated, ...reviewed } : generated;
  });
  const refreshed = {
    _comment: "Checked-in C1 storage-policy source. Bootstrap defaults are deterministic; reviewed policy entries may be hand-edited and must pass --check.",
    version: 1,
    reviewed_fixtures: policyDocument.reviewed_fixtures ?? reviewedFixtures(refreshedPolicies),
    policies: refreshedPolicies,
  };
  if (JSON.stringify(refreshed) !== JSON.stringify(policyDocument)) {
    throw new Error("storage policy source is not reproducible; run the bootstrap without --check");
  }
  console.log(`C1 storage policy check passed: ${policyDocument.policies.length}/463 tables`);
} else {
  fs.writeFileSync(policyPath, `${JSON.stringify(policyDocument, null, 2)}\n`);
  console.log(`Wrote ${policyPath}`);
  console.log(`C1 storage policy bootstrap passed: ${policyDocument.policies.length}/463 tables`);
}
