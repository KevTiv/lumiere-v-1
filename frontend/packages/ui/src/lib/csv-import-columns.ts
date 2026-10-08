import type { CsvImportColumns } from "./csv-import-preview"

/**
 * Header contracts of the server `import_*_csv` reducers (spacetimedb/src/data_ops/*_imports.rs).
 * Each reducer takes the raw CSV text, lower-cases the header row and reads cells by name; a row
 * missing a required cell is skipped and recorded as an import-job error rather than failing the call.
 * `resource` is the resource the reducer checks `create` on.
 */
export interface CsvImportContract extends CsvImportColumns {
  resource: string
}

export const CSV_IMPORT_CONTRACTS = {
  project: {
    resource: "project_project",
    required: ["name"],
    optional: [
      "description", "sequence", "currency_id", "partner_id", "date_start", "date_end", "allow_subtasks",
      "allow_timesheets", "bill_type", "pricing_type", "privacy_visibility", "stage_id", "analytic_account_id", "metadata",
    ],
  },
  timesheet: {
    resource: "project_timesheet",
    required: ["project_id", "employee_id"],
    optional: [
      "encoding_uom_id", "currency_id", "date", "unit_amount", "validation_status", "employee_cost", "sell_rate", "amount",
    ],
  },
  expense: {
    resource: "hr_expense",
    required: ["name", "employee_id"],
    optional: [
      "company_id", "product_id", "date", "total_amount", "currency_id", "quantity", "unit_amount", "tax_ids", "account_id",
      "analytic_account_id", "project_id", "line_kind", "description", "payment_mode", "state", "sheet_id",
    ],
  },
  expenseSheet: {
    resource: "hr_expense_sheet",
    required: ["name", "employee_id"],
    optional: ["company_id", "state", "currency_id", "total_amount", "accounting_date", "notes"],
  },
  purchaseOrder: {
    resource: "purchase_order",
    required: ["partner_id", "currency_id"],
    optional: ["name", "origin", "partner_ref", "payment_term_id", "date_order", "date_planned", "notes", "metadata"],
  },
  purchaseOrderLine: {
    resource: "purchase_order_line",
    required: ["order_id", "product_id"],
    optional: [
      "price_unit", "product_qty", "product_uom", "currency_id", "sequence", "date_planned", "product_variant_id",
      "account_analytic_id", "metadata",
    ],
  },
  supplierInfo: {
    resource: "product_supplier_info",
    required: ["partner_id", "currency_id"],
    optional: [
      "product_tmpl_id", "product_id", "product_name", "product_code", "sequence", "min_qty", "price", "company_id",
      "date_start", "date_end", "delay", "metadata",
    ],
  },
  bom: {
    resource: "mrp_bom",
    required: ["product_id", "product_uom_id", "product_qty"],
    optional: [
      "type_", "sequence", "ready_to_produce", "consumption", "warehouse_id", "location_src_id", "location_dest_id",
      "picking_type_id", "metadata",
    ],
  },
  bomLine: {
    resource: "mrp_bom_line",
    required: ["bom_id", "product_id", "product_uom_id", "product_qty"],
    optional: ["sequence", "manual_consumption", "operation_id", "metadata"],
  },
  workcenter: {
    resource: "mrp_workcenter",
    required: ["name"],
    optional: ["code", "active", "capacity", "working_state", "time_efficiency", "oee_target", "sequence", "metadata"],
  },
  manufacturingOrder: {
    resource: "mrp_production",
    required: [
      "product_id", "product_uom_id", "product_qty", "warehouse_id", "location_src_id", "location_dest_id",
      "picking_type_id", "date_planned_start", "date_planned_finished",
    ],
    optional: ["bom_id", "origin", "date_deadline", "metadata"],
  },
  account: {
    resource: "account_account",
    required: ["code", "name"],
    optional: [
      "user_type_id", "currency_id", "is_off_balance", "group_id", "is_bank_account", "reconcile", "tax_ids", "note",
      "opening_debit", "opening_credit", "opening_balance", "metadata",
    ],
  },
  taxRate: {
    resource: "account_tax",
    required: ["name"],
    optional: [
      "type_tax_use", "amount_type", "description", "amount", "price_include", "include_base_amount", "sequence",
      "tax_group_id", "country_id", "country_code", "metadata",
    ],
  },
  accountMove: {
    resource: "account_move",
    required: ["journal_id"],
    optional: [
      "currency_id", "move_type", "date", "name", "ref_", "invoice_date", "invoice_date_due", "invoice_payment_term_id",
      "invoice_origin", "payment_reference", "partner_id", "amount_untaxed", "amount_tax", "amount_total", "metadata",
    ],
  },
  accountMoveLine: {
    resource: "account_move_line",
    required: ["move_id", "account_id"],
    optional: [
      "currency_id", "debit", "credit", "date", "ref_", "sequence", "name", "quantity", "price_unit", "tax_ids",
      "partner_id", "analytic_account_id", "product_id", "product_uom_id", "cogs_amount", "metadata",
    ],
  },
  budget: {
    resource: "crossovered_budget",
    required: ["name"],
    optional: ["date_from", "date_to", "description", "metadata"],
  },
  budgetLine: {
    resource: "crossovered_budget_lines",
    required: ["general_budget_id"],
    optional: ["date_from", "date_to", "planned_amount", "analytic_account_id", "project_id", "metadata"],
  },
  analyticAccount: {
    resource: "account_analytic_account",
    required: ["name"],
    optional: ["currency_id", "code", "partner_id", "group_id", "root_plan_id", "plan_id", "parent_id", "metadata"],
  },
  country: {
    resource: "country",
    required: ["code", "name"],
    optional: ["currency_code", "official_name", "iso3", "numcode", "phone_code", "language_codes", "metadata"],
  },
  currency: {
    resource: "currency",
    required: ["code", "name"],
    optional: ["symbol", "position", "decimal_places", "rounding_factor", "active", "metadata"],
  },
  currencyRate: {
    resource: "currency_rate",
    required: ["from_currency", "to_currency", "rate"],
    optional: ["company_id", "date", "metadata"],
  },
  company: {
    resource: "company",
    required: ["name"],
    optional: [
      "code", "is_parent", "parent_id", "currency_id", "fiscal_year_end_month", "fiscal_year_end_day", "tax_id",
      "company_registry", "address_street", "address_city", "address_zip", "address_country_code", "metadata",
    ],
  },
  role: {
    resource: "role",
    required: ["name"],
    optional: ["description", "parent_id", "permissions", "is_system", "metadata"],
  },
  aiAgent: {
    resource: "ai_agent",
    required: ["name", "model"],
    optional: [
      "provider", "temperature", "description", "api_key_reference", "max_tokens", "top_p", "frequency_penalty",
      "presence_penalty", "system_prompt", "context_window", "is_default", "allowed_models", "allowed_actions",
      "rate_limit_per_minute", "cost_per_1k_tokens", "monthly_budget", "company_id", "metadata",
    ],
  },
} as const satisfies Record<string, CsvImportContract>

export type CsvImportContractKey = keyof typeof CSV_IMPORT_CONTRACTS
